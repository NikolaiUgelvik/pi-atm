import type { AtmMessage } from "./types.js"

export function hasToolCallId(message: AtmMessage): message is AtmMessage & { toolCallId: string } {
  return typeof message.toolCallId === "string" && message.toolCallId.length > 0
}

export function isToolResultWithId(message: AtmMessage): message is AtmMessage & { toolCallId: string } {
  return message.role === "toolResult" && hasToolCallId(message)
}
