import { indexFromMessageOrBlockAlias } from "./compression-block-alias.js"
import { range } from "./index-range.js"
import { indexFromAlias } from "./message-id-alias.js"
import { messageTouchesProtectedToolOrFile } from "./protected-message.js"
import { messageIsTurnProtected } from "./pruning-protection.js"
import type {
  AtmMessage,
  CompressionMode,
  CompressionToolParams,
  Config,
  NormalizedCompressionRequest,
} from "./types.js"

export function normalizeCompressionRequests(
  messages: AtmMessage[],
  params: CompressionToolParams,
  config: Config,
): NormalizedCompressionRequest[] {
  const content = Array.isArray(params.content) ? params.content : []
  return content.length ? contentRequests(messages, params, config, content) : fallbackRequest(messages, params, config)
}

function fallbackRequest(messages: AtmMessage[], params: CompressionToolParams, config: Config) {
  const selected = selectCompressionTargets(messages, params, config)
  if (!selected.length || !params.summary) return []
  return [
    {
      mode: params.mode ?? config.compress.mode,
      selected,
      indexes: indexesForSelected(messages, selected),
      summary: params.summary,
      topic: params.topic,
    },
  ]
}

function indexesForSelected(messages: AtmMessage[], selected: AtmMessage[]) {
  return selected.map((message) => messages.indexOf(message)).filter((index) => index >= 0)
}

function contentRequests(
  messages: AtmMessage[],
  params: CompressionToolParams,
  config: Config,
  content: NonNullable<CompressionToolParams["content"]>,
) {
  const out: NormalizedCompressionRequest[] = []
  const used = new Set<number>()
  for (const item of content) addContentRequest(out, used, messages, params, config, item)
  return out
}

function addContentRequest(
  out: NormalizedCompressionRequest[],
  used: Set<number>,
  messages: AtmMessage[],
  params: CompressionToolParams,
  config: Config,
  item: NonNullable<CompressionToolParams["content"]>[number],
) {
  const mode: CompressionMode = params.mode ?? (item.messageId ? "message" : config.compress.mode)
  const indexes = eligibleIndexes(messages, indexesForItem(messages, item, mode), used, config)
  if (!indexes.length || !item.summary) return
  for (const index of indexes) used.add(index)
  out.push({
    mode,
    selected: indexes.map((index) => messages[index]).filter(isDefined),
    indexes,
    summary: item.summary,
    topic: item.topic ?? params.topic,
  })
}

function indexesForItem(
  messages: AtmMessage[],
  item: NonNullable<CompressionToolParams["content"]>[number],
  mode: CompressionMode,
) {
  if (mode === "message" && item.messageId) return indexFromMessageId(messages, item.messageId)
  return indexesFromRangeAliases(messages, item.startId, item.endId)
}

function indexFromMessageId(messages: AtmMessage[], messageId: string) {
  const index = indexFromAlias(messageId)
  return index >= 0 && index < messages.length ? [index] : []
}

function indexesFromRangeAliases(messages: AtmMessage[], startId: string | undefined, endId: string | undefined) {
  const start = indexFromMessageOrBlockAlias(messages, startId)
  const end = indexFromMessageOrBlockAlias(messages, endId)
  return start >= 0 && end >= start && end < messages.length ? range(start, end) : []
}

function eligibleIndexes(messages: AtmMessage[], indexes: number[], used: Set<number>, config: Config) {
  return indexes
    .filter((index) => index < messages.length - config.compress.keepRecentMessages && !used.has(index))
    .filter((index) => !isProtectedIndex(messages, index, config))
}

function isProtectedIndex(messages: AtmMessage[], index: number, config: Config) {
  return messageTouchesProtectedToolOrFile(messages, index, config) || messageIsTurnProtected(messages, index, config)
}

function selectCompressionTargets(messages: AtmMessage[], params: CompressionToolParams, config: Config) {
  const bounds = targetBounds(messages, params, config)
  if (bounds.end < bounds.start) return []
  return messages
    .slice(bounds.start, bounds.end + 1)
    .filter((_message, offset) => !isProtectedIndex(messages, bounds.start + offset, config))
}

function targetBounds(messages: AtmMessage[], params: CompressionToolParams, config: Config) {
  const keepRecent = params.keepRecentMessages ?? config.compress.keepRecentMessages
  const base = explicitBounds(messages, params, keepRecent)
  return clampBounds(messages, targetAdjustedBounds(messages, params, keepRecent, base))
}

function explicitBounds(messages: AtmMessage[], params: CompressionToolParams, keepRecent: number) {
  return {
    start: integerParam(params.startIndex) ?? 0,
    end: integerParam(params.endIndex) ?? messages.length - 1 - keepRecent,
  }
}

function integerParam(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined
}

function targetAdjustedBounds(
  messages: AtmMessage[],
  params: CompressionToolParams,
  keepRecent: number,
  bounds: { start: number; end: number },
) {
  if (params.target === "since_last_user") return { start: lastUserTailStart(messages), end: messages.length - 1 }
  if (params.target === "stale" || params.target === "all_except_recent" || !params.target) {
    return { ...bounds, end: Math.min(bounds.end, messages.length - 1 - keepRecent) }
  }
  return bounds
}

function lastUserTailStart(messages: AtmMessage[]) {
  return Math.max(0, messages.map((message) => message.role).lastIndexOf("user") + 1)
}

function clampBounds(messages: AtmMessage[], bounds: { start: number; end: number }) {
  return { start: Math.max(0, bounds.start), end: Math.min(messages.length - 1, bounds.end) }
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined
}
