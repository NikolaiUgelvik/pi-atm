import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { compressionToolParameters } from "./compress-tool-schema.js"
import { appendConsumedSummaries, appendProtectedContent, consumedBlockIdsForMessages } from "./compression-content.js"
import { getConfigWarnings, loadConfig, loadState } from "./config.js"
import { debugLog, debugSnapshot } from "./debug.js"
import { runFullExportCommand } from "./full-export/command.js"
import { registerFullExportHookEvents } from "./full-export/hook-events.js"
import {
  createFullExportRuntime,
  recordFullExportContext,
  recordFullExportSessionStart,
} from "./full-export/runtime.js"
import {
  applyPendingManualTrigger,
  asRuntimeContext,
  detectCompaction,
  parseCompressionId,
  toAtmMessages,
} from "./index-helpers.js"
import { isDefined, isToolCall } from "./message-guards.js"
import { loadPersistentState, savePersistentState, sessionKeyFromContext } from "./persistence.js"
import { ensurePromptDefaults, prompt } from "./prompts.js"
import {
  estimateMessages,
  estimateText,
  fingerprintMessage,
  normalizeCompressionRequests,
  pruneForContext,
  stripAliasesFromMessages,
  sweepTools,
} from "./pruning.js"
import { createRuntimeReports } from "./runtime-reports.js"
import type {
  AtmMessage,
  Compression,
  CompressionToolParams,
  NotifyLevel,
  NudgeDraft,
  NudgeType,
  PruneReport,
  RuntimeContext,
  State,
} from "./types.js"
import { EXT, emptyState, STATE_TYPE } from "./types.js"
import { clone, escapeAttr, resolveLimit, textResult } from "./utils.js"

