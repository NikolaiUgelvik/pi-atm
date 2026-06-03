import {
  hasPartId,
  hasToolCallId,
  isDefined,
  isToolCall,
  isToolCallWithId,
  isToolResultWithId,
  toolCallsOf,
} from "./message-guards.js"
import { stripStaleProviderMetadata } from "./provider-metadata.js"
import { pruneFailedToolInput } from "./tool-pruning.js"
import type {
  AtmMessage,
  Compression,
  CompressionMode,
  CompressionToolParams,
  Config,
  NormalizedCompressionRequest,
  PrunedTool,
  PruneReport,
  State,
} from "./types.js"
import { EXT } from "./types.js"
import {
  clone,
  escapeAttr,
  estimateMessages,
  estimateText,
  findToolCallIndex,
  fingerprintMessage,
  indexFromAlias,
  indexFromMessageOrBlockAlias,
  injectMessageAliases,
  isProtectedToolCall,
  matchesAny,
  messageTouchesProtectedToolOrFile,
  normalizeToolArgs,
  range,
  stableJson,
  stripAliasesFromMessages,
  textOf,
  toolCallFor,
  toolCallKey,
  toolSet,
} from "./utils.js"

export function pruneForContext(
  inputMessages: AtmMessage[],
  state: State,
  config: Config,
  automaticStrategies: boolean,
) {
  let messages = clone(inputMessages).filter(
    (m) => !(m.role === "custom" && m.customType === EXT && (m.details?.notification || m.details?.nudge === true)),
  )
  const beforeTokens = estimateMessages(messages)
  const report: PruneReport = {
    timestamp: Date.now(),
    beforeMessages: messages.length,
    afterMessages: messages.length,
    beforeTokens,
    afterTokens: beforeTokens,
    savedTokens: 0,
    byRoleBefore: countByRole(messages),
    byRoleAfter: countByRole(messages),
    compressions: [],
    dedupe: [],
    errors: [],
  }
  messages = applyCompressions(messages, state, config, report)
  messages = applyManualToolPrunes(messages, state)
  if (automaticStrategies) {
    messages = applyDeduplication(messages, config, state, report)
    messages = applyErrorPurging(messages, config, state, report)
  }
  messages = sanitizeToolPairing(messages)
  messages = stripStaleProviderMetadata(messages)
  messages = injectMessageAliases(messages)
  report.afterMessages = messages.length
  report.afterTokens = estimateMessages(messages)
  report.savedTokens = Math.max(0, report.beforeTokens - report.afterTokens)
  report.byRoleAfter = countByRole(messages)
  const changed = report.compressions.length > 0 || report.dedupe.length > 0 || report.errors.length > 0
  return { messages, report, changed }
}

function applyCompressions(messages: AtmMessage[], state: State, config: Config, report?: PruneReport) {
  for (const c of state.compressions.filter((x) => x.active)) {
    if (c.mode === "message") messages = applyMessageCompression(messages, c, config, report)
    else messages = applyRangeCompression(messages, c, config, report)
  }
  return messages
}

function applyRangeCompression(messages: AtmMessage[], c: Compression, config: Config, report?: PruneReport) {
  const fps = messages.map(fingerprintMessage)
  let start = fps.indexOf(c.startFingerprint || "")
  if (start < 0) return messages
  let end = -1
  for (let i = start; i < fps.length; i++)
    if (fps[i] === c.endFingerprint) {
      end = i
      break
    }
  if (end < start) return messages
  const protectedRecent = Math.max(0, messages.length - config.compress.keepRecentMessages)
  if (end >= protectedRecent) return messages
  const balanced = expandRangeToToolBoundaries(messages, start, end)
  start = balanced.start
  end = balanced.end
  if (end >= protectedRecent) return messages
  const replacement = compressionMessage(c)
  const beforeTokens = estimateMessages(messages.slice(start, end + 1))
  const afterTokens = estimateMessages([replacement])
  report?.compressions.push({
    id: c.id,
    topic: c.topic,
    mode: c.mode,
    messages: end - start + 1,
    beforeTokens,
    afterTokens,
    savedTokens: Math.max(0, beforeTokens - afterTokens),
    startIndex: start,
    endIndex: end,
    consumedBlockIds: c.consumedBlockIds,
  })
  return [...messages.slice(0, start), replacement, ...messages.slice(end + 1)]
}

