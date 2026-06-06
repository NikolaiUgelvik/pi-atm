import { escapeHtml } from "./html-escape.js"
import type { FullExportEvent } from "./types.js"

export function payloadRecord(event: FullExportEvent): Record<string, unknown> | undefined {
  return event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
    ? (event.payload as Record<string, unknown>)
    : undefined
}

function nestedRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

export function contentText(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content.map(contentBlockText).filter(Boolean).join("\n")
}

function contentBlockText(item: unknown) {
  const block = nestedRecord(item)
  if (!block) return ""
  if (typeof block.text === "string") return block.text
  if (typeof block.thinking === "string") return block.thinking
  if (block.type === "toolCall" && typeof block.name === "string") return `[tool: ${block.name}]`
  return ""
}

export function messageFromPayload(event: FullExportEvent): Record<string, unknown> | undefined {
  return nestedRecord(payloadRecord(event)?.message)
}

export function inputText(event: FullExportEvent): string | undefined {
  const payload = payloadRecord(event)
  return typeof payload?.text === "string" ? payload.text : undefined
}

export function preview(event: FullExportEvent) {
  const text = inputText(event) ?? messageText(event) ?? fallbackText(event)
  return text.replace(/\s+/g, " ").slice(0, 180)
}

function messageText(event: FullExportEvent) {
  return contentText(messageFromPayload(event)?.content) || undefined
}

function fallbackText(event: FullExportEvent) {
  return typeof event.payload === "string" ? event.payload : JSON.stringify(event.payload)
}

function metadata(event: FullExportEvent) {
  return [event.provider, event.model, event.toolName, event.toolCallId]
    .filter(Boolean)
    .map((value) => escapeHtml(String(value)))
    .join(" · ")
}

function searchText(event: FullExportEvent) {
  return searchParts(event).filter(Boolean).join(" ")
}

function searchParts(event: FullExportEvent) {
  return [
    event.kind,
    event.timestamp,
    event.provider,
    event.model,
    event.toolName,
    event.toolCallId,
    preview(event),
    JSON.stringify(event.payload),
  ]
}

export function rawDetails(event: FullExportEvent) {
  return `<details class="raw-json"><summary>Raw JSON</summary><pre>${escapeHtml(JSON.stringify(event.payload, null, 2))}</pre></details>`
}

export function entryAttrs(event: FullExportEvent, className: string) {
  return `class="${className} export-entry" id="${escapeHtml(event.id)}" data-kind="${escapeHtml(event.kind)}" data-search="${escapeHtml(searchText(event))}"`
}

export function entryHeader(event: FullExportEvent, label: string) {
  const meta = metadata(event)
  return `<div class="message-timestamp">${escapeHtml(event.timestamp)}</div><div class="entry-label">${escapeHtml(label)}</div>${meta ? `<div class="entry-meta">${meta}</div>` : ""}`
}
