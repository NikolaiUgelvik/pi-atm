import { clone } from "./clone.js"
import type { AtmMessage, MessagePart } from "./types.js"

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