function applyMessageCompression(messages: AtmMessage[], c: Compression, config: Config, report?: PruneReport) {
  const recentStart = Math.max(0, messages.length - config.compress.keepRecentMessages)
  const set = new Set(c.fingerprints)
  let inserted = false
  let replaced = 0
  let first: number | undefined
  let last: number | undefined
  const before: AtmMessage[] = []
  const replacement = compressionMessage(c)
  const out: AtmMessage[] = []
  messages.forEach((m, i) => {
    if (i >= recentStart || !set.has(fingerprintMessage(m))) out.push(m)
    else {
      before.push(m)
      replaced++
      first ??= i
      last = i
      if (!inserted) {
        out.push(replacement)
        inserted = true
      }
    }
  })
  if (replaced > 0) {
    const beforeTokens = estimateMessages(before)
    const afterTokens = estimateMessages([replacement])
    report?.compressions.push({
      id: c.id,
      topic: c.topic,
      mode: c.mode,
      messages: replaced,
      beforeTokens,
      afterTokens,
      savedTokens: Math.max(0, beforeTokens - afterTokens),
      startIndex: first,
      endIndex: last,
      consumedBlockIds: c.consumedBlockIds,
    })
  }
  return out
}

function compressionMessage(c: Compression): AtmMessage {
  return {
    role: "custom",
    customType: EXT,
    display: false,
    timestamp: c.createdAt,
    content: `<compressed-context id="${c.id}" alias="b${c.id}" mode="${c.mode}"${c.topic ? ` topic="${escapeAttr(c.topic)}"` : ""}${c.consumedBlockIds?.length ? ` consumes="${c.consumedBlockIds.join(",")}"` : ""}>\n${c.summary}\n</compressed-context>`,
  }
}

function expandRangeToToolBoundaries(messages: AtmMessage[], start: number, end: number) {
  let changed = true
  while (changed) {
    changed = false
    const removedToolCalls = new Set<string>()
    const removedToolResults = new Set<string>()
    for (let i = start; i <= end; i++) {
      const m = messages[i]
      if (m?.role === "assistant") {
        for (const tc of toolCallsOf(m).filter(hasPartId)) removedToolCalls.add(tc.id)
      } else if (m?.role === "toolResult" && hasToolCallId(m)) {
        removedToolResults.add(m.toolCallId)
      }
    }

    for (let i = 0; i < messages.length; i++) {
      if (i >= start && i <= end) continue
      const m = messages[i]
      let mustInclude = false
      if (m?.role === "toolResult" && hasToolCallId(m) && removedToolCalls.has(m.toolCallId)) mustInclude = true
      if (m?.role === "assistant") {
        for (const tc of toolCallsOf(m).filter(hasPartId)) {
          if (removedToolResults.has(tc.id)) {
            mustInclude = true
            break
          }
        }
      }
      if (mustInclude) {
        start = Math.min(start, i)
        end = Math.max(end, i)
        changed = true
      }
    }
  }
  return { start, end }
}

function sanitizeToolPairing(messages: AtmMessage[]) {
  const resultIds = new Set(messages.filter(isToolResultWithId).map((m) => m.toolCallId))
  const seenToolCalls = new Set<string>()
  return messages.map((m) => {
    if (m.role === "assistant") {
      const content = Array.isArray(m.content) ? m.content : []
      const filtered = content.filter((part) => !isToolCall(part) || !part.id || resultIds.has(part.id))
      for (const tc of filtered.filter(isToolCallWithId)) seenToolCalls.add(tc.id)
      if (filtered.length === content.length) return m
      return {
        ...m,
        content: filtered.length
          ? filtered
          : [{ type: "text", text: "[Tool call removed because its paired result was compressed/pruned.]" }],
      }
    }
    if (m.role !== "toolResult" || !hasToolCallId(m) || seenToolCalls.has(m.toolCallId)) return m
    return {
      role: "custom",
      customType: EXT,
      display: false,
      timestamp: m.timestamp,
      content: `<orphan-tool-result tool="${escapeAttr(m.toolName ?? "unknown")}" call_id="${escapeAttr(m.toolCallId)}">\n${textOf(m)}\n</orphan-tool-result>`,
    }
  })
}

function applyManualToolPrunes(messages: AtmMessage[], state: State) {
  const pruned = new Map((state.prunedTools ?? []).map((p) => [p.toolCallId, p]))
  if (!pruned.size) return messages
  return messages.map((m) => {
    if (m.role !== "toolResult" || !hasToolCallId(m)) return m
    const p = pruned.get(m.toolCallId)
    if (!p) return m
    return { ...m, content: [{ type: "text", text: `[Output removed to save context - ${p.reason}]` }] }
  })
}

