import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { loadConfig } from "./config.js"
import { debugLog } from "./debug.js"
import { registerFullExportHookEvents } from "./full-export/hook-events.js"
import { createFullExportRuntime } from "./full-export/runtime.js"
import { createAtmCommandHandler } from "./index-command.js"
import { createCompressTool } from "./index-compress-tool.js"
import { createContextHandler } from "./index-context.js"
import { createNudgeRuntime } from "./index-nudges.js"
import { createSessionStartHandler } from "./index-session.js"
import { savePersistentState } from "./persistence.js"
import { prompt } from "./prompts.js"

import { createRuntimeReports } from "./runtime-reports.js"
import type { NotifyLevel, RuntimeContext, State } from "./types.js"
import { EXT, emptyState, STATE_TYPE } from "./types.js"

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
  const nudgeRuntime = createNudgeRuntime({
    getConfig: () => config,
    getState: () => state,
    getCwd: () => cwd,
    isManual: () => isManual(),
  })
  const reports = createRuntimeReports({
    getConfig: () => config,
    getState: () => state,
    isManual: () => isManual(),
    activeCompressions: () => activeCompressions(),
    notify: (ctx: RuntimeContext, msg: string, level: NotifyLevel) => notify(ctx, msg, level),
  })

  pi.on(
    "session_start",
    createSessionStartHandler({
      setConfig: (next) => {
        config = next
      },
      setState: (next) => {
        state = next
      },
      setSessionKey: (next) => {
        sessionKey = next
      },
      setCwd: (next) => {
        cwd = next
      },
      activeCompressionCount: () => activeCompressions().length,
      fullExport,
    }) as never,
  )

  registerFullExportHookEvents(pi as never, fullExport.record)

  pi.on("before_agent_start", async (event) => {
    const systemPrompt =
      config.enabled && !isManual() ? `${event.systemPrompt || ""}\n\n${prompt(config, cwd, "system.md")}` : undefined
    fullExport.record({ kind: "before_agent_start", payload: { ...event, returnedSystemPrompt: systemPrompt } })
    if (!systemPrompt) return
    return { systemPrompt }
  })

  pi.on(
    "context",
    createContextHandler({
      getConfig: () => config,
      getState: () => state,
      isManual,
      save,
      resetForCompaction,
      fullExportRecord: fullExport.record,
      nudgeRuntime,
    }) as never,
  )

  pi.registerTool(
    createCompressTool({
      getConfig: () => config,
      getState: () => state,
      isManual,
      save,
      activeCompressions,
      reports,
    }) as never,
  )

  pi.registerCommand("atm", {
    description:
      "Active Token Management: compress by default; export, context, stats, sweep, decompress, recompress, manual, enable, disable",
    handler: createAtmCommandHandler({
      getConfig: () => config,
      getState: () => state,
      setState: (next) => {
        state = next
      },
      getCwd: () => cwd,
      getSessionKey: () => sessionKey,
      isManual,
      save,
      activeCompressions,
      reports,
      sendUserMessage: (message) => pi.sendUserMessage(message),
    }) as never,
  })

  function isManual() {
    return state.manualMode ?? config.manualMode.enabled
  }
  function activeCompressions() {
    return state.compressions.filter((c) => c.active)
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
