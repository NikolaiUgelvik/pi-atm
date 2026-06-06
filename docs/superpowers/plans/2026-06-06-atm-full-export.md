# ATM Full Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in full Pi session recording and `/atm export [filter]` HTML export for all ATM-observable session data, including hidden messages, context rewrites, tool lifecycle data, provider payloads, response metadata, and ATM state snapshots.

**Architecture:** Add a focused `src/full-export/` subsystem with event types, filtering, JSONL recording/reading, and HTML rendering. Keep `src/index.ts` as the wiring layer for Pi hooks and `/atm export`, and keep full recording controlled only by `PI_ATM_FULL_EXPORT` so existing `debug` behavior remains separate.

**Tech Stack:** TypeScript ESM with NodeNext `.js` imports, Node built-ins (`fs`, `path`, `crypto`, `os`), Node test runner via `tsx --test`, Biome, TypeScript strict mode.

---

## Non-Negotiable Constraints

- Do not commit unless the user explicitly grants one-time commit permission. This plan intentionally uses **verification checkpoints** instead of commit steps.
- Keep every non-test source file under Biome's 500-line limit.
- Do not add `biome-ignore` comments or rule overrides for file length.
- Source imports must use `.js` extensions because this repo uses TypeScript NodeNext module resolution.
- Full export recording must not depend on `config.debug`; it is enabled only by `PI_ATM_FULL_EXPORT` truthy values.
- Provider request payloads must be recorded as the exact `event.payload` object received from Pi's `before_provider_request` hook.
- Recording/export errors must not break normal agent execution.

## Files and Responsibilities

- Create: `src/full-export/types.ts`
  - Full export event kind union, event envelope type, filter category constants, fallback/export data types.
- Create: `src/full-export/filters.ts`
  - Parse `/atm export [filter]` arguments and apply event kind/category filters.
- Create: `src/full-export/recorder.ts`
  - Parse `PI_ATM_FULL_EXPORT`, derive safe JSONL paths, serialize circular data safely, append events, read malformed-tolerant JSONL, build fallback export data.
- Create: `src/full-export/html.ts`
  - Render self-contained dark HTML with sidebar, search, filter chips, event cards, escaped content, embedded JSON data, and warnings.
- Create: `tests/full-export.test.ts`
  - Unit coverage for env parsing, safe names, JSONL append/read, malformed JSONL tolerance, filters, HTML escaping/controls, and fallback export data.
- Modify: `package.json`
  - Add a `test` script and `tsx` dev dependency so TypeScript tests with `.js` source imports run consistently.
- Modify: `package-lock.json`
  - Update lockfile after adding `tsx`.
- Modify: `src/index.ts`
  - Wire full recorder setup, Pi hooks, ATM state snapshots, context rewrite event details, and `/atm export [filter]` command.
- Modify: `README.md`
  - Document `PI_ATM_FULL_EXPORT=1`, raw sensitive storage, `/atm export [filter]`, storage path, fallback behavior, and filters.

---

## Task 1: Add a runnable TypeScript test command

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Write the test-runner package changes**

Update `package.json` so the `scripts` and `devDependencies` sections include `test` and `tsx`:

```json
{
  "scripts": {
    "format": "biome check --write .",
    "lint": "biome check .",
    "check": "biome ci . && npm run typecheck && npm run fallow",
    "fallow": "fallow --ci --fail-on-issues",
    "typecheck": "tsc --noEmit",
    "test": "tsx --test tests/*.test.ts",
    "prepare": "husky"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.4.16",
    "@earendil-works/pi-coding-agent": "^0.78.0",
    "@types/node": "^24.0.0",
    "fallow": "^2.88.0",
    "husky": "^9.1.7",
    "tsx": "^4.20.6",
    "typebox": "^1.0.68",
    "typescript": "^5.9.0"
  }
}
```

- [ ] **Step 2: Update the lockfile**

Run:

```bash
npm install
```

Expected: `package-lock.json` updates to include `tsx` and its transitive dependencies.

- [ ] **Step 3: Verify current tests run**

Run:

```bash
npm test
```

Expected: existing `tests/pi-atm.test.ts` passes. This also confirms `.js` imports in TypeScript source resolve during tests.

- [ ] **Step 4: Verification checkpoint**

Run:

```bash
npm run typecheck
```

Expected: TypeScript succeeds before adding feature code.

---

## Task 2: Define full export event and filter types

**Files:**
- Create: `src/full-export/types.ts`
- Create: `src/full-export/filters.ts`
- Create: `tests/full-export.test.ts`

- [ ] **Step 1: Write failing filter/type tests**

Create `tests/full-export.test.ts` with these initial tests:

