# ATM Export Pi-Style Conversation View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign ATM full HTML exports so they preserve every audit event while rendering a Pi-like conversation view with sidebar navigation, conversation blocks, and expandable raw JSON.

**Architecture:** Keep the existing `FullExportEvent` data model and `/atm export` command flow unchanged. Split the HTML renderer into focused modules for CSS, client script, event rendering, and shell assembly so the implementation stays under Biome's 500-line source-file limit. Tests drive the public output contract through `renderFullExportHtml()`.

**Tech Stack:** TypeScript, NodeNext ESM imports with `.js` extensions, Node test runner via `tsx --test`, Biome, self-contained HTML/CSS/JavaScript.

---

## File Structure

- Modify: `tests/full-export.test.ts`
  - Adds assertions for Pi-like layout, conversation-style event classes, sidebar/main filtering targets, raw JSON preservation, and fallback behavior.

- Modify: `src/full-export/html.ts`
  - Keeps `renderFullExportHtml(input)` as the public entry point.
  - Assembles the document shell and delegates CSS, client script, sidebar rows, and event entries to helper modules.

- Create: `src/full-export/html-css.ts`
  - Exports `fullExportCss()` with Pi-inspired static self-contained CSS.

- Create: `src/full-export/html-script.ts`
  - Exports `fullExportClientScript()` with search/filter/sidebar active-state/sidebar-resize behavior.

- Create: `src/full-export/html-renderers.ts`
  - Exports helpers for filter buttons, sidebar rows, event entries, fallback/warning/header blocks, previews, metadata, and HTML escaping.

- Do not commit unless the user explicitly asks. This repository's `AGENTS.md` forbids commits without one-time explicit permission.

---

## Task 1: Add Failing Pi-Style Export Tests

**Files:**
- Modify: `tests/full-export.test.ts`

- [ ] **Step 1: Replace the existing HTML controls test with a Pi-style layout test**

Find the current test named `full export HTML escapes content and includes controls` and replace it with this test:

```ts
test("full export HTML uses Pi-style shell and escapes content", () => {
  const html = renderFullExportHtml({
    events: [
      { ...event("input", "e1"), payload: { type: "input", text: "Hello & goodbye", source: "interactive" } },
      {
        ...event("provider_request", "e2"),
        provider: "test-provider",
        model: "m1",
        payload: { prompt: "<script>alert(1)</script>", messages: [{ role: "user", content: "secret" }] },
      },
    ],
    warnings: ["Exact provider payload history unavailable before recording was enabled."],
    generatedAt: "2026-06-06T00:00:00.000Z",
    sessionKey: "session-1",
    cwd: "/tmp/project",
  })

  assert.match(html, /<div id="app">/)
  assert.match(html, /<aside id="sidebar">/)
  assert.match(html, /<div id="sidebar-resizer"><\/div>/)
  assert.match(html, /<main id="content">/)
  assert.match(html, /<section id="messages">/)
  assert.match(html, /class="sidebar-search"/)
  assert.match(html, /class="filter-btn active" data-filter="all"/)
  assert.match(html, /class="tree-container"/)
  assert.match(html, /class="tree-status"/)
  assert.match(html, /class="user-message export-entry"/)
  assert.match(html, /class="provider-audit export-entry"/)
  assert.match(html, /Exact provider payload history unavailable/)
  assert.match(html, /test-provider/)
  assert.match(html, /Hello &amp; goodbye/)
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.equal(html.includes("<script>alert(1)</script>"), false)
})
```

- [ ] **Step 2: Add a test that all event types render conversation/audit classes and raw JSON**

Add this test after the Pi-style layout test:

