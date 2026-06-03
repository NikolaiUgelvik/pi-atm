import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { Compression, MutableRecord, NudgeAudit, PrunedTool, RuntimeContext, State } from "./types.js"
import { emptyState } from "./types.js"

export type AllTimeStats = {
  sessions: number
  compressions: number
  activeCompressions: number
  prunedTools: number
  estimatedTokensSaved: number
  compressionMs: number
  compressedMessages: number
  summaryTokens: number
  originalTokens: number
}

function baseDir() {
  return join(process.env.HOME || ".", ".pi/agent/state/atm")
}
function safeName(s: string) {
  return createHash("sha1")
    .update(s || "default")
    .digest("hex")
    .slice(0, 24)
}
export function sessionKeyFromContext(ctx: Partial<RuntimeContext>, cwd = process.cwd()) {
  return String(
    ctx.session?.id ??
      ctx.sessionId ??
      ctx.sessionManager?.sessionId ??
      ctx.sessionManager?.session?.id ??
      ctx.sessionManager?.id ??
      cwd ??
      "default",
  )
}
function statePath(sessionKey: string) {
  return join(baseDir(), `${safeName(sessionKey)}.json`)
}

export function loadPersistentState(sessionKey: string): State | undefined {
  const file = statePath(sessionKey)
  if (!existsSync(file)) return undefined
  try {
    return sanitizeState(JSON.parse(readFileSync(file, "utf8")))
  } catch {
    return undefined
  }
}

export function savePersistentState(sessionKey: string, state: State) {
  mkdirSync(baseDir(), { recursive: true })
  const snapshot = sanitizeState({ ...state, sessionKey, lastUpdated: Date.now() })
  writeFileSync(statePath(sessionKey), JSON.stringify(snapshot, null, 2))
}

export function allTimeStats(): AllTimeStats {
  const dir = baseDir()
  const out = emptyAllTimeStats()
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue
    try {
      accumulateStateStats(out, sanitizeState(JSON.parse(readFileSync(join(dir, name), "utf8"))))
    } catch {}
  }
  return out
}

function emptyAllTimeStats(): AllTimeStats {
  return {
    sessions: 0,
    compressions: 0,
    activeCompressions: 0,
    prunedTools: 0,
    estimatedTokensSaved: 0,
    compressionMs: 0,
    compressedMessages: 0,
    summaryTokens: 0,
    originalTokens: 0,
  }
}

function accumulateStateStats(out: AllTimeStats, state: State) {
  out.sessions++
  out.compressions += state.compressions.length
  out.activeCompressions += state.compressions.filter((c) => c.active).length
  out.prunedTools += state.prunedTools?.length ?? 0
  out.estimatedTokensSaved += state.stats.estimatedTokensSaved
  for (const c of state.compressions) {
    out.compressionMs += c.durationMs ?? 0
    out.compressedMessages += c.fingerprints.length
    out.summaryTokens += c.summaryTokenEstimate
    out.originalTokens += c.originalTokenEstimate
  }
}

function sanitizeState(raw: unknown): State {
  const source = isRecord(raw) ? raw : {}
  const fallback = emptyState()
  const compressions = arrayFrom(source.compressions).map(sanitizeCompression).filter(isDefined)
  const nextId = Math.max(1, numberFrom(source.nextId, 1), 1 + compressions.reduce((m, c) => Math.max(m, c.id), 0))
  const statsSource = isRecord(source.stats) ? source.stats : {}
  return {
    version: 1,
    nextId,
    manualMode: optionalBoolean(source.manualMode),
    manualCompressionPending: optionalBoolean(source.manualCompressionPending),
    manualPendingPrompt: optionalString(source.manualPendingPrompt),
    sessionKey: optionalString(source.sessionKey),
    lastUpdated: optionalNumber(source.lastUpdated),
    lastCompaction: optionalString(source.lastCompaction),
    compressions,
    prunedTools: arrayFrom(source.prunedTools).map(sanitizePrunedTool).filter(isDefined),
    nudges: sanitizeNudges(source.nudges),
    nudgeAudit: arrayFrom(source.nudgeAudit).map(sanitizeNudgeAudit).filter(isDefined).slice(-100),
    stats: {
      ...fallback.stats,
      compressionsCreated: numberFrom(statsSource.compressionsCreated, fallback.stats.compressionsCreated),
      contextRuns: numberFrom(statsSource.contextRuns, fallback.stats.contextRuns),
      dedupePrunes: numberFrom(statsSource.dedupePrunes, fallback.stats.dedupePrunes),
      errorPrunes: numberFrom(statsSource.errorPrunes, fallback.stats.errorPrunes),
      estimatedTokensSaved: numberFrom(statsSource.estimatedTokensSaved, fallback.stats.estimatedTokensSaved),
      lastContext: isRecord(statsSource.lastContext)
        ? (statsSource.lastContext as State["stats"]["lastContext"])
        : undefined,
    },
  }
}