```ts
import assert from "node:assert/strict"
import test from "node:test"
import { filterEvents, parseFullExportFilter } from "../src/full-export/filters.js"
import type { FullExportEvent } from "../src/full-export/types.js"

function event(kind: FullExportEvent["kind"], id = kind): FullExportEvent {
  return {
    version: 1,
    id,
    timestamp: "2026-06-06T00:00:00.000Z",
    sessionKey: "session-1",
    kind,
    payload: { marker: kind },
  }
}

test("full export filters parse exact kinds and categories", () => {
  const parsed = parseFullExportFilter("provider_request, tool, context")

  assert.deepEqual(parsed.unknown, [])
  assert.equal(parsed.includeAll, false)
  assert.equal(parsed.kinds.has("provider_request"), true)
  assert.equal(parsed.kinds.has("tool_call"), true)
  assert.equal(parsed.kinds.has("tool_result"), true)
  assert.equal(parsed.kinds.has("context"), true)
})

test("full export filter with no input includes all events", () => {
  const parsed = parseFullExportFilter("   ")

  assert.equal(parsed.includeAll, true)
  assert.equal(parsed.kinds.size, 0)
})

test("full export filters keep matching events only", () => {
  const events = [event("provider_request"), event("tool_result"), event("context"), event("atm_state")]

  assert.deepEqual(
    filterEvents(events, parseFullExportFilter("provider,atm")).map((x) => x.kind),
    ["provider_request", "atm_state"],
  )
})

test("full export filters report unknown tokens", () => {
  const parsed = parseFullExportFilter("provider,nope")

  assert.deepEqual(parsed.unknown, ["nope"])
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test
```

Expected: FAIL because `src/full-export/filters.ts` and `src/full-export/types.ts` do not exist.

- [ ] **Step 3: Implement event/filter types**

Create `src/full-export/types.ts`:

```ts
export const fullExportKinds = [
  "session_start",
  "input",
  "before_agent_start",
  "context",
  "provider_request",
  "provider_response",
  "turn_start",
  "turn_end",
  "message_start",
  "message_update",
  "message_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
  "tool_call",
  "tool_result",
  "session_shutdown",
  "atm_state",
] as const

export type FullExportKind = (typeof fullExportKinds)[number]

export type FullExportEvent = {
  version: 1
  id: string
  timestamp: string
  sessionKey: string
  cwd?: string
  kind: FullExportKind
  turnIndex?: number
  toolCallId?: string
  toolName?: string
  provider?: string
  model?: string
  payload: unknown
}

export const fullExportCategoryKinds = {
  message: ["input", "before_agent_start", "message_start", "message_update", "message_end", "turn_end"],
  tool: ["tool_execution_start", "tool_execution_update", "tool_execution_end", "tool_call", "tool_result"],
  provider: ["provider_request", "provider_response"],
  context: ["context"],
  session: ["session_start", "session_shutdown"],
  atm: ["atm_state"],
} as const satisfies Record<string, readonly FullExportKind[]>

export type FullExportCategory = keyof typeof fullExportCategoryKinds

export type ParsedFullExportFilter = {
  includeAll: boolean
  kinds: Set<FullExportKind>
  unknown: string[]
}

export type FullExportFallbackData = {
  entries: unknown[]
  contextMessages: unknown[]
  state: unknown
}

export type FullExportRenderInput = {
  events: FullExportEvent[]
  warnings: string[]
  filterLabel?: string
  generatedAt: string
  sessionKey: string
  cwd: string
  fallback?: FullExportFallbackData
}
```

- [ ] **Step 4: Implement filter parsing**

Create `src/full-export/filters.ts`:

```ts
import { fullExportCategoryKinds, fullExportKinds, type FullExportEvent, type FullExportKind } from "./types.js"

const knownKinds = new Set<string>(fullExportKinds)
const categories = fullExportCategoryKinds as Record<string, readonly FullExportKind[]>

export function parseFullExportFilter(input: string | undefined) {
  const tokens = (input ?? "")
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean)
  const kinds = new Set<FullExportKind>()
  const unknown: string[] = []

  for (const token of tokens) {
    if (knownKinds.has(token)) {
      kinds.add(token as FullExportKind)
    } else if (token in categories) {
      for (const kind of categories[token]) kinds.add(kind)
    } else {
      unknown.push(token)
    }
  }

  return { includeAll: tokens.length === 0, kinds, unknown }
}

export function filterEvents(events: FullExportEvent[], filter = parseFullExportFilter(undefined)) {
  if (filter.includeAll) return events
  return events.filter((event) => filter.kinds.has(event.kind))
}
```

- [ ] **Step 5: Verify tests pass**

Run:

```bash
npm test
```

Expected: all tests pass.

---

## Task 3: Implement recorder env parsing, safe paths, JSONL append, and tolerant reads

**Files:**
- Modify: `src/full-export/recorder.ts`
- Modify: `tests/full-export.test.ts`

- [ ] **Step 1: Add failing recorder tests**

Append these tests to `tests/full-export.test.ts`:

