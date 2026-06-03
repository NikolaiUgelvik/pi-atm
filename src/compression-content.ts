import type { AtmMessage, Compression, Config, MessagePart, ToolCallPart } from "./types.js"
import { compressionBlockId, isProtectedToolCall, textOf } from "./utils.js"

export function consumedBlockIdsForMessages(selected: AtmMessage[]) {
  return [...new Set(selected.map(compressionBlockId).filter((id): id is number => Number.isFinite(id)))]
}

export function appendConsumedSummaries(
  summary: string,
  selected: AtmMessage[],
  state: { compressions: Compression[] },
) {
  const consumed = consumedBlockIdsForMessages(selected)
  if (!consumed.length) return summary
  const missing = consumed
    .map((id) => state.compressions.find((c) => c.id === id))
    .filter((c): c is Compression => !!c && !summary.includes(c.summary))
  if (!missing.length) return summary
  return `${summary}\n\n## Previously Compressed Context Preserved\n${missing.map((c) => `### b${c.id}${c.topic ? ` — ${c.topic}` : ""}\n${c.summary}`).join("\n\n")}`
}

export function appendProtectedContent(summary: string, selected: AtmMessage[], config: Config) {
  const sections: string[] = []
  if (config.compress.protectUserMessages) {
    const users = selected
      .filter((m) => m.role === "user")
      .map(textOf)
      .filter(Boolean)
    if (users.length)
      sections.push(
        `## Preserved User Messages\n${users.map((u, i) => `### User message ${i + 1}\n${u}`).join("\n\n")}`,
      )
  }
  if (config.compress.protectTags) {
    const protectedText = selected.flatMap((m) => extractProtectTags(textOf(m)))
    if (protectedText.length)
      sections.push(
        `## Preserved <protect> Content\n${protectedText.map((t, i) => `### Protected block ${i + 1}\n${t}`).join("\n\n")}`,
      )
  }
  const protectedTools = protectedToolOutputs(selected, config)
  if (protectedTools.length)
    sections.push(
      `## Preserved Protected Tool Outputs\n${protectedTools.map((t, i) => `### ${t.name || "tool"} ${i + 1}${t.callId ? ` (${t.callId})` : ""}\n${t.output}`).join("\n\n")}`,
    )
  return sections.length ? `${summary}\n\n${sections.join("\n\n")}` : summary
}

function protectedToolOutputs(selected: AtmMessage[], config: Config) {
  const out: Array<{ name?: string; callId?: string; output: string }> = []
  const assistantCalls = new Map<string, ToolCallPart>()
  for (const m of selected) {
    if (m.role !== "assistant" || !Array.isArray(m.content)) continue
    for (const part of m.content) if (isToolCallWithId(part)) assistantCalls.set(part.id, part)
  }
  for (const m of selected) {
    if (m.role !== "toolResult") continue
    const tc = m.toolCallId ? (assistantCalls.get(m.toolCallId) ?? syntheticToolCall(m)) : syntheticToolCall(m)
    if (!isProtectedToolCall(tc, config)) continue
    const output = textOf(m).trim()
    if (output) out.push({ name: m.toolName ?? tc.name, callId: m.toolCallId, output })
  }
  return out
}

function isToolCallWithId(part: MessagePart): part is ToolCallPart & { id: string } {
  return part.type === "toolCall" && typeof part.id === "string" && part.id.length > 0
}

function syntheticToolCall(m: AtmMessage): ToolCallPart {
  return {
    type: "toolCall",
    id: m.toolCallId,
    name: m.toolName,
    arguments: m.arguments ?? m.input,
  }
}

function extractProtectTags(text: string) {
  const out: string[] = []
  for (const m of (text || "").matchAll(/<protect>([\s\S]*?)<\/protect>/gi)) out.push(m[1].trim())
  return out.filter(Boolean)
}
