import { stableJson } from "./stable-json.js"
import type { AtmMessage, MessagePart } from "./types.js"

export function textOf(m: AtmMessage | undefined): string {
  if (!m) return ""
  if (typeof m.content === "string") return m.content
  if (Array.isArray(m.content)) return m.content.map(textFromPart).join("\n")
  if (typeof m.summary === "string") return m.summary
  if (typeof m.output === "string") return m.output
  return stableJson(m)
}

function textFromPart(part: MessagePart) {
  if (typeof part.text === "string") return part.text
  if (typeof part.thinking === "string") return part.thinking
  if (part.type === "toolCall") return `${part.name ?? "tool"} ${stableJson(part.arguments)}`
  return ""
}