function sanitizeCompression(value: unknown): Compression | undefined {
  if (!isRecord(value)) return undefined
  const id = Number(value.id)
  if (!Number.isFinite(id)) return undefined
  return {
    id,
    mode: value.mode === "message" ? "message" : "range",
    active: Boolean(value.active),
    createdAt: numberFrom(value.createdAt, Date.now()),
    summary: String(value.summary ?? ""),
    topic: optionalString(value.topic),
    focus: optionalString(value.focus),
    fingerprints: arrayFrom(value.fingerprints).map(String),
    startFingerprint: optionalString(value.startFingerprint),
    endFingerprint: optionalString(value.endFingerprint),
    originalTokenEstimate: positiveNumberFrom(value.originalTokenEstimate),
    summaryTokenEstimate: positiveNumberFrom(value.summaryTokenEstimate),
    durationMs: optionalPositiveNumber(value.durationMs),
    consumedBlockIds: optionalNumberArray(value.consumedBlockIds),
    consumedBy: optionalNumber(value.consumedBy),
    userDecompressed: optionalBoolean(value.userDecompressed),
  }
}

function sanitizePrunedTool(value: unknown): PrunedTool | undefined {
  if (!isRecord(value) || typeof value.toolCallId !== "string") return undefined
  return {
    toolCallId: value.toolCallId,
    toolName: optionalString(value.toolName),
    reason: String(value.reason ?? "manually pruned"),
    originalTokenEstimate: optionalPositiveNumber(value.originalTokenEstimate),
  }
}

function sanitizeNudges(value: unknown): NonNullable<State["nudges"]> {
  const source = isRecord(value) ? value : {}
  return {
    context: arrayFrom(source.context).map(String),
    turn: arrayFrom(source.turn).map(String),
    iteration: arrayFrom(source.iteration).map(String),
  }
}

function sanitizeNudgeAudit(value: unknown): NudgeAudit | undefined {
  if (!isRecord(value)) return undefined
  const type = ["context", "turn", "iteration"].includes(String(value.type))
    ? (String(value.type) as NudgeAudit["type"])
    : "turn"
  const usageTokens = positiveOptional(value.usageTokens)
  const estimatedTokens = positiveOptional(value.estimatedTokens)
  return {
    type,
    anchor: String(value.anchor ?? ""),
    text: String(value.text ?? ""),
    tokens: positiveNumberFrom(value.tokens),
    usageTokens,
    estimatedTokens,
    messageCount: positiveNumberFrom(value.messageCount),
    createdAt: positiveNumberFrom(value.createdAt) || Date.now(),
    reason: optionalString(value.reason),
  }
}

function isRecord(value: unknown): value is MutableRecord {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function arrayFrom(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined
}

function numberFrom(value: unknown, fallback: number) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function positiveNumberFrom(value: unknown) {
  return Math.max(0, Number(value) || 0)
}

function positiveOptional(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : undefined
}

function optionalPositiveNumber(value: unknown) {
  return value === undefined ? undefined : positiveNumberFrom(value)
}

function optionalNumber(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function optionalString(value: unknown) {
  return value === undefined ? undefined : String(value)
}

function optionalBoolean(value: unknown) {
  return value === undefined ? undefined : Boolean(value)
}

function optionalNumberArray(value: unknown) {
  if (!Array.isArray(value)) return undefined
  const numbers = value.map(Number).filter(Number.isFinite)
  return numbers.length ? numbers : undefined
}