```ts
test("full export HTML renders all event categories with raw JSON details", () => {
  const events: FullExportEvent[] = [
    { ...event("input", "input-1"), payload: { type: "input", text: "user asks" } },
    {
      ...event("message_end", "assistant-1"),
      payload: { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "assistant replies" }] } },
    },
    {
      ...event("tool_call", "tool-call-1"),
      toolName: "read",
      toolCallId: "call-1",
      payload: { id: "call-1", name: "read", arguments: { path: "src/full-export/html.ts" } },
    },
    {
      ...event("tool_result", "tool-result-1"),
      toolName: "read",
      toolCallId: "call-1",
      payload: { toolCallId: "call-1", content: [{ type: "text", text: "file contents" }], isError: false },
    },
    {
      ...event("context", "context-1"),
      payload: { originalMessages: [{ role: "user" }], transformedMessages: [{ role: "user" }, { role: "assistant" }] },
    },
    { ...event("provider_response", "provider-1"), provider: "openai", model: "gpt-test", payload: { usage: { input: 12, output: 3 } } },
    { ...event("atm_state", "atm-1"), payload: { state: { stats: { contextRuns: 2 } } } },
  ]

  const html = renderFullExportHtml({
    events,
    warnings: [],
    generatedAt: "2026-06-06T00:00:00.000Z",
    sessionKey: "session-1",
    cwd: "/tmp/project",
  })

  assert.equal((html.match(/class="raw-json"/g) ?? []).length, events.length)
  assert.equal((html.match(/class="tree-node/g) ?? []).length, events.length)
  assert.match(html, /class="assistant-message export-entry"/)
  assert.match(html, /class="tool-execution success export-entry"/)
  assert.match(html, /class="context-audit export-entry"/)
  assert.match(html, /class="provider-audit export-entry"/)
  assert.match(html, /class="atm-audit export-entry"/)
  assert.match(html, /assistant replies/)
  assert.match(html, /src\/full-export\/html\.ts/)
  assert.match(html, /original 1 · transformed 2/)
  assert.match(html, /gpt-test/)
})
```

- [ ] **Step 3: Update the fallback test expectations**

In `full export HTML can render fallback without recorded events`, replace:

```ts
assert.match(html, /No events/)
```

with:

```ts
assert.match(html, /No recorded events/)
assert.match(html, /class="fallback-block"/)
```

- [ ] **Step 4: Run the focused test file and verify failure**

Run:

```bash
npm test -- tests/full-export.test.ts
```

Expected: FAIL. The failure should mention missing Pi-style ids/classes such as `id="app"`, `sidebar-search`, `tree-container`, or conversation classes. If it fails for TypeScript syntax instead, fix the test syntax before continuing.

---

## Task 2: Extract Pi-Like CSS and Client Script Modules

**Files:**
- Create: `src/full-export/html-css.ts`
- Create: `src/full-export/html-script.ts`
- Modify: `src/full-export/html.ts`

- [ ] **Step 1: Create the CSS module**

Create `src/full-export/html-css.ts`:

