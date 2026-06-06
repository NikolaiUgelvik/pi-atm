import assert from "node:assert/strict"
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import activeTokenManagement from "../extensions/pi-atm.js"
import { fullExportEventPath, readFullExportEvents } from "../src/full-export/recorder.js"
import { injectMessageAliases } from "../src/message-alias-inject.js"
import { stripAliasesFromMessages } from "../src/message-alias-strip.js"
import { fingerprintMessage } from "../src/message-fingerprint.js"
import { indexFromAlias } from "../src/message-id-alias.js"
import { EXT } from "../src/types.js"

type MockHandler = (...args: unknown[]) => Promise<unknown> | unknown
type MockCommand = { handler: (args: string, ctx: unknown) => Promise<void> | void }

async function withFullExportHome(run: (home: string) => Promise<void>) {
  const home = mkdtempSync(join(tmpdir(), "pi-atm-hooks-"))
  const previousHome = process.env.HOME
  const previousFullExport = process.env.PI_ATM_FULL_EXPORT
  try {
    process.env.HOME = home
    process.env.PI_ATM_FULL_EXPORT = "1"
    await run(home)
  } finally {
    restoreEnv("HOME", previousHome)
    restoreEnv("PI_ATM_FULL_EXPORT", previousFullExport)
    rmSync(home, { recursive: true, force: true })
  }
}

function restoreEnv(name: string, previous: string | undefined) {
  if (previous === undefined) delete process.env[name]
  else process.env[name] = previous
}

function lifecycleMockPi(handlers: Record<string, MockHandler>) {
  return {
    on(name: string, handler: MockHandler) {
      handlers[name] = handler
    },
    appendEntry() {},
    registerTool() {},
    registerCommand() {},
    sendMessage() {},
    sendUserMessage() {},
  }
}

function lifecycleContext() {
  return {
    cwd: "/tmp/pi-atm-project",
    sessionId: "test-session",
    model: { id: "m1", name: "Model 1" },
    ui: { notify() {}, setStatus() {} },
    sessionManager: {
      getEntries: () => [],
      buildSessionContext: () => ({ messages: [{ role: "user", content: "hello" }] }),
    },
  }
}

async function emitLifecycleHooks(handlers: Record<string, MockHandler>, ctx: ReturnType<typeof lifecycleContext>) {
  await handlers.session_start?.({ reason: "startup", sessionFile: "session.jsonl" }, ctx)
  await handlers.input?.({ text: "hello", source: "interactive" }, ctx)
  await handlers.before_agent_start?.({ prompt: "hello", systemPrompt: "base" }, ctx)
  await handlers.context?.({ messages: [{ role: "user", content: "hello" }] }, ctx)
  await handlers.tool_call?.({ toolName: "bash", toolCallId: "tool-1", input: { command: "echo raw" } }, ctx)
  await handlers.session_shutdown?.({ reason: "quit" }, ctx)
}

function assertLifecycleExport(home: string) {
  const { events } = readFullExportEvents(fullExportEventPath(home, "test-session"))
  assertLifecycleKinds(events.map((event) => event.kind))
  assertToolCallExport(events.find((event) => event.kind === "tool_call"))
  assertBeforeStartExport(events.find((event) => event.kind === "before_agent_start"))
}

function assertLifecycleKinds(kinds: string[]) {
  assert.deepEqual(
    kinds.filter((kind) => kind !== "atm_state"),
    ["session_start", "input", "before_agent_start", "context", "tool_call", "session_shutdown"],
  )
}

function assertToolCallExport(toolCall: { toolName?: unknown; toolCallId?: unknown; payload?: unknown } | undefined) {
  assert.equal(toolCall?.toolName, "bash")
  assert.equal(toolCall?.toolCallId, "tool-1")
  assert.deepEqual((toolCall?.payload as { input?: unknown }).input, { command: "echo raw" })
}

function assertBeforeStartExport(beforeStart: { payload?: unknown } | undefined) {
  assert.equal(typeof (beforeStart?.payload as { returnedSystemPrompt?: unknown }).returnedSystemPrompt, "string")
}

function assertAliasCatalog(catalog: ReturnType<typeof injectMessageAliases>[number] | undefined) {
  assertAliasCatalogEnvelope(catalog)
  assertAliasCatalogContent(String(catalog?.content))
}

function assertAliasCatalogEnvelope(catalog: ReturnType<typeof injectMessageAliases>[number] | undefined) {
  assert.equal(catalog?.role, "custom")
  assert.equal(catalog?.customType, EXT)
  assert.equal(catalog?.display, false)
}

