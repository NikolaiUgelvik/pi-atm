import { toolCallsOf } from "./message-guards.js"
import type { AtmMessage, Config } from "./types.js"

export function messageIsTurnProtected(messages: AtmMessage[], index: number, config: Config) {
  if (!config.turnProtection.enabled) return false
  const message = messages[index]
  if (!isToolRelated(message)) return false
  return userTurnsAfter(messages, index) < config.turnProtection.turns
}

function isToolRelated(message: AtmMessage | undefined) {
  return message?.role === "toolResult" || assistantHasToolCalls(message)
}

function assistantHasToolCalls(message: AtmMessage | undefined) {
  return message?.role === "assistant" && toolCallsOf(message).length > 0
}

function userTurnsAfter(messages: AtmMessage[], index: number) {
  return messages.slice(index + 1).filter((message) => message.role === "user").length
}