```ts
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  appendFullExportEvent,
  fullExportEventPath,
  isFullExportEnabled,
  readFullExportEvents,
  safeSessionFileStem,
} from "../src/full-export/recorder.js"

test("full export env parsing accepts only explicit truthy values", () => {
  assert.equal(isFullExportEnabled({ PI_ATM_FULL_EXPORT: "1" }), true)
  assert.equal(isFullExportEnabled({ PI_ATM_FULL_EXPORT: "true" }), true)
  assert.equal(isFullExportEnabled({ PI_ATM_FULL_EXPORT: "YES" }), true)
  assert.equal(isFullExportEnabled({ PI_ATM_FULL_EXPORT: "on" }), true)
  assert.equal(isFullExportEnabled({ PI_ATM_FULL_EXPORT: "0" }), false)
  assert.equal(isFullExportEnabled({ PI_ATM_FULL_EXPORT: "false" }), false)
  assert.equal(isFullExportEnabled({}), false)
})

test("full export session filenames are path safe and deterministic", () => {
  const unsafe = "project/session:with/slashes?and spaces"

  assert.match(safeSessionFileStem(unsafe), /^[a-f0-9]{24}$/)
  assert.equal(safeSessionFileStem(unsafe), safeSessionFileStem(unsafe))
})

test("full export appends JSONL envelopes", () => {
  const home = mkdtempSync(join(tmpdir(), "pi-atm-full-export-"))
  try {
    const written = appendFullExportEvent(
      { home, sessionKey: "session/a", cwd: "/tmp/project", counter: 1 },
      { kind: "provider_request", payload: { messages: ["exact"] }, provider: "test", model: "m1" },
    )

    const line = readFileSync(written.path, "utf8").trim()
    const parsed = JSON.parse(line)
    assert.equal(parsed.version, 1)
    assert.equal(parsed.id.endsWith("-1"), true)
    assert.equal(parsed.sessionKey, "session/a")
    assert.equal(parsed.cwd, "/tmp/project")
    assert.equal(parsed.kind, "provider_request")
    assert.deepEqual(parsed.payload, { messages: ["exact"] })
    assert.equal(parsed.provider, "test")
    assert.equal(parsed.model, "m1")
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("full export read tolerates malformed JSONL lines", () => {
  const home = mkdtempSync(join(tmpdir(), "pi-atm-full-export-"))
  try {
    const file = fullExportEventPath(home, "session-a")
    writeFileSync(
      file,
      `${JSON.stringify(event("input"))}\nnot json\n${JSON.stringify({ ...event("context"), version: 1 })}\n`,
    )

    const result = readFullExportEvents(file)
    assert.equal(result.events.length, 2)
    assert.equal(result.warnings.length, 1)
    assert.match(result.warnings[0] ?? "", /line 2/)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test
```

Expected: FAIL because `src/full-export/recorder.ts` does not exist.

- [ ] **Step 3: Implement recorder functions**

Create `src/full-export/recorder.ts`:

```ts
import { createHash } from "node:crypto"
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { FullExportEvent, FullExportKind } from "./types.js"

export type FullExportAppendContext = {
  home?: string
  sessionKey: string
  cwd?: string
  counter: number
}

export type FullExportEventInput = {
  kind: FullExportKind
  payload: unknown
  turnIndex?: number
  toolCallId?: string
  toolName?: string
  provider?: string
  model?: string
}

export function isFullExportEnabled(env: NodeJS.ProcessEnv = process.env) {
  return ["1", "true", "yes", "on"].includes(String(env.PI_ATM_FULL_EXPORT ?? "").toLowerCase())
}

export function fullExportBaseDir(home = process.env.HOME || ".") {
  return join(home, ".pi/agent/logs/atm/full-export")
}

export function safeSessionFileStem(sessionKey: string) {
  return createHash("sha1")
    .update(sessionKey || "default")
    .digest("hex")
    .slice(0, 24)
}

export function fullExportEventPath(home: string | undefined, sessionKey: string) {
  return join(fullExportBaseDir(home), `${safeSessionFileStem(sessionKey)}.jsonl`)
}

export function appendFullExportEvent(ctx: FullExportAppendContext, input: FullExportEventInput) {
  const path = fullExportEventPath(ctx.home, ctx.sessionKey)
  mkdirSync(dirname(path), { recursive: true })
  const timestamp = new Date().toISOString()
  const event: FullExportEvent = {
    version: 1,
    id: `${Date.now()}-${ctx.counter}`,
    timestamp,
    sessionKey: ctx.sessionKey,
    cwd: ctx.cwd,
    kind: input.kind,
    turnIndex: input.turnIndex,
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    provider: input.provider,
    model: input.model,
    payload: makeJsonSafe(input.payload),
  }
  appendFileSync(path, `${JSON.stringify(event)}\n`)
  return { path, event }
}

export function readFullExportEvents(path: string) {
  const events: FullExportEvent[] = []
  const warnings: string[] = []
  if (!existsSync(path)) return { events, warnings }
  const lines = readFileSync(path, "utf8").split(/\r?\n/)
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line) as FullExportEvent
      if (parsed.version === 1 && typeof parsed.kind === "string") events.push(parsed)
      else warnings.push(`Ignored invalid full export event on line ${index + 1}.`)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      warnings.push(`Could not parse full export JSONL line ${index + 1}: ${message}`)
    }
  }
  return { events, warnings }
}

export function makeJsonSafe(value: unknown): unknown {
  const seen = new WeakSet<object>()
  try {
    return JSON.parse(
      JSON.stringify(value, (_key, item: unknown) => {
        if (typeof item === "bigint") return item.toString()
        if (typeof item === "function") return `[Function ${item.name || "anonymous"}]`
        if (item && typeof item === "object") {
          if (seen.has(item)) return "[Circular]"
          seen.add(item)
        }
        return item
      }),
    )
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return { error: "Could not serialize full export payload", message }
  }
}
```

- [ ] **Step 4: Verify recorder tests pass**

Run:

```bash
npm test
npm run typecheck
```

Expected: tests and typecheck pass.

---

## Task 4: Implement fallback export data and HTML renderer

**Files:**
- Modify: `src/full-export/recorder.ts`
- Create: `src/full-export/html.ts`
- Modify: `tests/full-export.test.ts`

- [ ] **Step 1: Add failing fallback and HTML tests**

Append these tests to `tests/full-export.test.ts`:

