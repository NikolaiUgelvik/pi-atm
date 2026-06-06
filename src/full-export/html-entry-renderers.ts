import { escapeHtml } from "./html-escape.js"
import {
  contentText,
  entryAttrs,
  entryHeader,
  inputText,
  messageFromPayload,
  payloadRecord,
  preview,
  rawDetails,
} from "./html-renderer-shared.js"
import type { FullExportEvent } from "./types.js"

function renderInputEvent(event: FullExportEvent) {
  return `<article ${entryAttrs(event, "user-message")}>${entryHeader(event, "user")}<div class="entry-preview">${escapeHtml(inputText(event) ?? preview(event))}</div>${rawDetails(event)}</article>`
}

function messageRole(event: FullExportEvent) {
  const role = messageFromPayload(event)?.role
  return typeof role === "string" ? role : "assistant"
}

function assistantText(event: FullExportEvent) {
  return contentText(messageFromPayload(event)?.content) || preview(event)
}

function renderAssistantEvent(event: FullExportEvent) {
  return `<article ${entryAttrs(event, "assistant-message")}><div class="message-timestamp">${escapeHtml(event.timestamp)}</div><div class="assistant-text"><span class="entry-label">${escapeHtml(messageRole(event))} · ${escapeHtml(event.kind)}</span><div class="entry-preview">${escapeHtml(assistantText(event))}</div>${rawDetails(event)}</div></article>`
}

const toolStatusByKind: Partial<Record<FullExportEvent["kind"], string>> = {
  tool_execution_start: "pending",
  tool_execution_update: "pending",
}

function payloadHasError(payload: Record<string, unknown> | undefined) {
  return [payload?.isError, payload?.error].includes(true)
}

function completedToolStatus(payload: Record<string, unknown> | undefined) {
  return payloadHasError(payload) ? "error" : "success"
}

function toolStatusClass(event: FullExportEvent, payload: Record<string, unknown> | undefined) {
  return toolStatusByKind[event.kind] ?? completedToolStatus(payload)
}

function renderToolEvent(event: FullExportEvent) {
  const payload = payloadRecord(event)
  const label = event.toolName ?? event.kind
  return `<article ${entryAttrs(event, `tool-execution ${toolStatusClass(event, payload)}`)}>${entryHeader(event, label)}<div class="tool-output">${escapeHtml(preview(event))}</div>${rawDetails(event)}</article>`
}

function messageCount(value: unknown) {
  return Array.isArray(value) ? value.length : undefined
}

function contextMessageCounts(event: FullExportEvent) {
  const payload = payloadRecord(event)
  return [messageCount(payload?.originalMessages), messageCount(payload?.transformedMessages)] as const
}

function hasContextCounts(counts: readonly [number | undefined, number | undefined]) {
  return counts.some((count) => count !== undefined)
}

function contextCountsText(event: FullExportEvent) {
  const counts = contextMessageCounts(event)
  return hasContextCounts(counts) ? `original ${counts[0] ?? 0} · transformed ${counts[1] ?? 0}` : preview(event)
}

function renderContextEvent(event: FullExportEvent) {
  return `<article ${entryAttrs(event, "context-audit")}>${entryHeader(event, "context rewrite")}<div class="entry-preview">${escapeHtml(contextCountsText(event))}</div>${rawDetails(event)}</article>`
}

const providerLabels: Partial<Record<FullExportEvent["kind"], string>> = {
  provider_request: "provider request · exact payload before send",
  provider_response: "provider response",
}

function renderProviderEvent(event: FullExportEvent) {
  const label = providerLabels[event.kind] ?? event.kind
  return `<article ${entryAttrs(event, "provider-audit")}>${entryHeader(event, label)}<div class="entry-preview">${escapeHtml(preview(event))}</div>${rawDetails(event)}</article>`
}

function renderAtmEvent(event: FullExportEvent) {
  return `<article ${entryAttrs(event, "atm-audit")}>${entryHeader(event, event.kind)}<div class="entry-preview">${escapeHtml(preview(event))}</div>${rawDetails(event)}</article>`
}

function renderSystemEvent(event: FullExportEvent) {
  return `<article ${entryAttrs(event, "system-audit")}>${entryHeader(event, event.kind)}<div class="entry-preview">${escapeHtml(preview(event))}</div>${rawDetails(event)}</article>`
}

const eventEntryRenderers: Partial<Record<FullExportEvent["kind"], (event: FullExportEvent) => string>> = {
  input: renderInputEvent,
  before_agent_start: renderAssistantEvent,
  turn_start: renderAssistantEvent,
  turn_end: renderAssistantEvent,
  message_start: renderAssistantEvent,
  message_update: renderAssistantEvent,
  message_end: renderAssistantEvent,
  tool_execution_start: renderToolEvent,
  tool_execution_update: renderToolEvent,
  tool_execution_end: renderToolEvent,
  tool_call: renderToolEvent,
  tool_result: renderToolEvent,
  context: renderContextEvent,
  provider_request: renderProviderEvent,
  provider_response: renderProviderEvent,
  atm_state: renderAtmEvent,
  session_start: renderAtmEvent,
  session_shutdown: renderAtmEvent,
}

export function renderEventEntry(event: FullExportEvent) {
  return (eventEntryRenderers[event.kind] ?? renderSystemEvent)(event)
}