```ts
export function fullExportCss() {
  return `:root{--accent:#8abeb7;--border:#5f87ff;--borderAccent:#00d7ff;--borderMuted:#505050;--success:#b5bd68;--error:#cc6666;--warning:#ffff00;--muted:#808080;--dim:#666666;--text:#d4d4d4;--thinkingText:#808080;--selectedBg:#3a3a4a;--userMessageBg:#343541;--userMessageText:#d4d4d4;--customMessageBg:#2d2838;--customMessageText:#d4d4d4;--customMessageLabel:#9575cd;--toolPendingBg:#282832;--toolSuccessBg:#283228;--toolErrorBg:#3c2828;--toolTitle:#d4d4d4;--toolOutput:#808080;--body-bg:#18181e;--container-bg:#1e1e24;--info-bg:#3c3728;--line-height:18px;--sidebar-width:400px;--sidebar-min-width:240px;--sidebar-max-width:840px;--sidebar-resizer-width:6px}*{margin:0;padding:0;box-sizing:border-box}body{font-family:ui-monospace,'Cascadia Code','Source Code Pro',Menlo,Consolas,'DejaVu Sans Mono',monospace;font-size:12px;line-height:var(--line-height);color:var(--text);background:var(--body-bg)}body.sidebar-resizing{cursor:col-resize;user-select:none}#app{display:flex;min-height:100vh}#sidebar{width:var(--sidebar-width);min-width:var(--sidebar-width);max-width:var(--sidebar-width);background:var(--container-bg);flex-shrink:0;display:flex;flex-direction:column;position:sticky;top:0;height:100vh;border-right:1px solid var(--dim)}#sidebar-resizer{width:var(--sidebar-resizer-width);flex-shrink:0;position:sticky;top:0;height:100vh;cursor:col-resize;touch-action:none;background:transparent;border-right:1px solid transparent}#sidebar-resizer:hover,body.sidebar-resizing #sidebar-resizer{background:var(--selectedBg);border-right-color:var(--dim)}.sidebar-header{padding:8px 12px;flex-shrink:0}.sidebar-header h1{font-size:12px;color:var(--borderAccent);margin-bottom:var(--line-height)}.sidebar-meta{font-size:10px;color:var(--dim);word-break:break-all}.sidebar-controls{padding:8px 8px 4px}.sidebar-search{width:100%;padding:4px 8px;font-size:11px;font-family:inherit;background:var(--body-bg);color:var(--text);border:1px solid var(--dim);border-radius:3px}.sidebar-search:focus{outline:none;border-color:var(--accent)}.sidebar-filters{display:flex;padding:4px 8px 8px;gap:4px;align-items:center;flex-wrap:wrap}.filter-btn{padding:3px 8px;font-size:10px;font-family:inherit;background:transparent;color:var(--muted);border:1px solid var(--dim);border-radius:3px;cursor:pointer}.filter-btn:hover{color:var(--text);border-color:var(--text)}.filter-btn.active{background:var(--accent);color:var(--body-bg);border-color:var(--accent)}.tree-container{flex:1;overflow:auto;padding:4px 0}.tree-node{padding:0 8px;cursor:pointer;display:flex;align-items:baseline;font-size:11px;line-height:13px;white-space:nowrap;text-decoration:none;color:var(--text)}.tree-node:hover,.tree-node.active{background:var(--selectedBg)}.tree-marker{color:var(--accent);flex-shrink:0;margin-right:4px}.tree-time{color:var(--dim);flex-shrink:0;margin-right:6px}.tree-content{overflow:hidden;text-overflow:ellipsis}.tree-role-user{color:var(--accent)}.tree-role-assistant{color:var(--success)}.tree-role-tool{color:var(--muted)}.tree-role-provider{color:var(--borderAccent)}.tree-role-context{color:var(--warning)}.tree-role-atm{color:var(--customMessageLabel)}.tree-status{padding:4px 12px;font-size:10px;color:var(--muted);flex-shrink:0}#content{flex:1;min-width:0;overflow-y:auto;padding:var(--line-height) calc(var(--line-height) * 2);display:flex;flex-direction:column;align-items:center}#content>*{width:100%;max-width:800px}.help-bar{font-size:11px;color:var(--warning);margin-bottom:var(--line-height);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}.header,.warning-block,.fallback-block{background:var(--container-bg);border-radius:4px;padding:var(--line-height);margin-bottom:var(--line-height)}.header h1{font-size:12px;color:var(--borderAccent);margin-bottom:var(--line-height)}.info-item{color:var(--dim);display:flex;align-items:baseline}.info-label{font-weight:600;margin-right:8px;min-width:100px}.info-value{color:var(--text);flex:1;word-break:break-all}.warning-block{background:var(--info-bg);border-left:3px solid var(--warning)}#messages{display:flex;flex-direction:column;gap:var(--line-height)}.export-entry{scroll-margin-top:var(--line-height);position:relative}.export-entry.highlight{animation:highlight-pulse 2s ease-out}@keyframes highlight-pulse{0%{box-shadow:0 0 0 3px var(--accent)}100%{box-shadow:0 0 0 0 transparent}}.message-timestamp{font-size:10px;color:var(--dim);opacity:.8}.entry-label{font-weight:bold}.entry-meta{color:var(--dim);font-size:10px;word-break:break-all}.user-message{background:var(--userMessageBg);color:var(--userMessageText);padding:var(--line-height);border-radius:4px}.assistant-message{padding:0}.assistant-text{padding:var(--line-height);padding-bottom:0;white-space:pre-wrap}.system-audit,.context-audit,.provider-audit,.atm-audit{background:var(--customMessageBg);color:var(--customMessageText);padding:var(--line-height);border-radius:4px}.context-audit{border-left:3px solid var(--warning)}.provider-audit{border-left:3px solid var(--borderAccent)}.atm-audit{border-left:3px solid var(--customMessageLabel)}.tool-execution{padding:var(--line-height);border-radius:4px}.tool-execution.pending{background:var(--toolPendingBg)}.tool-execution.success{background:var(--toolSuccessBg)}.tool-execution.error{background:var(--toolErrorBg)}.tool-header{font-weight:bold;color:var(--toolTitle)}.tool-output,.entry-preview{margin-top:var(--line-height);color:var(--toolOutput);white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word}.raw-json{margin-top:var(--line-height);color:var(--muted)}.raw-json summary{cursor:pointer;font-size:10px}.raw-json pre,.fallback-block pre{overflow:auto;background:var(--body-bg);border-radius:3px;padding:8px;margin-top:4px;white-space:pre-wrap;color:var(--text)}.no-events{background:var(--container-bg);border-radius:4px;padding:var(--line-height);color:var(--muted)}@media(max-width:900px){#app{display:block}#sidebar{position:relative;width:100%;min-width:100%;max-width:100%;height:45vh}#sidebar-resizer{display:none}#content{padding:var(--line-height)}}`
}
```

- [ ] **Step 2: Create the client script module**

Create `src/full-export/html-script.ts`:

```ts
export function fullExportClientScript() {
  return `(function(){'use strict';const search=document.getElementById('search');const buttons=[...document.querySelectorAll('[data-filter]')];const entries=[...document.querySelectorAll('.export-entry')];const treeNodes=[...document.querySelectorAll('.tree-node')];const status=document.getElementById('tree-status');let active='all';function matchesFilter(kind,searchText){if(active==='all')return true;if(active==='message')return ['input','before_agent_start','message_start','message_update','message_end','turn_start','turn_end'].includes(kind);if(active==='hidden')return searchText.includes('custom')||searchText.includes('hidden');if(active==='atm_session')return ['atm_state','session_start','session_shutdown'].includes(kind);return kind===active}function apply(){const q=(search?.value||'').toLowerCase();let visible=0;for(const entry of entries){const kind=entry.dataset.kind||'';const text=(entry.dataset.search||'').toLowerCase();const show=matchesFilter(kind,text)&&text.includes(q);entry.style.display=show?'block':'none';if(show)visible++}for(const node of treeNodes){const kind=node.dataset.kind||'';const text=(node.dataset.search||'').toLowerCase();node.style.display=matchesFilter(kind,text)&&text.includes(q)?'flex':'none'}if(status)status.textContent=visible+' / '+entries.length+' entries'}function activate(id,scroll){treeNodes.forEach(n=>n.classList.toggle('active',n.dataset.target===id));const entry=document.getElementById(id);if(entry){entries.forEach(e=>e.classList.remove('highlight'));entry.classList.add('highlight');if(scroll)entry.scrollIntoView({block:'start',behavior:'smooth'})}}search?.addEventListener('input',apply);for(const button of buttons){button.addEventListener('click',()=>{active=button.dataset.filter||'all';buttons.forEach(b=>b.classList.toggle('active',b===button));apply()})}for(const node of treeNodes){node.addEventListener('click',(event)=>{event.preventDefault();const id=node.dataset.target;if(id)activate(id,true)})}const resizer=document.getElementById('sidebar-resizer');const sidebar=document.getElementById('sidebar');let resizing=false;resizer?.addEventListener('pointerdown',(event)=>{resizing=true;document.body.classList.add('sidebar-resizing');resizer.setPointerCapture?.(event.pointerId)});window.addEventListener('pointermove',(event)=>{if(!resizing||!sidebar)return;const width=Math.max(240,Math.min(840,event.clientX));document.documentElement.style.setProperty('--sidebar-width',width+'px')});window.addEventListener('pointerup',()=>{resizing=false;document.body.classList.remove('sidebar-resizing')});buttons[0]?.classList.add('active');apply();treeNodes[0]?.classList.add('active')})();`
}
```

- [ ] **Step 3: Update imports in `src/full-export/html.ts`**

At the top of `src/full-export/html.ts`, add:

```ts
import { fullExportCss } from "./html-css.js"
import { fullExportClientScript } from "./html-script.js"
```

- [ ] **Step 4: Temporarily wire CSS/script without changing body structure**

Replace:

```ts
<style>${css()}</style>
```

with:

```ts
<style>${fullExportCss()}</style>
```

Replace:

```ts
<script>${clientScript()}</script>
```

with:

```ts
<script>${fullExportClientScript()}</script>
```

Delete the old `css()` and `clientScript()` functions from `src/full-export/html.ts` after all call sites are replaced.

- [ ] **Step 5: Run tests and typecheck**

Run:

```bash
npm test -- tests/full-export.test.ts
npm run typecheck
```

Expected: tests still fail because the HTML shell and classes are not implemented yet; typecheck should pass. If typecheck fails for missing `.js` extensions or unused functions, fix imports/exports before continuing.

---

## Task 3: Add Event Rendering Helpers

**Files:**
- Create: `src/full-export/html-renderers.ts`
- Modify: `src/full-export/html.ts`

- [ ] **Step 1: Create `html-renderers.ts` with shared escaping and filter rendering**

Create `src/full-export/html-renderers.ts` with this starting content:

```ts
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

