import { matchesAny } from "./glob-patterns.js"
import { textOf } from "./message-text.js"
import { isProtectedToolCall } from "./protected-tool-call.js"
import { toolSet } from "./protected-tool-set.js"
import { messageIsTurnProtected } from "./pruning-protection.js"
import { stableJson } from "./stable-json.js"
import { estimateMessages } from "./token-estimates.js"
import { findToolCallIndex, normalizeToolArgs, toolCallFor, toolCallKey } from "./tool-call-lookup.js"
import { isToolCallWithId, toolCallsOf } from "./tool-call-parts.js"
import { pruneFailedToolInput } from "./tool-pruning.js"
import { hasToolCallId } from "./tool-result-guards.js"
import type { AtmMessage, Config, MessagePart, PruneReport, State } from "./types.js"

export function applyDeduplication(messages: AtmMessage[], config: Config, state: State, report?: PruneReport) {
  if (!config.strategies.deduplication.enabled) return messages
  const protectedTools = toolSet(config.strategies.deduplication.protectedTools)
  const lastByCall = collectLatestToolCalls(messages, config, protectedTools)
  return messages.map((message, index) =>
    dedupeMessage(messages, index, message, { config, state, report, protectedTools, lastByCall }),
  )
}

function collectLatestToolCalls(messages: AtmMessage[], config: Config, protectedTools: Set<string>) {
  const lastByCall = new Map<string, number>()
  messages.forEach((message, index) => {
    collectAssistantToolCalls(message, index, config, protectedTools, lastByCall)
  })
  return lastByCall
}

function collectAssistantToolCalls(
  message: AtmMessage,
  index: number,
  config: Config,
  protectedTools: Set<string>,
  lastByCall: Map<string, number>,
) {
  if (message.role !== "assistant") return
  for (const toolCall of toolCallsOf(message)) {
    if (isDedupCandidateToolCall(toolCall, config, protectedTools)) lastByCall.set(toolCallKeyFromPart(toolCall), index)
  }
}

function isDedupCandidateToolCall(
  toolCall: ReturnType<typeof toolCallsOf>[number],
  config: Config,
  protectedTools: Set<string>,
) {
  return !matchesAny(toolCall.name, protectedTools) && !isProtectedToolCall(toolCall, config)
}

function toolCallKeyFromPart(toolCall: ReturnType<typeof toolCallsOf>[number]) {
  return `${toolCall.name}:${stableJson(normalizeToolArgs(toolCall.arguments ?? {}))}`
}

type DedupeContext = {
  config: Config
  state: State
  report?: PruneReport
  protectedTools: Set<string>
  lastByCall: Map<string, number>
}

function dedupeMessage(messages: AtmMessage[], index: number, message: AtmMessage, ctx: DedupeContext) {
  const info = dedupeInfo(messages, index, message, ctx)
  if (!info) return message
  ctx.state.stats.dedupePrunes++
  ctx.report?.dedupe.push(info.report)
  return info.replacement
}

function dedupeInfo(messages: AtmMessage[], index: number, message: AtmMessage, ctx: DedupeContext) {
  if (!isDedupeEligibleResult(messages, index, message, ctx.config, ctx.protectedTools)) return undefined
  const callIndex = findToolCallIndex(messages, message.toolCallId)
  const key = toolCallKey(messages[callIndex], message.toolCallId)
  const keptCallIndex = key ? ctx.lastByCall.get(key) : undefined
  if (!key || keptCallIndex === undefined || keptCallIndex === callIndex) return undefined
  return dedupeReplacement(message, callIndex, keptCallIndex)
}

function isDedupeEligibleResult(
  messages: AtmMessage[],
  index: number,
  message: AtmMessage,
  config: Config,
  protectedTools: Set<string>,
): message is AtmMessage & { toolCallId: string } {
  return (
    message.role === "toolResult" &&
    hasToolCallId(message) &&
    !matchesAny(message.toolName, protectedTools) &&
    !messageIsTurnProtected(messages, index, config) &&
    !isProtectedToolCall(
      toolCallFor(messages[findToolCallIndex(messages, message.toolCallId)], message.toolCallId),
      config,
    )
  )
}

function dedupeReplacement(message: AtmMessage & { toolCallId: string }, callIndex: number, keptCallIndex: number) {
  const replacement: AtmMessage = {
    ...message,
    content: [{ type: "text", text: "[Output removed to save context - information superseded or no longer needed]" }],
  }
  const beforeTokens = estimateMessages([message])
  const afterTokens = estimateMessages([replacement])
  return {
    replacement,
    report: {
      toolName: message.toolName ?? "unknown",
      callIndex,
      keptCallIndex,
      beforeTokens,
      afterTokens,
      savedTokens: Math.max(0, beforeTokens - afterTokens),
    },
  }
}

