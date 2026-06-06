import { compressionBlockId } from "./compression-block-alias.js"
import { textOf } from "./message-text.js"
import { isProtectedToolCall } from "./protected-tool-call.js"
import type { AtmMessage, Compression, Config, MessagePart, ToolCallPart } from "./types.js"

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
  return `${summary}\n\n## Previously Compressed Context Preserved\n${missing.map(formatConsumedSummary).join("\n\n")}`
}

function formatConsumedSummary(c: Compression) {
  return `### b${c.id}${c.topic ? ` — ${c.topic}` : ""}\n${c.summary}`
}

export function appendProtectedContent(summary: string, selected: AtmMessage[], config: Config) {
  const sections = [
    userMessageSection(selected, config),
    protectTagSection(selected, config),
    protectedToolSection(selected, config),
  ]
    .filter(Boolean)
    .join("\n\n")
  return sections ? `${summary}\n\n${sections}` : summary
}

function userMessageSection(selected: AtmMessage[], config: Config) {
  if (!config.compress.protectUserMessages) return ""
  const users = selected
    .filter((m) => m.role === "user")
    .map(textOf)
    .filter(Boolean)
  return users.length ? `## Preserved User Messages\n${users.map(formatUserMessage).join("\n\n")}` : ""
}

function formatUserMessage(text: string, index: number) {
  return `### User message ${index + 1}\n${text}`
}

function protectTagSection(selected: AtmMessage[], config: Config) {
  if (!config.compress.protectTags) return ""
  const protectedText = selected.flatMap((m) => extractProtectTags(textOf(m)))
  return protectedText.length
    ? `## Preserved <protect> Content\n${protectedText.map(formatProtectedBlock).join("\n\n")}`
    : ""
}

function formatProtectedBlock(text: string, index: number) {
  return `### Protected block ${index + 1}\n${text}`
}

function protectedToolSection(selected: AtmMessage[], config: Config) {
  const protectedTools = protectedToolOutputs(selected, config)
  return protectedTools.length
    ? `## Preserved Protected Tool Outputs\n${protectedTools.map(formatProtectedTool).join("\n\n")}`
    : ""
}

function formatProtectedTool(tool: { name?: string; callId?: string; output: string }, index: number) {
  return `### ${tool.name || "tool"} ${index + 1}${tool.callId ? ` (${tool.callId})` : ""}\n${tool.output}`
}

function protectedToolOutputs(selected: AtmMessage[], config: Config) {
  const assistantCalls = collectAssistantToolCalls(selected)
  return selected.flatMap((message) => protectedToolOutputFor(message, assistantCalls, config))
}

function collectAssistantToolCalls(selected: AtmMessage[]) {
  const assistantCalls = new Map<string, ToolCallPart>()
  for (const message of selected.filter(isAssistantWithContent)) {
    for (const part of message.content) if (isToolCallWithId(part)) assistantCalls.set(part.id, part)
  }
  return assistantCalls
}

function isAssistantWithContent(message: AtmMessage): message is AtmMessage & { content: MessagePart[] } {
  return message.role === "assistant" && Array.isArray(message.content)
}

function protectedToolOutputFor(
  message: AtmMessage,
  assistantCalls: Map<string, ToolCallPart>,
  config: Config,
): Array<{ name?: string; callId?: string; output: string }> {
  if (message.role !== "toolResult") return []
  const toolCall = pairedToolCall(message, assistantCalls)
  if (!isProtectedToolCall(toolCall, config)) return []
  const output = textOf(message).trim()
  return output ? [{ name: message.toolName ?? toolCall.name, callId: message.toolCallId, output }] : []
}

function pairedToolCall(message: AtmMessage, assistantCalls: Map<string, ToolCallPart>) {
  return message.toolCallId
    ? (assistantCalls.get(message.toolCallId) ?? syntheticToolCall(message))
    : syntheticToolCall(message)
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