function assertAliasCatalogContent(content: string) {
  assert.match(content, /<atm-aliases\b/)
  assert.match(content, /id="m0001"/)
  assert.match(content, /id="m0002"/)
  assert.match(content, /hello/)
  assert.match(content, /world/)
}

function assertVisibleAliasMessages(withAliases: ReturnType<typeof injectMessageAliases>) {
  assert.equal(withAliases.length, 3)
  assert.equal(String(withAliases[0]?.content).includes("atm-message"), false)
  assert.equal(JSON.stringify(withAliases[1]?.content).includes("atm-message"), false)
}

test("extension exports a function", () => {
  assert.equal(typeof activeTokenManagement, "function")
})

test("message aliases are model-visible without mutating visible message text", () => {
  const withAliases = injectMessageAliases([
    { role: "user", content: "hello" },
    { role: "assistant", content: [{ type: "text", text: "world" }] },
  ])

  assertVisibleAliasMessages(withAliases)
  assertAliasCatalog(withAliases[2])
})

test("stripping aliases removes the hidden catalog and preserves compression indices", () => {
  const messages = [
    { role: "user", content: "first" },
    { role: "assistant", content: "second" },
    { role: "toolResult", content: [{ type: "text", text: "third" }] },
  ]

  const stripped = stripAliasesFromMessages(injectMessageAliases(messages))

  assert.deepEqual(stripped, messages)
  assert.equal(indexFromAlias("m0001"), 0)
  assert.equal(indexFromAlias("m0003"), 2)
})

test("hidden alias catalog can be fingerprinted safely", () => {
  const withAliases = injectMessageAliases([{ role: "user", content: "hello" }])
  const catalog = withAliases.at(-1)

  assert.doesNotThrow(() => fingerprintMessage(catalog ?? {}))
})

test("full export records Pi lifecycle hooks when enabled", async () => {
  await withFullExportHome(async (home) => {
    const handlers: Record<string, MockHandler> = {}
    activeTokenManagement(lifecycleMockPi(handlers) as never)
    await emitLifecycleHooks(handlers, lifecycleContext())
    assertLifecycleExport(home)
  })
})

test("/atm export writes fallback HTML when no full export events exist", async () => {
  const home = mkdtempSync(join(tmpdir(), "pi-atm-export-home-"))
  const cwd = mkdtempSync(join(tmpdir(), "pi-atm-export-cwd-"))
  const previousHome = process.env.HOME
  const previousFullExport = process.env.PI_ATM_FULL_EXPORT
  const handlers: Record<string, MockHandler> = {}
  const commands: Record<string, MockCommand> = {}
  const notifications: string[] = []

  try {
    process.env.HOME = home
    delete process.env.PI_ATM_FULL_EXPORT
    const pi = {
      on(name: string, handler: MockHandler) {
        handlers[name] = handler
      },
      appendEntry() {},
      registerTool() {},
      registerCommand(name: string, command: MockCommand) {
        commands[name] = command
      },
      sendMessage() {},
      sendUserMessage() {},
    }
    const ctx = {
      cwd,
      sessionId: "export-session",
      ui: {
        notify(message: string) {
          notifications.push(message)
        },
        setStatus() {},
      },
      sessionManager: {
        getEntries: () => [{ type: "custom", customType: "example", data: { value: 1 } }],
        buildSessionContext: () => ({ messages: [{ role: "user", content: "fallback message" }] }),
      },
    }

    activeTokenManagement(pi as never)
    await handlers.session_start?.({ reason: "startup" }, ctx)
    await commands.atm?.handler("export", ctx)

    const exports = readdirSync(cwd).filter((name) => name.startsWith("atm-export-") && name.endsWith(".html"))
    assert.equal(exports.length, 1)
    const html = readFileSync(join(cwd, exports[0] ?? ""), "utf8")
    assert.match(html, /Full export recording was not enabled or no event file exists/)
    assert.match(html, /fallback message/)
    assert.match(html, /&quot;customType&quot;: &quot;example&quot;/)
    assert.ok(notifications.some((message) => /ATM export wrote .* with 0 events\./.test(message)))
  } finally {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    if (previousFullExport === undefined) delete process.env.PI_ATM_FULL_EXPORT
    else process.env.PI_ATM_FULL_EXPORT = previousFullExport
    rmSync(home, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  }
})
