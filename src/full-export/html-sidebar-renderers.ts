import { escapeHtml } from "./html-escape.js"
import type { FullExportEvent, FullExportRenderInput } from "./types.js"

export const filterButtons: Array<{ label: string; filter: string }> = [
  { label: "all", filter: "all" },
  { label: "user/input", filter: "input" },
  { label: "assistant/message", filter: "message" },
  { label: "hidden/custom", filter: "hidden" },
  { label: "tool call", filter: "tool_call" },
  { label: "tool result", filter: "tool_result" },
  { label: "context", filter: "context" },
  { label: "provider request", filter: "provider_request" },
  { label: "provider response", filter: "provider_response" },
  { label: "ATM/session", filter: "atm_session" },
]

export function renderFilterButton(button: { label: string; filter: string }, index: number) {
  const active = index === 0 ? " active" : ""
  return `<button class="filter-btn${active}" data-filter="${escapeHtml(button.filter)}">${escapeHtml(button.label)}</button>`
}

export function renderWarnings(warnings: string[]) {
  return warnings.map((warning) => `<section class="warning-block">${escapeHtml(warning)}</section>`).join("\n")
}

export function renderFallback(fallback: NonNullable<FullExportRenderInput["fallback"]>) {
  return `<section class="fallback-block"><h2>Fallback export data</h2><p>Full recording was not available for all session history. Exact provider payloads and event history may be unavailable.</p><details open><summary>Fallback JSON</summary><pre>${escapeHtml(JSON.stringify(fallback, null, 2))}</pre></details></section>`
}

const treeRoleClasses: Partial<Record<FullExportEvent["kind"], string>> = {
  input: "tree-role-user",
  context: "tree-role-context",
  provider_request: "tree-role-provider",
  provider_response: "tree-role-provider",
}

function treeRoleClass(event: FullExportEvent) {
  return treeRoleClasses[event.kind] ?? fallbackTreeRoleClass(event.kind)
}

function fallbackTreeRoleClass(kind: FullExportEvent["kind"]) {
  if (kind.includes("message") || kind.includes("turn")) return "tree-role-assistant"
  if (kind.includes("tool")) return "tree-role-tool"
  return "tree-role-atm"
}

function shortTime(timestamp: string) {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return timestamp.slice(0, 19)
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

function sidebarPayloadRecord(event: FullExportEvent): Record<string, unknown> | undefined {
  return event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
    ? (event.payload as Record<string, unknown>)
    : undefined
}

function sidebarPreview(event: FullExportEvent) {
  const payload = sidebarPayloadRecord(event)
  const text = typeof payload?.text === "string" ? payload.text : JSON.stringify(event.payload)
  return (text ?? "").replace(/\s+/g, " ").slice(0, 180)
}

function sidebarSearchText(event: FullExportEvent) {
  return [
    event.kind,
    event.timestamp,
    event.provider,
    event.model,
    event.toolName,
    event.toolCallId,
    sidebarPreview(event),
  ]
    .filter(Boolean)
    .join(" ")
}

export function renderSidebarItem(event: FullExportEvent) {
  return `<a href="#${escapeHtml(event.id)}" class="tree-node" data-kind="${escapeHtml(event.kind)}" data-target="${escapeHtml(event.id)}" data-search="${escapeHtml(sidebarSearchText(event))}"><span class="tree-marker">•</span><span class="tree-time">${escapeHtml(shortTime(event.timestamp))}</span><span class="tree-content"><span class="${treeRoleClass(event)}">${escapeHtml(event.kind)}</span> ${escapeHtml(sidebarPreview(event))}</span></a>`
}
