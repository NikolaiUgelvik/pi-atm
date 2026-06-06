import { stableJson } from "./stable-json.js"
import type { AtmMessage, MessagePart } from "./types.js"

export function estimateText(s: string) {
  return Math.ceil((s || "").length / 4)
}

export function estimateMessages(ms: AtmMessage[]) {
  return ms.reduce((n, m) => n + estimateText(estimateableMessageText(m) + stableJson(m).slice(0, 2000)), 0)
}

function estimateableMessageText(message: AtmMessage | undefined): string {
  if (!message) return ""
  if (typeof message.content === "string") return message.content
  if (Array.isArray(message.content)) return message.content.map(partText).join("\n")
  if (typeof message.summary === "string") return message.summary
  if (typeof message.output === "string") return message.output
  return stableJson(message)
}

function partText(part: MessagePart) {
  if (typeof part.text === "string") return part.text
  if (typeof part.thinking === "string") return part.thinking
  if (part.type === "toolCall") return `${part.name ?? "tool"} ${stableJson(part.arguments)}`
  return ""
}
