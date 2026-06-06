import type { AtmMessage, MessagePart, RuntimeContext } from "./types.js"
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
  if (!pendingPrompt) return unchanged(messages)
  const out = clone(messages)
  const index = lastUserMessageIndex(out)
  if (index < 0) return unchanged(messages)
  out[index] = withPrompt(out[index], pendingPrompt)
  return { messages: out, changed: true, consumed: true }
}

function unchanged(messages: AtmMessage[]) {
  return { messages, changed: false, consumed: false }
}

function lastUserMessageIndex(messages: AtmMessage[]) {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === "user") return index
  }
  return -1
}

function withPrompt(message: AtmMessage | undefined, pendingPrompt: string): AtmMessage {
  if (!message) return { role: "user", content: pendingPrompt }
  if (typeof message.content === "string") return { ...message, content: pendingPrompt }
  if (Array.isArray(message.content)) return { ...message, content: contentWithPrompt(message.content, pendingPrompt) }
  return { ...message, content: pendingPrompt }
}

function contentWithPrompt(content: MessagePart[], pendingPrompt: string) {
  const next = [...content]
  const index = lastTextPartIndex(next)
  if (index < 0) return [...next, { type: "text", text: pendingPrompt }]
  const existing = next[index]
  next[index] = existing ? { ...existing, text: pendingPrompt } : { type: "text", text: pendingPrompt }
  return next
}

function lastTextPartIndex(content: MessagePart[]) {
  for (let index = content.length - 1; index >= 0; index--) {
    if (content[index]?.type === "text") return index
  }
  return -1
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
