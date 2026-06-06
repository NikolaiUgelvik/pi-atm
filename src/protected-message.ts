import { isProtectedToolCall } from "./protected-tool-call.js"
import { findToolCallIndex, toolCallFor } from "./tool-call-lookup.js"
import type { AtmMessage, Config, ToolCallPart } from "./types.js"

export function messageTouchesProtectedToolOrFile(messages: AtmMessage[], index: number, config: Config) {
  const message = messages[index]
  if (message?.role === "assistant" && Array.isArray(message.content))
    return assistantTouchesProtected(message.content, config)
  if (message?.role === "toolResult" && message.toolCallId)
    return toolResultTouchesProtected(messages, message.toolCallId, config)
  return false
}

function assistantTouchesProtected(content: unknown[], config: Config) {
  return content.some((part) => isToolCall(part) && isProtectedToolCall(part, config))
}

function toolResultTouchesProtected(messages: AtmMessage[], toolCallId: string, config: Config) {
  return isProtectedToolCall(toolCallFor(messages[findToolCallIndex(messages, toolCallId)], toolCallId), config)
}

function isToolCall(part: unknown): part is ToolCallPart {
  return !!part && typeof part === "object" && (part as ToolCallPart).type === "toolCall"
}
