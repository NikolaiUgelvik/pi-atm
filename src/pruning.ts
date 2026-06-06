import { clone } from "./clone.js"
import { escapeAttr } from "./html-attr.js"
import { injectMessageAliases } from "./message-alias-inject.js"
import { fingerprintMessage } from "./message-fingerprint.js"
import { stripStaleProviderMetadata } from "./provider-metadata.js"
import { applyDeduplication, applyErrorPurging } from "./pruning-strategies.js"
import { expandRangeToToolBoundaries, sanitizeToolPairing } from "./pruning-tool-pairs.js"
import { estimateMessages } from "./token-estimates.js"
import { hasToolCallId } from "./tool-result-guards.js"
import type { AtmMessage, Compression, Config, PruneReport, State } from "./types.js"
import { EXT } from "./types.js"

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
  const range = compressibleRange(messages, c, config)
  if (!range) return messages
  const replacement = compressionMessage(c)
  reportRangeCompression(messages, c, range, replacement, report)
  return [...messages.slice(0, range.start), replacement, ...messages.slice(range.end + 1)]
}

function compressibleRange(messages: AtmMessage[], c: Compression, config: Config) {
  const matched = matchedCompressionRange(messages.map(fingerprintMessage), c)
  if (!matched) return undefined
  const protectedRecent = Math.max(0, messages.length - config.compress.keepRecentMessages)
  if (matched.end >= protectedRecent) return undefined
  const balanced = expandRangeToToolBoundaries(messages, matched.start, matched.end)
  return balanced.end >= protectedRecent ? undefined : balanced
}

function matchedCompressionRange(fingerprints: string[], c: Compression) {
  const start = fingerprints.indexOf(c.startFingerprint || "")
  if (start < 0) return undefined
  const end = fingerprints.indexOf(c.endFingerprint || "", start)
  return end < start ? undefined : { start, end }
}

function reportRangeCompression(
  messages: AtmMessage[],
  c: Compression,
  range: { start: number; end: number },
  replacement: AtmMessage,
  report?: PruneReport,
) {
  const beforeTokens = estimateMessages(messages.slice(range.start, range.end + 1))
  const afterTokens = estimateMessages([replacement])
  report?.compressions.push({
    id: c.id,
    topic: c.topic,
    mode: c.mode,
    messages: range.end - range.start + 1,
    beforeTokens,
    afterTokens,
    savedTokens: Math.max(0, beforeTokens - afterTokens),
    startIndex: range.start,
    endIndex: range.end,
    consumedBlockIds: c.consumedBlockIds,
  })
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

function countByRole(messages: AtmMessage[]) {
  const counts: Record<string, number> = {}
  for (const m of messages) counts[m.role ?? "unknown"] = (counts[m.role ?? "unknown"] ?? 0) + 1
  return counts
}

export { normalizeCompressionRequests } from "./pruning-normalize.js"
export { sweepTools } from "./pruning-sweep.js"
export { estimateMessages, estimateText } from "./token-estimates.js"