```ts
import { buildFallbackExportData } from "../src/full-export/recorder.js"
import { renderFullExportHtml } from "../src/full-export/html.js"

test("full export fallback captures entries, context messages, and ATM state", () => {
  const fallback = buildFallbackExportData(
    {
      getEntries: () => [{ type: "custom", customType: "active-token-management-state", data: { version: 1 } }],
      buildSessionContext: () => ({ messages: [{ role: "user", content: "hello" }] }),
    },
    { version: 1, compressions: [], stats: { contextRuns: 1 } },
  )

  assert.deepEqual(fallback.contextMessages, [{ role: "user", content: "hello" }])
  assert.equal(fallback.entries.length, 1)
  assert.deepEqual(fallback.state, { version: 1, compressions: [], stats: { contextRuns: 1 } })
})

test("full export HTML escapes content and includes controls", () => {
  const html = renderFullExportHtml({
    events: [
      event("input", "e1"),
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

  assert.match(html, /<html/)
  assert.match(html, /data-filter="provider_request"/)
  assert.match(html, /id="search"/)
  assert.match(html, /Exact provider payload history unavailable/)
  assert.match(html, /test-provider/)
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.equal(html.includes("<script>alert(1)</script>"), false)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test
```

Expected: FAIL because fallback and HTML functions are not implemented.

- [ ] **Step 3: Add fallback builder to recorder**

Add to `src/full-export/recorder.ts`:

```ts
import type { FullExportFallbackData } from "./types.js"

type FallbackSessionManager = {
  getEntries?: () => unknown[]
  buildSessionContext?: () => { messages?: unknown[] }
}

export function buildFallbackExportData(sessionManager: FallbackSessionManager, state: unknown): FullExportFallbackData {
  return {
    entries: safeCall(() => sessionManager.getEntries?.() ?? []),
    contextMessages: safeCall(() => sessionManager.buildSessionContext?.().messages ?? []),
    state: makeJsonSafe(state),
  }
}

function safeCall<T>(fn: () => T): T | [] {
  try {
    return fn()
  } catch {
    return []
  }
}
```

Ensure imports are merged cleanly with existing type imports.

- [ ] **Step 4: Implement HTML renderer**

Create `src/full-export/html.ts`:

```ts
import type { FullExportEvent, FullExportKind, FullExportRenderInput } from "./types.js"

const filterButtons: Array<{ label: string; filter: string }> = [
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

export function renderFullExportHtml(input: FullExportRenderInput) {
  const payload = JSON.stringify({ events: input.events, fallback: input.fallback, warnings: input.warnings })
  const cards = input.events.map(renderEventCard).join("\n")
  const nav = input.events.map(renderNavItem).join("\n")
  const warnings = input.warnings.map((warning) => `<div class="warning">${escapeHtml(warning)}</div>`).join("\n")
  const fallback = input.fallback ? renderFallback(input.fallback) : ""

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ATM Full Export</title>
<style>${css()}</style>
</head>
<body>
<script id="atm-export-data" type="application/json">${escapeScriptJson(payload)}</script>
<aside>
  <h1>ATM Full Export</h1>
  <div class="meta">Generated ${escapeHtml(input.generatedAt)}</div>
  <div class="meta">Session ${escapeHtml(input.sessionKey)}</div>
  <div class="meta">cwd ${escapeHtml(input.cwd)}</div>
  <input id="search" type="search" placeholder="Search events" />
  <div class="chips">${filterButtons.map((button) => `<button data-filter="${escapeHtml(button.filter)}">${escapeHtml(button.label)}</button>`).join("")}</div>
  <nav>${nav}</nav>
</aside>
<main>
  ${warnings}
  ${fallback}
  ${cards || "<section class=\"card\"><h2>No events</h2><p>No recorded full export events matched this export.</p></section>"}
</main>
<script>${clientScript()}</script>
</body>
</html>`
}

function renderNavItem(event: FullExportEvent) {
  return `<a href="#${escapeHtml(event.id)}" data-kind="${escapeHtml(event.kind)}">${escapeHtml(event.timestamp)}<br /><strong>${escapeHtml(event.kind)}</strong><br />${escapeHtml(preview(event))}</a>`
}

function renderEventCard(event: FullExportEvent) {
  const raw = JSON.stringify(event.payload, null, 2)
  return `<section class="card" id="${escapeHtml(event.id)}" data-kind="${escapeHtml(event.kind)}" data-search="${escapeHtml(searchText(event))}">
<header>
  <h2>${escapeHtml(event.kind)}</h2>
  <div>${escapeHtml(event.timestamp)}</div>
  <div>${metadata(event)}</div>
</header>
${renderKnownPayload(event)}
<details><summary>Raw JSON</summary><pre>${escapeHtml(raw)}</pre></details>
</section>`
}

function metadata(event: FullExportEvent) {
  return [event.provider, event.model, event.toolName, event.toolCallId].filter(Boolean).map((x) => escapeHtml(String(x))).join(" · ")
}

function renderKnownPayload(event: FullExportEvent) {
  if (event.kind === "provider_request") return `<p class="badge">Exact provider request payload as recorded before send</p>`
  if (event.kind === "provider_response") return `<p class="badge">Provider response metadata</p>`
  if (event.kind === "context") return `<p class="badge">ATM context rewrite: original and transformed messages are in raw JSON</p>`
  if (event.kind.includes("tool")) return `<p class="badge">Tool event ${escapeHtml(event.toolName ?? "unknown tool")}</p>`
  return `<p>${escapeHtml(preview(event))}</p>`
}

