import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { AtmMessage, Config, PruneReport, State } from "./types.js"

function baseDir() {
  return join(process.env.HOME || ".", ".pi/agent/logs/atm")
}
function day() {
  return new Date().toISOString().slice(0, 10)
}
function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-")
}

export function debugLog(config: Config, message: string, data?: unknown) {
  if (!config.debug) return
  const dir = join(baseDir(), "daily")
  mkdirSync(dir, { recursive: true })
  appendFileSync(
    join(dir, `${day()}.log`),
    `[${new Date().toISOString()}] ${message}${data === undefined ? "" : ` ${safeJson(data)}`}\n`,
  )
}

export function debugSnapshot(
  config: Config,
  label: string,
  payload: { messages: AtmMessage[]; report: PruneReport; state: State },
) {
  if (!config.debug) return
  const dir = join(baseDir(), "context")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${stamp()}-${label}.json`), safeJson(payload, 2))
}

function safeJson(value: unknown, space?: number) {
  try {
    return JSON.stringify(value, null, space)
  } catch {
    return JSON.stringify({ error: "Could not serialize debug payload" })
  }
}
