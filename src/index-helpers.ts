import type { AtmMessage, RuntimeContext } from "./types.js"
import { clone, fingerprintMessage } from "./utils.js"

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

export function applyPendingManualTrigger(messages: AtmMessage[], pendingPrompt?: string) {
  if (!pendingPrompt) return { messages, changed: false, consumed: false }
  const out = clone(messages)
  for (let i = out.length - 1; i >= 0; i--) {
    const message = out[i]
    if (message?.role !== "user") continue
    if (typeof message.content === "string") {
      out[i] = { ...message, content: pendingPrompt }
      return { messages: out, changed: true, consumed: true }
    }
    if (Array.isArray(message.content)) {
      let textIndex = -1
      for (let j = message.content.length - 1; j >= 0; j--) {
        if (message.content[j]?.type === "text") {
          textIndex = j
          break
        }
      }
      const content = [...message.content]
      if (textIndex >= 0) {
        const existing = content[textIndex]
        if (existing) content[textIndex] = { ...existing, text: pendingPrompt }
      } else content.push({ type: "text", text: pendingPrompt })
      out[i] = { ...message, content }
      return { messages: out, changed: true, consumed: true }
    }
  }
  return { messages, changed: false, consumed: false }
}

export function parseCompressionId(value?: string) {
  const match = /^b?(\d+)$/.exec(value || "")
  return match ? Number(match[1]) : 0
}

export function toAtmMessages(messages: unknown): AtmMessage[] {
  return Array.isArray(messages) ? (messages as AtmMessage[]) : []
}

export function asRuntimeContext(ctx: unknown): RuntimeContext {
  return ctx as RuntimeContext
}

function textFromMessage(message: AtmMessage) {
  if (typeof message.content === "string") return message.content
  if (Array.isArray(message.content)) return message.content.map((part) => part.text ?? part.summary ?? "").join("\n")
  return String(message.summary ?? "")
}