export function escapeHtml(value: string) {
  const replacements: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }
  return value.replace(/[&<>"']/g, (char) => replacements[char] ?? char)
}

export function escapeScriptJson(value: string) {
  return escapeHtml(value).replace(/<\//g, "<\\/")
}

export function renderWarnings(warnings: string[]) {
  return warnings.map((warning) => `<section class="warning-block">${escapeHtml(warning)}</section>`).join("\n")
}

export function renderFallback(fallback: NonNullable<FullExportRenderInput["fallback"]>) {
  return `<section class="fallback-block"><h2>Fallback export data</h2><p>Full recording was not available for all session history. Exact provider payloads and event history may be unavailable.</p><details open><summary>Fallback JSON</summary><pre>${escapeHtml(JSON.stringify(fallback, null, 2))}</pre></details></section>`
}
```

- [ ] **Step 2: Add preview, metadata, and payload helpers**

Append this content to `html-renderers.ts`:

```ts
function payloadRecord(event: FullExportEvent): Record<string, unknown> | undefined {
  return event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
    ? (event.payload as Record<string, unknown>)
    : undefined
}

function nestedRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((item) => {
      const block = nestedRecord(item)
      if (!block) return ""
      if (typeof block.text === "string") return block.text
      if (typeof block.thinking === "string") return block.thinking
      if (block.type === "toolCall" && typeof block.name === "string") return `[tool: ${block.name}]`
      return ""
    })
    .filter(Boolean)
    .join("\n")
}

function messageFromPayload(event: FullExportEvent): Record<string, unknown> | undefined {
  return nestedRecord(payloadRecord(event)?.message)
}

function inputText(event: FullExportEvent): string | undefined {
  const payload = payloadRecord(event)
  return typeof payload?.text === "string" ? payload.text : undefined
}

export function preview(event: FullExportEvent) {
  const payload = payloadRecord(event)
  const message = messageFromPayload(event)
  const text =
    inputText(event) ??
    contentText(message?.content) ??
    (typeof event.payload === "string" ? event.payload : JSON.stringify(event.payload))
  return (text ?? "").replace(/\s+/g, " ").slice(0, 180)
}

export function metadata(event: FullExportEvent) {
  return [event.provider, event.model, event.toolName, event.toolCallId]
    .filter(Boolean)
    .map((value) => escapeHtml(String(value)))
    .join(" · ")
}

export function searchText(event: FullExportEvent) {
  return [event.kind, event.timestamp, event.provider, event.model, event.toolName, event.toolCallId, preview(event), JSON.stringify(event.payload)]
    .filter(Boolean)
    .join(" ")
}
```

- [ ] **Step 3: Add sidebar row rendering**

Append this content to `html-renderers.ts`:

```ts
function treeRoleClass(event: FullExportEvent) {
  if (event.kind === "input") return "tree-role-user"
  if (event.kind.includes("message") || event.kind.includes("turn")) return "tree-role-assistant"
  if (event.kind.includes("tool")) return "tree-role-tool"
  if (event.kind.includes("provider")) return "tree-role-provider"
  if (event.kind === "context") return "tree-role-context"
  return "tree-role-atm"
}

function shortTime(timestamp: string) {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return timestamp.slice(0, 19)
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

export function renderSidebarItem(event: FullExportEvent) {
  return `<a href="#${escapeHtml(event.id)}" class="tree-node" data-kind="${escapeHtml(event.kind)}" data-target="${escapeHtml(event.id)}" data-search="${escapeHtml(searchText(event))}"><span class="tree-marker">•</span><span class="tree-time">${escapeHtml(shortTime(event.timestamp))}</span><span class="tree-content"><span class="${treeRoleClass(event)}">${escapeHtml(event.kind)}</span> ${escapeHtml(preview(event))}</span></a>`
}
```

- [ ] **Step 4: Add main event entry rendering**

Append this content to `html-renderers.ts`:

```ts
function rawDetails(event: FullExportEvent) {
  return `<details class="raw-json"><summary>Raw JSON</summary><pre>${escapeHtml(JSON.stringify(event.payload, null, 2))}</pre></details>`
}

function entryAttrs(event: FullExportEvent, className: string) {
  return `class="${className} export-entry" id="${escapeHtml(event.id)}" data-kind="${escapeHtml(event.kind)}" data-search="${escapeHtml(searchText(event))}"`
}

function entryHeader(event: FullExportEvent, label: string) {
  const meta = metadata(event)
  return `<div class="message-timestamp">${escapeHtml(event.timestamp)}</div><div class="entry-label">${escapeHtml(label)}</div>${meta ? `<div class="entry-meta">${meta}</div>` : ""}`
}

function renderInputEvent(event: FullExportEvent) {
  return `<article ${entryAttrs(event, "user-message")}>${entryHeader(event, "user")}<div class="entry-preview">${escapeHtml(inputText(event) ?? preview(event))}</div>${rawDetails(event)}</article>`
}

function renderAssistantEvent(event: FullExportEvent) {
  const message = messageFromPayload(event)
  const role = typeof message?.role === "string" ? message.role : "assistant"
  const text = contentText(message?.content) || preview(event)
  return `<article ${entryAttrs(event, "assistant-message")}><div class="message-timestamp">${escapeHtml(event.timestamp)}</div><div class="assistant-text"><span class="entry-label">${escapeHtml(role)} · ${escapeHtml(event.kind)}</span><div class="entry-preview">${escapeHtml(text)}</div>${metadata(event) ? `<div class="entry-meta">${metadata(event)}</div>` : ""}${rawDetails(event)}</div></article>`
}

function renderToolEvent(event: FullExportEvent) {
  const payload = payloadRecord(event)
  const isError = payload?.isError === true || payload?.error === true
  const statusClass = event.kind.endsWith("start") || event.kind.endsWith("update") ? "pending" : isError ? "error" : "success"
  const label = event.toolName ?? event.kind
  return `<article ${entryAttrs(event, `tool-execution ${statusClass}`)}>${entryHeader(event, label)}<div class="tool-output">${escapeHtml(preview(event))}</div>${rawDetails(event)}</article>`
}

function renderContextEvent(event: FullExportEvent) {
  const payload = payloadRecord(event)
  const original = Array.isArray(payload?.originalMessages) ? payload.originalMessages.length : undefined
  const transformed = Array.isArray(payload?.transformedMessages) ? payload.transformedMessages.length : undefined
  const counts = original !== undefined || transformed !== undefined ? `original ${original ?? 0} · transformed ${transformed ?? 0}` : preview(event)
  return `<article ${entryAttrs(event, "context-audit")}>${entryHeader(event, "context rewrite")}<div class="entry-preview">${escapeHtml(counts)}</div>${rawDetails(event)}</article>`
}

function renderProviderEvent(event: FullExportEvent) {
  const label = event.kind === "provider_request" ? "provider request · exact payload before send" : "provider response"
  return `<article ${entryAttrs(event, "provider-audit")}>${entryHeader(event, label)}<div class="entry-preview">${escapeHtml(preview(event))}</div>${rawDetails(event)}</article>`
}

function renderAtmEvent(event: FullExportEvent) {
  return `<article ${entryAttrs(event, "atm-audit")}>${entryHeader(event, event.kind)}<div class="entry-preview">${escapeHtml(preview(event))}</div>${rawDetails(event)}</article>`
}

function renderSystemEvent(event: FullExportEvent) {
  return `<article ${entryAttrs(event, "system-audit")}>${entryHeader(event, event.kind)}<div class="entry-preview">${escapeHtml(preview(event))}</div>${rawDetails(event)}</article>`
}

export function renderEventEntry(event: FullExportEvent) {
  if (event.kind === "input") return renderInputEvent(event)
  if (event.kind.includes("message") || event.kind.includes("turn")) return renderAssistantEvent(event)
  if (event.kind.includes("tool")) return renderToolEvent(event)
  if (event.kind === "context") return renderContextEvent(event)
  if (event.kind.includes("provider")) return renderProviderEvent(event)
  if (event.kind === "atm_state" || event.kind === "session_start" || event.kind === "session_shutdown") return renderAtmEvent(event)
  return renderSystemEvent(event)
}
```

- [ ] **Step 5: Run typecheck and fix exact TypeScript issues**

Run:

```bash
npm run typecheck
```

Expected: PASS. If TypeScript reports template literal or escaping errors, fix only those syntax/type issues before continuing.

---

## Task 4: Assemble the Pi-Style HTML Shell

**Files:**
- Modify: `src/full-export/html.ts`

- [ ] **Step 1: Replace imports and remove local duplicated helpers**

Change the imports in `src/full-export/html.ts` to:

```ts
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
```

Delete the local `filterButtons`, `renderFilterButton`, `renderNavItem`, `renderEventCard`, `metadata`, `renderKnownPayload`, `renderFallback`, `preview`, `searchText`, `escapeHtml`, `escapeScriptJson`, `css`, and `clientScript` functions from `html.ts`.

- [ ] **Step 2: Replace `renderFullExportHtml()` with the Pi-style shell**

Use this implementation:

```ts
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
```

- [ ] **Step 3: Run focused tests**

Run:

```bash
npm test -- tests/full-export.test.ts
```

Expected: PASS or fail only on small textual/class mismatches. Fix mismatches by changing implementation to satisfy the tests and approved spec, not by weakening tests.

---

## Task 5: Verify Full Project Quality Gates

**Files:**
- No new files unless a quality gate exposes a necessary fix.

- [ ] **Step 1: Run the full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run Biome lint/check**

Run:

```bash
npm run lint
```

Expected: PASS. If Biome reports a source file over 500 lines, split helpers out further; do not add `biome-ignore` comments or rule overrides.

- [ ] **Step 4: Run the full project check**

Run:

```bash
npm run check
```

Expected: PASS. If `fallow` reports unused exports or dead code, remove the unused code or make it used by the renderer/tests.

- [ ] **Step 5: Inspect generated HTML manually from a targeted render**

Run:

```bash
npx tsx --eval "
import { writeFileSync } from 'node:fs'
import { renderFullExportHtml } from './src/full-export/html.ts'
const event = (kind, id, payload = { marker: kind }) => ({ version: 1, id, timestamp: '2026-06-06T00:00:00.000Z', sessionKey: 'session-1', kind, payload })
writeFileSync('tmp-atm-pi-style-export.html', renderFullExportHtml({
  events: [
    event('input', 'e1', { type: 'input', text: 'How does this work?' }),
    event('message_end', 'e2', { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Here is an answer.' }] } }),
    { ...event('tool_call', 'e3', { id: 'call-1', name: 'read', arguments: { path: 'src/full-export/html.ts' } }), toolName: 'read', toolCallId: 'call-1' },
    { ...event('provider_request', 'e4', { model: 'gpt-test', messages: [] }), provider: 'openai', model: 'gpt-test' },
  ],
  warnings: [],
  generatedAt: '2026-06-06T00:00:00.000Z',
  sessionKey: 'session-1',
  cwd: process.cwd(),
}))
"
```

Expected: `tmp-atm-pi-style-export.html` exists and opens as a self-contained dark Pi-like page with sidebar navigation, conversation entries, filters, and raw JSON details.

- [ ] **Step 6: Remove the manual artifact**

Run:

```bash
rm -f tmp-atm-pi-style-export.html
```

Expected: artifact removed.

---

## Self-Review Checklist

- Spec coverage: This plan covers Pi-like layout, conversation-style event rendering, raw JSON preservation, filters/search, sidebar rows, fallback warnings, escaping, self-contained output, and quality gates.
- Placeholder scan: The plan contains no unresolved placeholder markers or unspecified implementation steps.
- Type consistency: New modules use `.js` import extensions from TypeScript source, preserve `renderFullExportHtml(input: FullExportRenderInput)`, and keep `FullExportEvent` unchanged.
- Repository constraints: The plan avoids commits because explicit commit permission has not been granted, and it calls out the Biome 500-line source-file limit.