export function applyErrorPurging(messages: AtmMessage[], config: Config, state: State, report?: PruneReport) {
  if (!config.strategies.purgeErrors.enabled) return messages
  const protectedTools = toolSet(config.strategies.purgeErrors.protectedTools)
  const staleErrored = staleErroredToolResults(messages, config, protectedTools)
  if (!staleErrored.size) return messages
  return messages.map((message) => purgeErrorMessage(message, staleErrored, state, report))
}

type StaleErroredTool = { toolName: string; userTurnsAfter: number; excerpt: string }

function staleErroredToolResults(messages: AtmMessage[], config: Config, protectedTools: Set<string>) {
  const staleErrored = new Map<string, StaleErroredTool>()
  messages.forEach((message, index) => {
    collectStaleErroredTool(messages, index, message, config, protectedTools, staleErrored)
  })
  return staleErrored
}

function collectStaleErroredTool(
  messages: AtmMessage[],
  index: number,
  message: AtmMessage,
  config: Config,
  protectedTools: Set<string>,
  staleErrored: Map<string, StaleErroredTool>,
) {
  const info = staleErroredInfo(messages, index, message, config, protectedTools)
  if (info) staleErrored.set(info.toolCallId, info)
}

function staleErroredInfo(
  messages: AtmMessage[],
  index: number,
  message: AtmMessage,
  config: Config,
  protectedTools: Set<string>,
) {
  if (!isPurgeEligibleError(messages, index, message, config, protectedTools)) return undefined
  const userTurnsAfter = messages.slice(index + 1).filter((item) => item.role === "user").length
  if (userTurnsAfter < config.strategies.purgeErrors.turns) return undefined
  return {
    toolCallId: message.toolCallId,
    toolName: message.toolName ?? "unknown",
    userTurnsAfter,
    excerpt: textOf(message).slice(0, 500),
  }
}

function isPurgeEligibleError(
  messages: AtmMessage[],
  index: number,
  message: AtmMessage,
  config: Config,
  protectedTools: Set<string>,
): message is AtmMessage & { toolCallId: string } {
  return (
    message.role === "toolResult" &&
    hasToolCallId(message) &&
    message.isError === true &&
    !matchesAny(message.toolName, protectedTools) &&
    !messageIsTurnProtected(messages, index, config) &&
    !isProtectedToolCall(
      toolCallFor(messages[findToolCallIndex(messages, message.toolCallId)], message.toolCallId),
      config,
    )
  )
}

function purgeErrorMessage(
  message: AtmMessage,
  staleErrored: Map<string, StaleErroredTool>,
  state: State,
  report?: PruneReport,
) {
  if (isAssistantWithContent(message)) return purgeAssistantErrorCalls(message, staleErrored)
  if (message.role !== "toolResult" || !hasToolCallId(message)) return message
  const info = staleErrored.get(message.toolCallId)
  if (!info) return message
  state.stats.errorPrunes++
  const replacement = errorReplacement(message, info)
  report?.errors.push(errorReport(message, replacement, info))
  return replacement
}

function isAssistantWithContent(message: AtmMessage): message is AtmMessage & { content: MessagePart[] } {
  return message.role === "assistant" && Array.isArray(message.content)
}

function purgeAssistantErrorCalls(
  message: AtmMessage & { content: MessagePart[] },
  staleErrored: Map<string, StaleErroredTool>,
) {
  return {
    ...message,
    content: message.content.map((part) =>
      isToolCallWithId(part) && staleErrored.has(part.id)
        ? { ...part, arguments: pruneFailedToolInput(part.arguments ?? {}) }
        : part,
    ),
  }
}

function errorReplacement(message: AtmMessage, info: StaleErroredTool): AtmMessage {
  return {
    ...message,
    content: [
      {
        type: "text",
        text: `[Pruned stale errored ${info.toolName} result after ${info.userTurnsAfter} user turns. Error excerpt: ${info.excerpt}]`,
      },
    ],
  }
}

function errorReport(message: AtmMessage, replacement: AtmMessage, info: StaleErroredTool) {
  const beforeTokens = estimateMessages([message])
  const afterTokens = estimateMessages([replacement])
  return {
    toolName: info.toolName,
    userTurnsAfter: info.userTurnsAfter,
    beforeTokens,
    afterTokens,
    savedTokens: Math.max(0, beforeTokens - afterTokens),
    excerpt: info.excerpt,
  }
}
