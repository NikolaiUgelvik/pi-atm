import { fingerprintMessage } from "./message-fingerprint.js"
import type { AtmMessage } from "./types.js"

export function detectCompaction(messages: AtmMessage[]) {
  const compact = [...messages]
    .reverse()
    .find(
      (message) =>
        message.role === "assistant" &&
        (message.compacted ||
          message.isCompaction ||
          /\b(compacted|conversation summary|summary of the conversation)\b/i.test(
            textFromMessage(message).slice(0, 1000),
          )),
    )
  return compact ? fingerprintMessage(compact) : undefined
}

function textFromMessage(message: AtmMessage) {
  if (typeof message.content === "string") return message.content
  if (Array.isArray(message.content)) return message.content.map((part) => part.text ?? part.summary ?? "").join("\n")
  return String(message.summary ?? "")
}
