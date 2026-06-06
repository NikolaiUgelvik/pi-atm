import {
  hasPartId,
  hasToolCallId,
  isToolCall,
  isToolCallWithId,
  isToolResultWithId,
  toolCallsOf,
} from "./message-guards.js"
import type { AtmMessage, MessagePart } from "./types.js"
import { EXT } from "./types.js"
import { escapeAttr, textOf } from "./utils.js"

type ToolRange = { start: number; end: number }
type ExpandedToolRange = ToolRange & { changed: boolean }

export function expandRangeToToolBoundaries(messages: AtmMessage[], start: number, end: number) {
  let range: ToolRange = { start, end }
  let next = expandRangeOnce(messages, range)
  while (next.changed) {
    range = { start: next.start, end: next.end }
    next = expandRangeOnce(messages, range)
  }
  return range
}

function expandRangeOnce(messages: AtmMessage[], range: ToolRange) {
  const removed = removedToolIds(messages, range)
  const initial: ExpandedToolRange = { ...range, changed: false }
  return messages.reduce<ExpandedToolRange>(
    (expanded, message, index) => includeToolPairBoundary(expanded, message, index, removed),
    initial,
  )
}

function removedToolIds(messages: AtmMessage[], range: ToolRange) {
  const toolCalls = new Set<string>()
  const toolResults = new Set<string>()
  for (let index = range.start; index <= range.end; index++) addRemovedToolIds(messages[index], toolCalls, toolResults)
  return { toolCalls, toolResults }
}

function addRemovedToolIds(message: AtmMessage | undefined, toolCalls: Set<string>, toolResults: Set<string>) {
  if (message?.role === "assistant") addAssistantToolCalls(message, toolCalls)
  if (message?.role === "toolResult" && hasToolCallId(message)) toolResults.add(message.toolCallId)
}

function addAssistantToolCalls(message: AtmMessage, out: Set<string>) {
  for (const toolCall of toolCallsOf(message).filter(hasPartId)) out.add(toolCall.id)
}

function includeToolPairBoundary(
  range: ExpandedToolRange,
  message: AtmMessage,
  index: number,
  removed: { toolCalls: Set<string>; toolResults: Set<string> },
) {
  if (index >= range.start && index <= range.end) return range
  if (!mustIncludeToolPair(message, removed)) return range
  return { start: Math.min(range.start, index), end: Math.max(range.end, index), changed: true }
}

function mustIncludeToolPair(message: AtmMessage, removed: { toolCalls: Set<string>; toolResults: Set<string> }) {
  return (
    toolResultCompletesRemovedCall(message, removed.toolCalls) ||
    assistantCallsRemovedResult(message, removed.toolResults)
  )
}

function toolResultCompletesRemovedCall(message: AtmMessage, removedToolCalls: Set<string>) {
  return message.role === "toolResult" && hasToolCallId(message) && removedToolCalls.has(message.toolCallId)
}

function assistantCallsRemovedResult(message: AtmMessage, removedToolResults: Set<string>) {
  return (
    message.role === "assistant" &&
    toolCallsOf(message)
      .filter(hasPartId)
      .some((toolCall) => removedToolResults.has(toolCall.id))
  )
}

export function sanitizeToolPairing(messages: AtmMessage[]) {
  const resultIds = new Set(messages.filter(isToolResultWithId).map((message) => message.toolCallId))
  const seenToolCalls = new Set<string>()
  return messages.map((message) => sanitizeToolPairingMessage(message, resultIds, seenToolCalls))
}

function sanitizeToolPairingMessage(message: AtmMessage, resultIds: Set<string>, seenToolCalls: Set<string>) {
  if (message.role === "assistant") return sanitizeAssistantToolCalls(message, resultIds, seenToolCalls)
  if (isSeenOrNonToolResult(message, seenToolCalls)) return message
  return orphanToolResultMessage(message)
}

function sanitizeAssistantToolCalls(message: AtmMessage, resultIds: Set<string>, seenToolCalls: Set<string>) {
  const content = Array.isArray(message.content) ? message.content : []
  const filtered = content.filter((part) => !isToolCall(part) || !part.id || resultIds.has(part.id))
  for (const toolCall of filtered.filter(isToolCallWithId)) seenToolCalls.add(toolCall.id)
  return filtered.length === content.length ? message : { ...message, content: replacementAssistantContent(filtered) }
}

function replacementAssistantContent(filtered: MessagePart[]) {
  return filtered.length
    ? filtered
    : [{ type: "text", text: "[Tool call removed because its paired result was compressed/pruned.]" }]
}

function isSeenOrNonToolResult(message: AtmMessage, seenToolCalls: Set<string>) {
  return message.role !== "toolResult" || !hasToolCallId(message) || seenToolCalls.has(message.toolCallId)
}

function orphanToolResultMessage(message: AtmMessage): AtmMessage {
  return {
    role: "custom",
    customType: EXT,
    display: false,
    timestamp: message.timestamp,
    content: `<orphan-tool-result tool="${escapeAttr(message.toolName ?? "unknown")}" call_id="${escapeAttr(message.toolCallId ?? "")}">\n${textOf(message)}\n</orphan-tool-result>`,
  }
}