export default function activeTokenManagement(pi: ExtensionAPI) {
  let config = loadConfig(process.cwd())
  let state: State = emptyState()
  let sessionKey = "default"
  let cwd = process.cwd()
  const fullExport = createFullExportRuntime({
    getConfig: () => config,
    getSessionKey: () => sessionKey,
    getCwd: () => cwd,
  })

  const save = () => {
    state.lastUpdated = Date.now()
    pi.appendEntry(STATE_TYPE, state)
    savePersistentState(sessionKey, state)
    fullExport.record({ kind: "atm_state", payload: { reason: "save", state } })
  }
  const reports = createRuntimeReports({
    getConfig: () => config,
    getState: () => state,
    isManual: () => isManual(),
    activeCompressions: () => activeCompressions(),
    notify: (ctx: RuntimeContext, msg: string, level: NotifyLevel) => notify(ctx, msg, level),
  })

  pi.on("session_start", async (event, ctx) => {
    const runtimeCtx = asRuntimeContext(ctx)
    cwd = ctx.cwd ?? process.cwd()
    config = loadConfig(cwd)
    ensurePromptDefaults(config)
    sessionKey = sessionKeyFromContext(runtimeCtx, cwd)
    const entries = ctx.sessionManager.getEntries()
    const entryState = loadState(entries)
    const fileState = loadPersistentState(sessionKey)
    state = fileState && (fileState.lastUpdated ?? 0) >= (entryState.lastUpdated ?? 0) ? fileState : entryState
    state.sessionKey = sessionKey
    for (const warning of getConfigWarnings().slice(0, 5)) ctx.ui.notify(`ATM config warning: ${warning}`, "error")
    if (getConfigWarnings().length > 5)
      ctx.ui.notify(`ATM config warning: ${getConfigWarnings().length - 5} more warnings omitted.`, "error")
    if (config.enabled) ctx.ui.setStatus(EXT, `ATM ${activeCompressions().length} active`)
    if (fullExport.refresh())
      recordFullExportSessionStart({
        record: fullExport.record,
        config,
        ctx: runtimeCtx,
        cwd,
        sessionKey,
        event,
        entriesCount: entries.length,
      })
  })

  registerFullExportHookEvents(pi as never, fullExport.record)

  pi.on("before_agent_start", async (event) => {
    const systemPrompt =
      config.enabled && !isManual() ? `${event.systemPrompt || ""}\n\n${prompt(config, cwd, "system.md")}` : undefined
    fullExport.record({ kind: "before_agent_start", payload: { ...event, returnedSystemPrompt: systemPrompt } })
    if (!systemPrompt) return
    return { systemPrompt }
  })

  pi.on("context", async (event, ctx) => {
    const contextMessages = toAtmMessages(event.messages)
    if (!config.enabled) {
      recordFullExportContext({
        record: fullExport.record,
        originalMessages: contextMessages,
        transformedMessages: contextMessages,
        atmEnabled: false,
      })
      return
    }
    const compacted = detectCompaction(contextMessages)
    if (compacted && compacted !== state.lastCompaction) resetForCompaction(compacted)
    const trigger = applyPendingManualTrigger(contextMessages, state.manualPendingPrompt)
    if (trigger.consumed) state.manualPendingPrompt = undefined
    let { messages, report, changed } = pruneForContext(
      trigger.messages,
      state,
      config,
      !isManual() || config.manualMode.automaticStrategies,
    )
    const nudge = maybeInjectNudge(messages, report, asRuntimeContext(ctx), trigger.messages)
    if (nudge?.changed) {
      messages = nudge.messages
      changed = true
    }
    debugSnapshot(config, "context", { messages, report, state })
    debugLog(config, "context transformed", {
      beforeTokens: report.beforeTokens,
      afterTokens: report.afterTokens,
      savedTokens: report.savedTokens,
      nudgeInjected: !!nudge?.changed,
    })
    state.stats.contextRuns = (state.stats.contextRuns ?? 0) + 1
    state.stats.lastContext = report
    if (report.savedTokens > 0) state.stats.estimatedTokensSaved += report.savedTokens
    if (changed || trigger.changed || compacted) save()
    recordFullExportContext({
      record: fullExport.record,
      originalMessages: contextMessages,
      trigger,
      compacted,
      transformedMessages: messages,
      report,
      nudge,
      atmEnabled: true,
      manualMode: isManual(),
    })
    return { messages: messages as unknown as typeof event.messages }
  })

  pi.registerTool({
    name: "compress",
    label: "Compress Context",
    description:
      "Replace stale conversation context with a durable technical summary without modifying session history.",
    promptSnippet: "Compress stale/completed context into a high-fidelity summary to reduce token usage.",
    promptGuidelines: [
      "Use compress when context is large or completed work no longer needs verbatim transcripts.",
      "When using compress, provide detailed technical summaries that preserve decisions, file paths, commands, errors, and next steps.",
      "Do not compress the most recent active debugging/tool-output context unless it is clearly stale.",
    ],
    parameters: compressionToolParameters,
    async execute(_toolCallId, params: CompressionToolParams, _signal, _onUpdate, ctx) {
      if (!config.enabled) return textResult("ATM is disabled.", true)
      if (config.compress.permission === "deny") return textResult("compress is denied by configuration.", true)
      if (isManual() && !state.manualCompressionPending)
        return textResult("ATM manual mode is active. Do not retry compress until the user runs /atm compress.", true)
      if (config.compress.permission === "ask" && ctx.hasUI) {
        const ok = await ctx.ui.confirm("Compress context?", params.topic ?? "Allow dynamic context compression?")
        if (!ok) return textResult("Compression cancelled by user.", true)
      }

      const startedAt = Date.now()
      const runtimeCtx = asRuntimeContext(ctx)
      const rawContext = toAtmMessages(runtimeCtx.sessionManager.buildSessionContext().messages ?? [])
      const rawComparable = stripAliasesFromMessages(rawContext)
      const visibleContext = stripAliasesFromMessages(
        pruneForContext(rawContext, clone(state), config, !isManual() || config.manualMode.automaticStrategies)
          .messages,
      )
      const requests = normalizeCompressionRequests(visibleContext, params, config)
      if (requests.length === 0) return textResult("No eligible messages selected for compression.", true)

      const created: Compression[] = []
      for (const req of requests) {
        const id = state.nextId++
        const rawSelected = (req.indexes ?? []).map((i) => rawComparable[i]).filter(isDefined)
        const selectedForFingerprints = rawSelected.length === req.selected.length ? rawSelected : req.selected
        const finalSummary = appendProtectedContent(
          appendConsumedSummaries(req.summary, req.selected, state),
          rawSelected.length ? rawSelected : req.selected,
          config,
        )
        const compression: Compression = {
          id,
          mode: req.mode,
          active: true,
          createdAt: Date.now(),
          summary: finalSummary,
          topic: req.topic ?? params.topic,
          focus: params.focus,
          fingerprints: selectedForFingerprints.map(fingerprintMessage),
          startFingerprint: fingerprintMessage(selectedForFingerprints[0]),
          endFingerprint: fingerprintMessage(selectedForFingerprints[selectedForFingerprints.length - 1]),
          originalTokenEstimate: estimateMessages(selectedForFingerprints),
          summaryTokenEstimate: estimateText(finalSummary),
          durationMs: Date.now() - startedAt,
          consumedBlockIds: consumedBlockIdsForMessages(req.selected),
        }
        for (const consumedId of compression.consumedBlockIds ?? []) {
          const consumed = state.compressions.find((c) => c.id === consumedId)
          if (consumed) {
            consumed.active = false
            consumed.consumedBy = id
          }
        }
        state.compressions.push(compression)
        state.stats.compressionsCreated++
        state.stats.estimatedTokensSaved += Math.max(
          0,
          compression.originalTokenEstimate - compression.summaryTokenEstimate,
        )
        created.push(compression)
      }
      debugLog(config, "compression created", {
        ids: created.map((c) => c.id),
        topics: created.map((c) => c.topic),
        savedTokens: created.map((c) => Math.max(0, c.originalTokenEstimate - c.summaryTokenEstimate)),
      })
      if (state.manualCompressionPending) {
        state.manualCompressionPending = false
        state.manualMode = true
      }
      save()
      ctx.ui.setStatus(EXT, `ATM ${activeCompressions().length} active`)
      reports.notifyCompression(runtimeCtx, created)
      return textResult(
        `Compression active: ${created.map((c) => `#${c.id} saved ~${Math.max(0, c.originalTokenEstimate - c.summaryTokenEstimate)} tokens`).join("; ")}.`,
      )
    },
  })

  pi.registerCommand("atm", {
    description:
      "Active Token Management: compress by default; export, context, stats, sweep, decompress, recompress, manual, enable, disable",
    handler: async (args, ctx) => {
      const [cmd, ...rest] = (args || "").trim().split(/\s+/).filter(Boolean)
      const tail = rest.join(" ")
      const entryState = loadState(ctx.sessionManager.getEntries())
      const fileState = loadPersistentState(sessionKey)
      state = fileState && (fileState.lastUpdated ?? 0) >= (entryState.lastUpdated ?? 0) ? fileState : entryState
      switch (cmd || "compress") {
        case "help":
          ctx.ui.notify(
            "/atm [compress [focus]] | export [filter] | context | stats | sweep [n] | decompress <id> | recompress <id> | manual [on|off] | enable | disable",
            "info",
          )
          return
        case "export":
          runFullExportCommand({ filterText: tail, ctx: asRuntimeContext(ctx), cwd, sessionKey, state })
          return
        case "context": {
          const usage = ctx.getContextUsage?.()
          ctx.ui.notify(reports.contextReport(asRuntimeContext(ctx), usage), "info")
          return
        }
        case "stats":
          ctx.ui.notify(reports.statsReport(), "info")
          return
        case "manual": {
          if (tail === "on") state.manualMode = true
          else if (tail === "off") state.manualMode = false
          else state.manualMode = !isManual()
          save()
          ctx.ui.notify(`ATM manual mode ${isManual() ? "on" : "off"}.`, "info")
          return
        }
        case "enable":
          config.enabled = true
          ctx.ui.notify("ATM enabled for this runtime. Persist in .pi/atm.jsonc if desired.", "info")
          return
        case "disable":
          config.enabled = false
          ctx.ui.notify("ATM disabled for this runtime. Persist in .pi/atm.jsonc if desired.", "info")
          return
        case "sweep": {
          const raw = toAtmMessages(asRuntimeContext(ctx).sessionManager.buildSessionContext().messages ?? [])
          const n = Number(rest[0])
          const swept = sweepTools(raw, Number.isFinite(n) && n > 0 ? n : undefined, config, state)
          debugLog(config, "manual sweep", { swept })
          save()
          ctx.ui.notify(
            swept.length
              ? `ATM swept ${swept.length} tool result${swept.length === 1 ? "" : "s"}: ${swept.map((x) => x.toolName ?? x.toolCallId).join(", ")}`
              : "No eligible tool results to sweep.",
            "info",
          )
          return
        }
        case "compress": {
          state.manualMode = true
          state.manualCompressionPending = true
          state.manualPendingPrompt = `Use the compress tool now. Compress stale or completed context, keep recent active work verbatim, and preserve all technical details.${tail ? ` Focus: ${tail}` : ""}`
          save()
          pi.sendUserMessage(state.manualPendingPrompt)
          return
        }
        case "decompress":
        case "recompress": {
          const id = parseCompressionId(rest[0])
          if (!id) return ctx.ui.notify(reports.listCompressions(), "info")
          const c = state.compressions.find((x) => x.id === id)
          if (!c) return ctx.ui.notify(`No compression #${id}.`, "error")
          if (cmd === "decompress") {
            c.active = false
            c.userDecompressed = true
            for (const childId of c.consumedBlockIds ?? []) {
              const child = state.compressions.find(
                (x) => x.id === childId && x.consumedBy === c.id && !x.userDecompressed,
              )
              if (child) child.active = true
            }
          } else {
            c.active = true
            c.userDecompressed = false
            for (const childId of c.consumedBlockIds ?? []) {
              const child = state.compressions.find((x) => x.id === childId && x.consumedBy === c.id)
              if (child) child.active = false
            }
          }
          save()
          ctx.ui.setStatus(EXT, `ATM ${activeCompressions().length} active`)
          ctx.ui.notify(`Compression b${id} ${c.active ? "recompressed" : "decompressed"}.`, "info")
          return
        }
        default:
          ctx.ui.notify(`Unknown /atm command: ${cmd}`, "error")
      }
    },
  })

  function isManual() {
    return state.manualMode ?? config.manualMode.enabled
  }
  function activeCompressions() {
    return state.compressions.filter((c) => c.active)
  }
  function messagesSinceLastUser(messages: AtmMessage[]) {
    let count = 0
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === "user") break
      count++
    }
    return count
  }
  function latestAssistantHasCompress(messages: AtmMessage[]) {
    const latest = [...messages].reverse().find((m) => m.role === "assistant")
    const content = Array.isArray(latest?.content) ? latest.content : []
    return content.some((part) => isToolCall(part) && (part.name === "compress" || part.name === "compress_context"))
  }
  function nudgeAnchor(messages: AtmMessage[]) {
    return fingerprintMessage(messages[messages.length - 1] ?? { role: "custom", content: "empty" })
  }
  function shouldNudgeAt(type: NudgeType, anchor: string, length: number) {
    state.nudges ??= { context: [], turn: [], iteration: [] }
    const anchors = state.nudges[type] ?? []
    if (anchors.includes(anchor)) return false
    const freq = Math.max(1, config.compress.nudgeFrequency)
    return anchors.length === 0 || length % freq === 0 || type === "context"
  }
  function maybeInjectNudge(
    messages: AtmMessage[],
    report: PruneReport,
    ctx?: RuntimeContext,
    originalMessages = messages,
  ) {
    if (isManual()) return
    if (latestAssistantHasCompress(originalMessages)) {
      if (state.nudges?.context?.length || state.nudges?.turn?.length || state.nudges?.iteration?.length) {
        state.nudges = { context: [], turn: [], iteration: [] }
        return { messages, changed: true }
      }
      return
    }

    const estimatedTokens = Math.max(0, Number(report.afterTokens) || estimateMessages(messages))
    const rawUsageTokens = ctx?.getContextUsage?.()?.tokens
    const usageTokens = typeof rawUsageTokens === "number" ? rawUsageTokens : undefined
    const tokens = estimatedTokens
    const model = ctx?.model
    const modelWindow = model?.contextWindow ?? 200_000
    const modelKey = model?.id ?? model?.name ?? ""
    const maxLimit = config.compress.modelMaxLimits?.[modelKey] ?? config.compress.maxContextLimit
    const minLimit = config.compress.modelMinLimits?.[modelKey] ?? config.compress.minContextLimit
    const max = resolveLimit(maxLimit, modelWindow)
    const min = resolveLimit(minLimit, modelWindow)
    const overMax = tokens >= max
    const overMin = tokens >= min
    if (!overMin) {
      if (state.nudges?.turn?.length || state.nudges?.iteration?.length) {
        state.nudges.turn = []
        state.nudges.iteration = []
        return { messages, changed: true }
      }
      return
    }

    const sinceLastUser = messagesSinceLastUser(messages)
    const type: NudgeType = overMax
      ? "context"
      : sinceLastUser >= config.compress.iterationNudgeThreshold
        ? "iteration"
        : "turn"
    const anchor = nudgeAnchor(messages)
    if (!shouldNudgeAt(type, anchor, messages.length)) return
    const reason =
      type === "iteration" ? `${sinceLastUser} messages since last user turn` : `${tokens || "unknown"} tokens`
    const text = buildNudgeText(type, reason, overMax)
    recordNudge({ type, anchor, text, tokens, usageTokens, estimatedTokens, messageCount: messages.length, reason })
    return {
      messages: [
        ...messages,
        nudgeMessage({
          type,
          anchor,
          text,
          tokens,
          usageTokens,
          estimatedTokens,
          messageCount: messages.length,
          reason,
        }),
      ],
      changed: true,
    }
  }
  function buildNudgeText(type: NudgeType, reason: string, overMax: boolean) {
    const template = prompt(
      config,
      cwd,
      type === "context" ? "context-limit-nudge.md" : type === "iteration" ? "iteration-nudge.md" : "turn-nudge.md",
    )
    const force = overMax || config.compress.nudgeForce === "strong" ? "strongly" : "when useful"
    return `${template}\nCurrent context signal: ${reason}. ${force} consider compressing stale work. Refer to message aliases like m0001/m0002 or block aliases like b1 when provided.`
  }
  function nudgeMessage(audit: NudgeDraft): AtmMessage {
    return {
      role: "custom",
      customType: EXT,
      display: false,
      timestamp: Date.now(),
      details: {
        nudge: true,
        notification: false,
        type: audit.type,
        anchor: audit.anchor,
        tokens: audit.tokens,
        usageTokens: audit.usageTokens,
        estimatedTokens: audit.estimatedTokens,
        messageCount: audit.messageCount,
        reason: audit.reason,
      },
      content: `<active-token-management-nudge type="${audit.type}" tokens="${audit.tokens}" anchor="${escapeAttr(audit.anchor)}">\n${audit.text}\n</active-token-management-nudge>`,
    }
  }
  function recordNudge(audit: NudgeDraft) {
    state.nudges ??= { context: [], turn: [], iteration: [] }
    state.nudges[audit.type] = [...(state.nudges[audit.type] ?? []), audit.anchor].slice(-50)
    state.nudgeAudit = [...(state.nudgeAudit ?? []), { ...audit, createdAt: Date.now() }].slice(-100)
  }
  function resetForCompaction(id: string) {
    state.lastCompaction = id
    state.compressions = []
    state.prunedTools = []
    state.nudges = { context: [], turn: [], iteration: [] }
    state.nudgeAudit = []
    debugLog(config, "compaction detected; ATM state reset", { id })
    fullExport.record({ kind: "atm_state", payload: { reason: "compaction_reset", id, state } })
  }
  function notify(ctx: RuntimeContext, msg: string, level: NotifyLevel) {
    if (config.pruneNotification === "off") return
    if (config.pruneNotificationType === "chat") {
      try {
        pi.sendMessage({ customType: EXT, content: msg, display: true, details: { level, notification: true } })
        return
      } catch {}
    }
    ctx.ui.notify(msg, level)
  }
}
