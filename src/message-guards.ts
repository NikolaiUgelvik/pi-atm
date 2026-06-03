import type { AtmMessage, MessagePart, ToolCallPart } from "./types.js"

export function isToolCall(part: MessagePart): part is ToolCallPart {
  return part.type === "toolCall"
}

export function isToolCallWithId(part: MessagePart): part is ToolCallPart & { id: string } {
  return isToolCall(part) && typeof part.id === "string" && part.id.length > 0
}

export function hasPartId(part: ToolCallPart): part is ToolCallPart & { id: string } {
  return typeof part.id === "string" && part.id.length > 0
}

export function toolCallsOf(message: AtmMessage | undefined): ToolCallPart[] {
  return Array.isArray(message?.content) ? message.content.filter(isToolCall) : []
}

export function hasToolCallId(message: AtmMessage): message is AtmMessage & { toolCallId: string } {
  return typeof message.toolCallId === "string" && message.toolCallId.length > 0
}

export function isToolResultWithId(message: AtmMessage): message is AtmMessage & { toolCallId: string } {
  return message.role === "toolResult" && hasToolCallId(message)
}

export function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined
}
