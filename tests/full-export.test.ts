import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { filterEvents, parseFullExportFilter } from "../src/full-export/filters.js"
import { renderFullExportHtml } from "../src/full-export/html.js"
import { renderEventEntry, renderFallback, renderSidebarItem } from "../src/full-export/html-renderers.js"
import {
  appendFullExportEvent,
  buildFallbackExportData,
  fullExportEventPath,
  isFullExportEnabled,
  readFullExportEvents,
  safeSessionFileStem,
} from "../src/full-export/recorder.js"
import type { FullExportEvent } from "../src/full-export/types.js"

function event(kind: FullExportEvent["kind"], id: string = kind): FullExportEvent {
  return {
    version: 1,
    id,
    timestamp: "2026-06-06T00:00:00.000Z",
    sessionKey: "session-1",
    kind,
    payload: { marker: kind },
  }
}

function renderTestExport(events: FullExportEvent[], warnings: string[] = []) {
  return renderFullExportHtml({
    events,
    warnings,
    generatedAt: "2026-06-06T00:00:00.000Z",
    sessionKey: "session-1",
    cwd: "/tmp/project",
  })
}

function assertHtmlMatches(html: string, patterns: RegExp[]) {
  for (const pattern of patterns) assert.match(html, pattern)
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

test("full export HTML uses Pi-style shell and escapes content", () => {
  const html = renderTestExport(
    [
      { ...event("input", "e1"), payload: { type: "input", text: "Hello & goodbye", source: "interactive" } },
      {
        ...event("provider_request", "e2"),
        provider: "test-provider",
        model: "m1",
        payload: { prompt: "<script>alert(1)</script>", messages: [{ role: "user", content: "secret" }] },
      },
    ],
    ["Exact provider payload history unavailable before recording was enabled."],
  )

  assertHtmlMatches(html, [
    /<div id="app">/,
    /<aside id="sidebar">/,
    /<div id="sidebar-resizer"><\/div>/,
    /<main id="content">/,
    /<section id="messages">/,
    /class="sidebar-search"/,
    /class="filter-btn active" data-filter="all"/,
    /class="tree-container"/,
    /class="tree-status"/,
    /class="user-message export-entry"/,
    /class="provider-audit export-entry"/,
    /Exact provider payload history unavailable/,
    /test-provider/,
    /Hello &amp; goodbye/,
    /&lt;script&gt;alert\(1\)&lt;\/script&gt;/,
  ])
  assert.equal(html.includes("<script>alert(1)</script>"), false)
})

test("full export HTML renders all event categories with raw JSON details", () => {
  const events: FullExportEvent[] = [
    { ...event("input", "input-1"), payload: { type: "input", text: "user asks" } },
    {
      ...event("message_end", "assistant-1"),
      payload: {
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "assistant replies" }] },
      },
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
    {
      ...event("provider_response", "provider-1"),
      provider: "openai",
      model: "gpt-test",
      payload: { usage: { input: 12, output: 3 } },
    },
    { ...event("atm_state", "atm-1"), payload: { state: { stats: { contextRuns: 2 } } } },
  ]

  const html = renderTestExport(events)

  assert.equal((html.match(/class="raw-json"/g) ?? []).length, events.length)
  assert.equal((html.match(/class="tree-node/g) ?? []).length, events.length)
  assertHtmlMatches(html, [
    /class="assistant-message export-entry"/,
    /class="tool-execution success export-entry"/,
    /class="context-audit export-entry"/,
    /class="provider-audit export-entry"/,
    /class="atm-audit export-entry"/,
    /assistant replies/,
    /src\/full-export\/html\.ts/,
    /original 1 · transformed 2/,
    /gpt-test/,
  ])
})

test("full export render helpers expose sidebar, entry, and fallback markup", () => {
  const entry = renderEventEntry({
    ...event("tool_result", "tool-result-helper"),
    toolName: "read",
    toolCallId: "call-helper",
    payload: { content: [{ type: "text", text: "helper output" }], isError: false },
  })
  const sidebar = renderSidebarItem({ ...event("input", "sidebar-helper"), payload: { text: "sidebar text" } })
  const fallback = renderFallback({ entries: [], contextMessages: [], state: { version: 1 } })

  assert.match(entry, /class="tool-execution success export-entry"/)
  assert.match(entry, /class="raw-json"/)
  assert.match(entry, /helper output/)
  assert.match(sidebar, /class="tree-node"/)
  assert.match(sidebar, /data-target="sidebar-helper"/)
  assert.match(sidebar, /sidebar text/)
  assert.match(fallback, /class="fallback-block"/)
  assert.match(fallback, /Fallback export data/)
})

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

  assert.match(html, /No recorded events/)
  assert.match(html, /class="fallback-block"/)
  assert.match(html, /Fallback export data/)
  assert.match(html, /active-token-management-state/)
})