function renderFallback(fallback: NonNullable<FullExportRenderInput["fallback"]>) {
  return `<section class="card warning"><h2>Fallback export data</h2><p>Full recording was not available for all session history. Exact provider payloads and event history may be unavailable.</p><details open><summary>Fallback JSON</summary><pre>${escapeHtml(JSON.stringify(fallback, null, 2))}</pre></details></section>`
}

function preview(event: FullExportEvent) {
  const text = typeof event.payload === "string" ? event.payload : JSON.stringify(event.payload)
  return (text ?? "").replace(/\s+/g, " ").slice(0, 180)
}

function searchText(event: FullExportEvent) {
  return [event.kind, event.provider, event.model, event.toolName, event.toolCallId, preview(event), JSON.stringify(event.payload)]
    .filter(Boolean)
    .join(" ")
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char)
}

function escapeScriptJson(value: string) {
  return escapeHtml(value).replace(/<\//g, "<\\/")
}

function css() {
  return `body{margin:0;background:#0d1117;color:#d6deeb;font:14px ui-monospace,SFMono-Regular,Menlo,monospace}aside{position:fixed;inset:0 auto 0 0;width:320px;overflow:auto;background:#111827;border-right:1px solid #263244;padding:16px;box-sizing:border-box}main{margin-left:352px;padding:24px;max-width:1100px}h1,h2{color:#f8fafc}a{display:block;color:#9ccfd8;text-decoration:none;border-bottom:1px solid #263244;padding:8px 0}.meta{color:#94a3b8;margin:6px 0}#search{width:100%;box-sizing:border-box;background:#0b1220;color:#f8fafc;border:1px solid #334155;border-radius:8px;padding:8px}.chips{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0}.chips button{background:#1f2937;color:#d6deeb;border:1px solid #334155;border-radius:999px;padding:5px 8px;cursor:pointer}.chips button.active{background:#2563eb}.card{background:#111827;border:1px solid #263244;border-radius:14px;margin:0 0 16px;padding:16px}.warning{border-color:#f59e0b;background:#1f1a0b}.badge{display:inline-block;background:#172554;color:#bfdbfe;border-radius:999px;padding:4px 8px}pre{overflow:auto;background:#020617;border-radius:10px;padding:12px;white-space:pre-wrap}header{display:flex;justify-content:space-between;gap:12px;align-items:baseline}`
}

function clientScript() {
  return `const search=document.getElementById('search');const buttons=[...document.querySelectorAll('[data-filter]')];let active='all';function matchesKind(card){const kind=card.dataset.kind||'';if(active==='all')return true;if(active==='message')return ['input','before_agent_start','message_start','message_update','message_end','turn_end'].includes(kind);if(active==='hidden')return (card.dataset.search||'').includes('custom')||(card.dataset.search||'').includes('hidden');if(active==='atm_session')return ['atm_state','session_start','session_shutdown'].includes(kind);return kind===active}function apply(){const q=(search.value||'').toLowerCase();for(const card of document.querySelectorAll('.card[id]')){const text=(card.dataset.search||'').toLowerCase();card.style.display=matchesKind(card)&&text.includes(q)?'block':'none'}}search.addEventListener('input',apply);for(const button of buttons){button.addEventListener('click',()=>{active=button.dataset.filter;buttons.forEach(b=>b.classList.toggle('active',b===button));apply()})}buttons[0]?.classList.add('active');apply();`
}
```

- [ ] **Step 5: Verify HTML tests pass**

Run:

```bash
npm test
npm run typecheck
```

Expected: tests and typecheck pass. If Biome reports line length or complexity issues, split helper expressions in `html.ts` without changing behavior.

---

## Task 5: Wire recorder into Pi hooks and ATM state snapshots

**Files:**
- Modify: `src/index.ts`
- Modify: `src/full-export/recorder.ts` if helper signatures need small adjustments

- [ ] **Step 1: Add imports to `src/index.ts`**

Add these imports near existing imports:

```ts
import { filterEvents, parseFullExportFilter } from "./full-export/filters.js"
import { renderFullExportHtml } from "./full-export/html.js"
import {
  appendFullExportEvent,
  buildFallbackExportData,
  fullExportEventPath,
  isFullExportEnabled,
  readFullExportEvents,
} from "./full-export/recorder.js"
import type { FullExportEventInput } from "./full-export/recorder.js"
```

Also add Node imports:

```ts
import { writeFileSync } from "node:fs"
import { join, relative } from "node:path"
```

- [ ] **Step 2: Add recorder state inside `activeTokenManagement`**

After the existing `let cwd = process.cwd()` line, add:

```ts
  let fullExportCounter = 0
  let fullExportRecording = isFullExportEnabled()
```

Add this helper near the other local helper functions before `isManual()`:

```ts
  function recordFullExport(input: FullExportEventInput) {
    if (!fullExportRecording) return
    try {
      appendFullExportEvent({ sessionKey, cwd, counter: ++fullExportCounter }, input)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      debugLog(config, "full export recording failed", { kind: input.kind, message })
    }
  }
```

- [ ] **Step 3: Record `session_start` and warning**

At the end of the existing `session_start` handler, after status setup, add:

```ts
    fullExportRecording = isFullExportEnabled()
    if (fullExportRecording) {
      const warning =
        "ATM full export recording is enabled. Raw prompts, hidden messages, tool data, and provider payloads will be stored without redaction."
      ctx.ui.notify(warning, "info")
      debugLog(config, warning)
      recordFullExport({
        kind: "session_start",
        payload: {
          cwd,
          sessionKey,
          reason: (_event as { reason?: unknown }).reason,
          sessionFile: (_event as { sessionFile?: unknown }).sessionFile,
          model: asRuntimeContext(ctx).model,
          entriesCount: ctx.sessionManager.getEntries().length,
        },
        model: asRuntimeContext(ctx).model?.id ?? asRuntimeContext(ctx).model?.name,
      })
    }
```

- [ ] **Step 4: Record `before_agent_start` without changing behavior**

Replace the current `before_agent_start` handler with:

```ts
  pi.on("before_agent_start", async (event) => {
    const systemPrompt = config.enabled && !isManual() ? `${event.systemPrompt || ""}\n\n${prompt(config, cwd, "system.md")}` : undefined
    recordFullExport({
      kind: "before_agent_start",
      payload: { ...event, returnedSystemPrompt: systemPrompt },
    })
    if (!systemPrompt) return
    return { systemPrompt }
  })
```

Expected: full export records the raw hook event plus the chained prompt ATM returns, while disabled/manual ATM behavior remains unchanged.

- [ ] **Step 5: Record context rewrite details**

In the `context` handler, record even when ATM is disabled. Replace the first lines:

```ts
  pi.on("context", async (event, ctx) => {
    if (!config.enabled) return
    const contextMessages = toAtmMessages(event.messages)
```

with:

```ts
  pi.on("context", async (event, ctx) => {
    const contextMessages = toAtmMessages(event.messages)
    if (!config.enabled) {
      recordFullExport({ kind: "context", payload: { originalMessages: contextMessages, transformedMessages: contextMessages, atmEnabled: false } })
      return
    }
```

Before the existing `return { messages: ... }`, add:

```ts
    recordFullExport({
      kind: "context",
      payload: {
        originalMessages: contextMessages,
        trigger,
        compacted,
        transformedMessages: messages,
        report,
        nudge: nudge ? { changed: !!nudge.changed } : undefined,
        atmEnabled: true,
        manualMode: isManual(),
      },
    })
```

- [ ] **Step 6: Record ATM state when saving and resetting**

In the `save` helper, after `savePersistentState(sessionKey, state)`, add:

```ts
    recordFullExport({ kind: "atm_state", payload: { reason: "save", state } })
```

In `resetForCompaction`, after `debugLog(...)`, add:

```ts
    recordFullExport({ kind: "atm_state", payload: { reason: "compaction_reset", id, state } })
```

- [ ] **Step 7: Wire all observable Pi hooks**

Add these handlers after `session_start` and before `before_agent_start`:

```ts
  pi.on("input", async (event) => {
    recordFullExport({ kind: "input", payload: event })
  })

  pi.on("before_provider_request", async (event) => {
    recordFullExport({
      kind: "provider_request",
      payload: event.payload,
      provider: String((event as { provider?: unknown }).provider ?? ""),
      model: String((event as { model?: unknown }).model ?? ""),
    })
  })

  pi.on("after_provider_response", async (event) => {
    recordFullExport({
      kind: "provider_response",
      payload: event,
      provider: String((event as { provider?: unknown }).provider ?? ""),
      model: String((event as { model?: unknown }).model ?? ""),
    })
  })

  pi.on("turn_start", async (event) => {
    recordFullExport({ kind: "turn_start", payload: event, turnIndex: Number((event as { turnIndex?: unknown }).turnIndex) })
  })

  pi.on("turn_end", async (event) => {
    recordFullExport({ kind: "turn_end", payload: event, turnIndex: Number((event as { turnIndex?: unknown }).turnIndex) })
  })

  pi.on("message_start", async (event) => {
    recordFullExport({ kind: "message_start", payload: event })
  })

  pi.on("message_update", async (event) => {
    recordFullExport({ kind: "message_update", payload: event })
  })

  pi.on("message_end", async (event) => {
    recordFullExport({ kind: "message_end", payload: event })
  })

  pi.on("tool_execution_start", async (event) => {
    recordFullExport({
      kind: "tool_execution_start",
      payload: event,
      toolCallId: String((event as { toolCallId?: unknown; id?: unknown }).toolCallId ?? (event as { id?: unknown }).id ?? ""),
      toolName: String((event as { toolName?: unknown; name?: unknown }).toolName ?? (event as { name?: unknown }).name ?? ""),
    })
  })

  pi.on("tool_execution_update", async (event) => {
    recordFullExport({
      kind: "tool_execution_update",
      payload: event,
      toolCallId: String((event as { toolCallId?: unknown; id?: unknown }).toolCallId ?? (event as { id?: unknown }).id ?? ""),
      toolName: String((event as { toolName?: unknown; name?: unknown }).toolName ?? (event as { name?: unknown }).name ?? ""),
    })
  })

  pi.on("tool_execution_end", async (event) => {
    recordFullExport({
      kind: "tool_execution_end",
      payload: event,
      toolCallId: String((event as { toolCallId?: unknown; id?: unknown }).toolCallId ?? (event as { id?: unknown }).id ?? ""),
      toolName: String((event as { toolName?: unknown; name?: unknown }).toolName ?? (event as { name?: unknown }).name ?? ""),
    })
  })

  pi.on("tool_call", async (event) => {
    recordFullExport({
      kind: "tool_call",
      payload: event,
      toolCallId: String((event as { toolCallId?: unknown; id?: unknown }).toolCallId ?? (event as { id?: unknown }).id ?? ""),
      toolName: String((event as { toolName?: unknown; name?: unknown }).toolName ?? (event as { name?: unknown }).name ?? ""),
    })
  })

  pi.on("tool_result", async (event) => {
    recordFullExport({
      kind: "tool_result",
      payload: event,
      toolCallId: String((event as { toolCallId?: unknown; id?: unknown }).toolCallId ?? (event as { id?: unknown }).id ?? ""),
      toolName: String((event as { toolName?: unknown; name?: unknown }).toolName ?? (event as { name?: unknown }).name ?? ""),
    })
  })

  pi.on("session_shutdown", async (event) => {
    recordFullExport({ kind: "session_shutdown", payload: event })
  })
```

If TypeScript rejects exact hook names from Pi's extension type union, preserve runtime hook names by casting only the hook name argument:

```ts
  pi.on("before_provider_request" as never, async (event: unknown) => {
    const e = event as { payload?: unknown; provider?: unknown; model?: unknown }
    recordFullExport({ kind: "provider_request", payload: e.payload, provider: String(e.provider ?? ""), model: String(e.model ?? "") })
  })
```

- [ ] **Step 8: Verify hook wiring compiles**

Run:

```bash
npm run typecheck
npm test
```

Expected: TypeScript and tests pass. If `src/index.ts` exceeds 500 lines, extract repeated event metadata helpers into `src/full-export/hook-metadata.ts` rather than silencing Biome.

---

## Task 6: Implement `/atm export [filter]`

**Files:**
- Modify: `src/index.ts`
- Modify: `README.md` after behavior works

- [ ] **Step 1: Update command description/help**

Change the `registerCommand` description to include export:

```ts
    description:
      "Active Token Management: compress by default; export, context, stats, sweep, decompress, recompress, manual, enable, disable",
```

Update the `help` notification string:

```ts
            "/atm [compress [focus]] | export [filter] | context | stats | sweep [n] | decompress <id> | recompress <id> | manual [on|off] | enable | disable",
```

- [ ] **Step 2: Add `/atm export` case before `context`**

Add this case in the command switch:

```ts
        case "export": {
          const filter = parseFullExportFilter(tail)
          const eventPath = fullExportEventPath(undefined, sessionKey)
          const read = readFullExportEvents(eventPath)
          const warnings = [...read.warnings]
          if (filter.unknown.length) warnings.push(`Unknown filter token(s): ${filter.unknown.join(", ")}`)
          let fallback = undefined
          if (!read.events.length) {
            warnings.push(
              "Full export recording was not enabled or no event file exists for this session. Exact provider payloads and event history are unavailable.",
            )
            fallback = buildFallbackExportData(ctx.sessionManager, state)
          }
          const events = filterEvents(read.events, filter)
          const generatedAt = new Date().toISOString()
          const filename = `atm-export-${generatedAt.replace(/[:.]/g, "-")}.html`
          const outDir = ctx.cwd ?? cwd ?? process.cwd()
          const outPath = join(outDir, filename)
          const html = renderFullExportHtml({
            events,
            warnings,
            fallback,
            generatedAt,
            filterLabel: tail || "all",
            sessionKey,
            cwd: outDir,
          })
          writeFileSync(outPath, html)
          const shownPath = relative(process.cwd(), outPath).startsWith("..") ? outPath : relative(process.cwd(), outPath)
          ctx.ui.notify(`ATM export wrote ${shownPath || filename} with ${events.length} event${events.length === 1 ? "" : "s"}.`, "info")
          return
        }
```

Expected: export reads JSONL if present; otherwise still writes fallback HTML without mutating ATM state.

- [ ] **Step 3: Verify command compiles**

Run:

```bash
npm run typecheck
npm test
```

Expected: TypeScript and tests pass.

- [ ] **Step 4: Update README command summary**

In `README.md`, change the command block to:

```text
/atm [compress [focus]] | export [filter] | context | stats | sweep [n] | decompress <id> | recompress <id> | manual [on|off] | enable | disable
```

Add this section after `## Command`:

```md
### Full export

`/atm export [filter]` writes a self-contained HTML audit export in the current working directory. Filters are comma-separated event kinds or categories, for example:

```text
/atm export
/atm export provider_request,provider_response
/atm export tool,context
```

Full raw event recording is opt-in:

```sh
PI_ATM_FULL_EXPORT=1 pi
```

Truthy values are `1`, `true`, `yes`, and `on` case-insensitively. When enabled, raw JSONL audit events are stored under:

```text
~/.pi/agent/logs/atm/full-export
```

This data is not redacted. It can include raw prompts, hidden/custom messages, tool inputs and outputs, exact provider request payloads, and provider response metadata. If recording was not enabled, `/atm export` still writes fallback HTML from current session entries, current session context, and ATM state, but it warns that exact provider payloads and full event history are unavailable.
```

- [ ] **Step 5: Verify docs and formatting**

Run:

```bash
npm run lint
```

Expected: Biome succeeds, including README formatting.

---

## Task 7: Add focused integration-style tests for export command helpers

**Files:**
- Modify: `tests/full-export.test.ts`
- Modify: `src/full-export/recorder.ts` or `html.ts` only if tests reveal helper defects

- [ ] **Step 1: Add tests for export path naming and filtered HTML data**

Append:

```ts
test("full export output filename timestamp is filesystem safe", () => {
  const generatedAt = "2026-06-06T12:34:56.789Z"
  const filename = `atm-export-${generatedAt.replace(/[:.]/g, "-")}.html`

  assert.equal(filename, "atm-export-2026-06-06T12-34-56-789Z.html")
})

test("full export HTML can render fallback without recorded events", () => {
  const html = renderFullExportHtml({
    events: [],
    warnings: ["Full export recording was not enabled."],
    generatedAt: "2026-06-06T00:00:00.000Z",
    sessionKey: "session-1",
    cwd: "/tmp/project",
    fallback: {
      entries: [{ type: "custom", customType: "active-token-management-state" }],
      contextMessages: [{ role: "assistant", content: "fallback" }],
      state: { version: 1 },
    },
  })

  assert.match(html, /No events/)
  assert.match(html, /Fallback export data/)
  assert.match(html, /active-token-management-state/)
})
```

- [ ] **Step 2: Run tests**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Run full verification**

Run:

```bash
npm run check
npm test
```

Expected: Biome, TypeScript, fallow, and tests pass. If `npm run check` fails because `tsx` or new test-only code appears unused to fallow, adjust exports/imports so every exported function is used or configure no production-only dead code.

---

## Task 8: Manual Pi verification

**Files:**
- No required code changes unless manual verification reveals a defect.

- [ ] **Step 1: Start Pi with full recording enabled**

Run from a test project or this repo:

```bash
PI_ATM_FULL_EXPORT=1 pi
```

Expected: UI notification appears:

```text
ATM full export recording is enabled. Raw prompts, hidden messages, tool data, and provider payloads will be stored without redaction.
```

- [ ] **Step 2: Generate representative activity**

In Pi, send a prompt that causes at least one tool call, for example:

```text
List the files in this repository and tell me which one defines the ATM command.
```

Expected: normal assistant response, at least one tool event, and no ATM recording errors.

- [ ] **Step 3: Export all events**

In Pi, run:

```text
/atm export
```

Expected: notification reports `atm-export-YYYY-MM-DDTHH-MM-SS-sssZ.html` written in the current working directory with a nonzero event count.

- [ ] **Step 4: Inspect JSONL storage**

Run in a shell:

```bash
ls -la ~/.pi/agent/logs/atm/full-export
head -n 3 ~/.pi/agent/logs/atm/full-export/*.jsonl
```

Expected: JSONL file exists; each valid line has `version:1`, `sessionKey`, `kind`, `timestamp`, and `payload`.

- [ ] **Step 5: Inspect HTML export**

Open the generated HTML file in a browser.

Expected visible behavior:

- dark monospaced UI
- sticky sidebar/timeline
- search box filters cards
- filter chips for all required categories
- provider request cards show raw request JSON
- context cards show raw original/transformed payloads
- tool cards show tool name/call id and raw result data
- hidden/custom messages are present in raw JSON and searchable

- [ ] **Step 6: Verify filtered export**

In Pi, run:

```text
/atm export provider_request,provider_response
/atm export tool,context
```

Expected: generated HTML files contain only matching event kinds and warnings only for malformed lines or unknown filter tokens.

- [ ] **Step 7: Verify fallback export**

Start Pi without `PI_ATM_FULL_EXPORT`, or use a session with no matching JSONL file, then run:

```text
/atm export
```

Expected: HTML file is still written and includes a clear warning that exact provider payloads and event history are unavailable.

---

## Self-Review Checklist

- Spec coverage:
  - Opt-in env var: Task 3 tests and Task 5 wiring.
  - JSONL storage under `~/.pi/agent/logs/atm/full-export`: Task 3.
  - Safe session filename with preserved envelope session key: Task 3.
  - Exact provider request payload: Task 5 `before_provider_request` records `event.payload`.
  - All listed observable hook kinds: Task 5.
  - Context original/transformed messages plus prune/nudge/trigger metadata: Task 5.
  - `/atm export [filter]`: Task 6.
  - Fallback export without recording: Task 4 and Task 6.
  - Self-contained HTML with dark UI, search, filters, sidebar, cards, raw JSON: Task 4.
  - Malformed JSONL tolerance: Task 3.
  - README documentation: Task 6.
- Placeholder scan: no unresolved placeholders or unexpanded repeated-work references are present.
- Type consistency:
  - Event names use `FullExportKind` from Task 2 throughout.
  - Filter parser returns `ParsedFullExportFilter` shape used by `filterEvents` and `/atm export`.
  - Recorder append accepts `FullExportEventInput` and writes `FullExportEvent` envelopes.
  - HTML renderer accepts `FullExportRenderInput` and uses `FullExportEvent`.

## Final Verification Before Claiming Complete

Run all commands and keep the output for the final response:

```bash
npm test
npm run typecheck
npm run check
```

If manual Pi verification is possible, also report:

- path to generated HTML export
- count of recorded JSONL events
- confirmation that provider request payload, context rewrite data, tool events, and fallback warning behavior were inspected

Do not claim the feature is complete unless these checks pass or any remaining failures are explicitly documented as blockers.