function applyDeduplication(messages: AtmMessage[], config: Config, state: State, report?: PruneReport) {
  if (!config.strategies.deduplication.enabled) return messages
  const protectedTools = toolSet(config.strategies.deduplication.protectedTools)
  const lastByCall = new Map<string, number>()
  messages.forEach((m, i) => {
    if (m.role !== "assistant") return
    for (const tc of toolCallsOf(m)) {
      if (!matchesAny(tc.name, protectedTools) && !isProtectedToolCall(tc, config))
        lastByCall.set(`${tc.name}:${stableJson(normalizeToolArgs(tc.arguments ?? {}))}`, i)
    }
  })
  return messages.map((m) => {
    if (
      m.role !== "toolResult" ||
      !hasToolCallId(m) ||
      matchesAny(m.toolName, protectedTools) ||
      messageIsTurnProtected(messages, messages.indexOf(m), config)
    )
      return m
    const callIndex = findToolCallIndex(messages, m.toolCallId)
    const call = toolCallFor(messages[callIndex], m.toolCallId)
    if (isProtectedToolCall(call, config)) return m
    const key = toolCallKey(messages[callIndex], m.toolCallId)
    const keptCallIndex = key ? lastByCall.get(key) : undefined
    if (!key || keptCallIndex === undefined || keptCallIndex === callIndex) return m
    const replacement: AtmMessage = {
      ...m,
      content: [
        { type: "text", text: "[Output removed to save context - information superseded or no longer needed]" },
      ],
    }
    const beforeTokens = estimateMessages([m])
    const afterTokens = estimateMessages([replacement])
    report?.dedupe.push({
      toolName: m.toolName ?? "unknown",
      callIndex,
      keptCallIndex,
      beforeTokens,
      afterTokens,
      savedTokens: Math.max(0, beforeTokens - afterTokens),
    })
    state.stats.dedupePrunes++
    return replacement
  })
}

function applyErrorPurging(messages: AtmMessage[], config: Config, state: State, report?: PruneReport) {
  if (!config.strategies.purgeErrors.enabled) return messages
  const protectedTools = toolSet(config.strategies.purgeErrors.protectedTools)
  const staleErrored = new Map<string, { toolName: string; userTurnsAfter: number; excerpt: string }>()
  messages.forEach((m, i) => {
    if (
      m.role !== "toolResult" ||
      !hasToolCallId(m) ||
      !m.isError ||
      matchesAny(m.toolName, protectedTools) ||
      messageIsTurnProtected(messages, i, config)
    )
      return
    const callIndex = findToolCallIndex(messages, m.toolCallId)
    if (isProtectedToolCall(toolCallFor(messages[callIndex], m.toolCallId), config)) return
    const userTurnsAfter = messages.slice(i + 1).filter((x) => x.role === "user").length
    if (userTurnsAfter >= config.strategies.purgeErrors.turns)
      staleErrored.set(m.toolCallId, {
        toolName: m.toolName ?? "unknown",
        userTurnsAfter,
        excerpt: textOf(m).slice(0, 500),
      })
  })
  if (!staleErrored.size) return messages
  return messages.map((m) => {
    if (m.role === "assistant" && Array.isArray(m.content)) {
      return {
        ...m,
        content: m.content.map((part) =>
          isToolCallWithId(part) && staleErrored.has(part.id)
            ? { ...part, arguments: pruneFailedToolInput(part.arguments ?? {}) }
            : part,
        ),
      }
    }
    if (m.role !== "toolResult" || !hasToolCallId(m)) return m
    const info = staleErrored.get(m.toolCallId)
    if (!info) return m
    const replacement: AtmMessage = {
      ...m,
      content: [
        {
          type: "text",
          text: `[Pruned stale errored ${info.toolName} result after ${info.userTurnsAfter} user turns. Error excerpt: ${info.excerpt}]`,
        },
      ],
    }
    const beforeTokens = estimateMessages([m])
    const afterTokens = estimateMessages([replacement])
    report?.errors.push({
      toolName: info.toolName,
      userTurnsAfter: info.userTurnsAfter,
      beforeTokens,
      afterTokens,
      savedTokens: Math.max(0, beforeTokens - afterTokens),
      excerpt: info.excerpt,
    })
    state.stats.errorPrunes++
    return replacement
  })
}

