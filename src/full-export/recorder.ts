import { createHash } from "node:crypto"
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { FullExportEvent, FullExportFallbackData, FullExportKind } from "./types.js"

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

function fullExportBaseDir(home = process.env.HOME || ".") {
  return join(home, ".pi/agent/logs/atm/full-export")
}

export function safeSessionFileStem(sessionKey: string) {
  return createHash("sha1")
    .update(sessionKey || "default")
    .digest("hex")
    .slice(0, 24)
}

export function fullExportEventPath(home: string | undefined, sessionKey: string) {
  const path = join(fullExportBaseDir(home), `${safeSessionFileStem(sessionKey)}.jsonl`)
  mkdirSync(dirname(path), { recursive: true })
  return path
}

export function appendFullExportEvent(ctx: FullExportAppendContext, input: FullExportEventInput) {
  const path = fullExportEventPath(ctx.home, ctx.sessionKey)
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
  for (const [index, line] of fullExportLines(path).entries()) collectFullExportLine(line, index + 1, events, warnings)
  return { events, warnings }
}

function fullExportLines(path: string) {
  return readFileSync(path, "utf8").split(/\r?\n/)
}

function collectFullExportLine(line: string, lineNumber: number, events: FullExportEvent[], warnings: string[]) {
  if (!line.trim()) return
  const parsed = parseFullExportLine(line, lineNumber)
  if (typeof parsed === "string") warnings.push(parsed)
  else events.push(parsed)
}

function parseFullExportLine(line: string, lineNumber: number) {
  try {
    return validFullExportEvent(JSON.parse(line)) ?? `Ignored invalid full export event on line ${lineNumber}.`
  } catch (error: unknown) {
    return `Could not parse full export JSONL line ${lineNumber}: ${errorMessage(error)}`
  }
}

function validFullExportEvent(value: unknown) {
  if (!value || typeof value !== "object") return undefined
  const event = value as FullExportEvent
  return event.version === 1 && typeof event.kind === "string" ? event : undefined
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function buildFallbackExportData(
  sessionManager: {
    getEntries?: () => unknown[]
    buildSessionContext?: () => { messages?: unknown[] }
  },
  state: unknown,
): FullExportFallbackData {
  return {
    entries: makeJsonSafe(safeCall(() => sessionManager.getEntries?.() ?? [])) as unknown[],
    contextMessages: makeJsonSafe(safeCall(() => sessionManager.buildSessionContext?.().messages ?? [])) as unknown[],
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

function makeJsonSafe(value: unknown): unknown {
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
