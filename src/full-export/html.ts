import { fullExportCss } from "./html-css.js"
import {
  escapeHtml,
  escapeScriptJson,
  filterButtons,
  renderEventEntry,
  renderFallback,
  renderFilterButton,
  renderSidebarItem,
  renderWarnings,
} from "./html-renderers.js"
import { fullExportClientScript } from "./html-script.js"
import type { FullExportRenderInput } from "./types.js"

export function renderFullExportHtml(input: FullExportRenderInput) {
  const payload = JSON.stringify({ events: input.events, fallback: input.fallback, warnings: input.warnings })
  const entries = input.events.map(renderEventEntry).join("\n")
  const sidebarRows = input.events.map(renderSidebarItem).join("\n")
  const warnings = renderWarnings(input.warnings)
  const fallback = input.fallback ? renderFallback(input.fallback) : ""
  const empty = input.events.length
    ? ""
    : '<section class="no-events"><h2>No recorded events</h2><p>No recorded full export events matched this export.</p></section>'

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ATM Full Export</title>
<style>${fullExportCss()}</style>
</head>
<body>
<script id="atm-export-data" type="application/json">${escapeScriptJson(payload)}</script>
<div id="app">
<aside id="sidebar">
  <div class="sidebar-header">
    <h1>ATM Full Export</h1>
    <div class="sidebar-meta">Generated ${escapeHtml(input.generatedAt)}</div>
    <div class="sidebar-meta">Session ${escapeHtml(input.sessionKey)}</div>
    <div class="sidebar-meta">cwd ${escapeHtml(input.cwd)}</div>
  </div>
  <div class="sidebar-controls"><input id="search" class="sidebar-search" type="search" placeholder="Search events" /></div>
  <div class="sidebar-filters">${filterButtons.map(renderFilterButton).join("")}</div>
  <nav class="tree-container">${sidebarRows}</nav>
  <div id="tree-status" class="tree-status">${input.events.length} / ${input.events.length} entries</div>
</aside>
<div id="sidebar-resizer"></div>
<main id="content">
  <div class="help-bar"><span>Conversation-style ATM audit view. Every event keeps expandable raw JSON.</span><span>${escapeHtml(input.filterLabel ?? "all")}</span></div>
  <section class="header">
    <h1>ATM Full Export</h1>
    <div class="info-item"><span class="info-label">Generated</span><span class="info-value">${escapeHtml(input.generatedAt)}</span></div>
    <div class="info-item"><span class="info-label">Session</span><span class="info-value">${escapeHtml(input.sessionKey)}</span></div>
    <div class="info-item"><span class="info-label">cwd</span><span class="info-value">${escapeHtml(input.cwd)}</span></div>
    <div class="info-item"><span class="info-label">Events</span><span class="info-value">${input.events.length}</span></div>
  </section>
  ${warnings}
  ${fallback}
  <section id="messages">${entries || empty}</section>
</main>
</div>
<script>${fullExportClientScript()}</script>
</body>
</html>`
}