export function normalizeCompressionRequests(
  messages: AtmMessage[],
  params: CompressionToolParams,
  config: Config,
): NormalizedCompressionRequest[] {
  const content = Array.isArray(params.content) ? params.content : []
  if (content.length === 0) {
    const selected = selectCompressionTargets(messages, params, config)
    return selected.length && params.summary
      ? [
          {
            mode: params.mode ?? config.compress.mode,
            selected,
            indexes: selected.map((m) => messages.indexOf(m)).filter((i) => i >= 0),
            summary: params.summary,
            topic: params.topic,
          },
        ]
      : []
  }
  const out: NormalizedCompressionRequest[] = []
  const used = new Set<number>()
  for (const item of content) {
    const mode: CompressionMode = params.mode ?? (item.messageId ? "message" : config.compress.mode)
    let indexes: number[] = []
    if (mode === "message" && item.messageId) {
      const i = indexFromAlias(item.messageId)
      if (i >= 0 && i < messages.length) indexes = [i]
    } else {
      const start = indexFromMessageOrBlockAlias(messages, item.startId)
      const end = indexFromMessageOrBlockAlias(messages, item.endId)
      if (start >= 0 && end >= start && end < messages.length) indexes = range(start, end)
    }
    indexes = indexes.filter((i) => i < messages.length - config.compress.keepRecentMessages && !used.has(i))
    indexes = indexes.filter(
      (i) => !messageTouchesProtectedToolOrFile(messages, i, config) && !messageIsTurnProtected(messages, i, config),
    )
    if (!indexes.length || !item.summary) continue
    indexes.forEach((i) => {
      used.add(i)
    })
    out.push({
      mode,
      selected: indexes.map((i) => messages[i]).filter(isDefined),
      indexes,
      summary: item.summary,
      topic: item.topic ?? params.topic,
    })
  }
  return out
}

function selectCompressionTargets(messages: AtmMessage[], params: CompressionToolParams, config: Config) {
  const keepRecent = params.keepRecentMessages ?? config.compress.keepRecentMessages
  let start = typeof params.startIndex === "number" && Number.isInteger(params.startIndex) ? params.startIndex : 0
  let end =
    typeof params.endIndex === "number" && Number.isInteger(params.endIndex)
      ? params.endIndex
      : messages.length - 1 - keepRecent
  if (params.target === "since_last_user") {
    start = Math.max(0, messages.map((m) => m.role).lastIndexOf("user") + 1)
    end = messages.length - 1
  }
  if (params.target === "stale" || params.target === "all_except_recent" || !params.target) {
    end = Math.min(end, messages.length - 1 - keepRecent)
  }
  start = Math.max(0, start)
  end = Math.min(messages.length - 1, end)
  if (end < start) return []
  return messages.slice(start, end + 1).filter((_m, offset) => {
    const i = start + offset
    return !messageTouchesProtectedToolOrFile(messages, i, config) && !messageIsTurnProtected(messages, i, config)
  })
}

function messageIsTurnProtected(messages: AtmMessage[], i: number, config: Config) {
  if (!config.turnProtection.enabled) return false
  const m = messages[i]
  const isToolRelated = m?.role === "toolResult" || (m?.role === "assistant" && toolCallsOf(m).length > 0)
  if (!isToolRelated) return false
  const userTurnsAfter = messages.slice(i + 1).filter((x) => x.role === "user").length
  return userTurnsAfter < config.turnProtection.turns
}

export function sweepTools(messages: AtmMessage[], n: number | undefined, config: Config, state: State) {
  const existing = new Set((state.prunedTools ?? []).map((p) => p.toolCallId))
  const protectedTools = toolSet([])
  const candidates: Array<AtmMessage & { toolCallId: string }> = []
  let userSeen = false
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!m) continue
    if (!n && m.role === "user") {
      if (userSeen) break
      userSeen = true
      continue
    }
    if (
      m.role !== "toolResult" ||
      !hasToolCallId(m) ||
      existing.has(m.toolCallId) ||
      matchesAny(m.toolName, protectedTools) ||
      messageIsTurnProtected(messages, i, config)
    )
      continue
    const call = toolCallFor(messages[findToolCallIndex(messages, m.toolCallId)], m.toolCallId)
    if (isProtectedToolCall(call, config)) continue
    candidates.push(m)
    if (n && candidates.length >= n) break
  }
  const swept: PrunedTool[] = candidates.reverse().map((m) => ({
    toolCallId: m.toolCallId,
    toolName: m.toolName,
    reason: "manually swept by /atm sweep",
    originalTokenEstimate: estimateMessages([m]),
  }))
  state.prunedTools ??= []
  state.prunedTools.push(...swept)
  state.stats.estimatedTokensSaved += swept.reduce(
    (sum, p) => sum + Math.max(0, (p.originalTokenEstimate ?? 0) - 12),
    0,
  )
  return swept
}

function countByRole(messages: AtmMessage[]) {
  const counts: Record<string, number> = {}
  for (const m of messages) counts[m.role ?? "unknown"] = (counts[m.role ?? "unknown"] ?? 0) + 1
  return counts
}

export { estimateMessages, estimateText, fingerprintMessage, stripAliasesFromMessages }
