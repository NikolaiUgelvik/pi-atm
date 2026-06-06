import type { AtmMessage, MessagePart, MutableRecord, ToolCallPart } from "./types.js"

export function findToolCallIndex(messages: AtmMessage[], id: string) {
  return messages.findIndex(
    (m) => m.role === "assistant" && Array.isArray(m.content) && m.content.some((part) => isToolCallWithId(part, id)),
  )
}

function isToolCall(part: MessagePart): part is ToolCallPart {
  return part.type === "toolCall"
}

function isToolCallWithId(part: MessagePart, id: string): part is ToolCallPart {
  return isToolCall(part) && part.id === id
}

export function toolCallFor(m: AtmMessage | undefined, id: string): ToolCallPart | undefined {
  if (!Array.isArray(m?.content)) return undefined
  return m.content.find((part): part is ToolCallPart => isToolCallWithId(part, id))
}

export function normalizeToolArgs(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normalizeToolArgs)
  if (!v || typeof v !== "object") return v
  const out: MutableRecord = {}
  for (const key of Object.keys(v).sort()) {
    const value = (v as MutableRecord)[key]
    if (value === null || value === undefined) continue
    out[key] = normalizeToolArgs(value)
  }
  return out
}

export function toolCallKey(m: AtmMessage | undefined, id: string) {
  const tc = toolCallFor(m, id)
  return tc ? `${tc.name}:${JSON.stringify(normalizeToolArgs(tc.arguments ?? {}))}` : undefined
}
