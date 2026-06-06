import type { ConfigRecord, NudgeAudit, State } from "./types.js"
import { emptyState, STATE_TYPE } from "./types.js"

export function loadState(entries: unknown[]): State {
  const fallback = emptyState()
  const source = stateSource(entries)
  return {
    ...fallback,
    ...source,
    version: 1,
    nextId: sanitizeNextId(source, fallback),
    compressions: sanitizeArray(source.compressions) as State["compressions"],
    prunedTools: sanitizeArray(source.prunedTools) as State["prunedTools"],
    stats: sanitizeStats(source, fallback),
    nudges: sanitizeNudges(source, fallback),
    nudgeAudit: sanitizeNudgeAudit(source.nudgeAudit),
  }
}

function stateSource(entries: unknown[]): ConfigRecord {
  const latest = [...entries].reverse().find(isStateEntryRecord)?.data
  return isRecord(latest) && latest.version === 1 ? latest : emptyState()
}

function sanitizeNextId(source: ConfigRecord, fallback: State) {
  return Math.max(1, Number(source.nextId) || fallback.nextId)
}

function sanitizeArray(value: unknown) {
  return Array.isArray(value) ? value : []
}

function sanitizeStats(source: ConfigRecord, fallback: State) {
  const stats = isRecord(source.stats) ? source.stats : fallback.stats
  return {
    ...fallback.stats,
    ...stats,
    contextRuns: positiveNumber(stats.contextRuns),
    dedupePrunes: positiveNumber(stats.dedupePrunes),
    errorPrunes: positiveNumber(stats.errorPrunes),
    estimatedTokensSaved: positiveNumber(stats.estimatedTokensSaved),
  }
}

function sanitizeNudges(source: ConfigRecord, fallback: State) {
  const defaultNudges = fallback.nudges ?? { context: [], turn: [], iteration: [] }
  const nudges = isRecord(source.nudges) ? source.nudges : defaultNudges
  return {
    context: stringArray(nudges.context),
    turn: stringArray(nudges.turn),
    iteration: stringArray(nudges.iteration),
  }
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String) : []
}

function sanitizeNudgeAudit(raw: unknown): NudgeAudit[] {
  return Array.isArray(raw) ? raw.map(sanitizeNudgeAuditEntry).filter(isDefined).slice(-100) : []
}

function sanitizeNudgeAuditEntry(value: unknown): NudgeAudit | undefined {
  if (!isRecord(value)) return undefined
  const usageTokens = positiveOptional(value.usageTokens)
  const estimatedTokens = positiveOptional(value.estimatedTokens)
  return {
    type: sanitizeNudgeType(value.type),
    anchor: String(value.anchor ?? ""),
    text: String(value.text ?? ""),
    tokens: positiveNumber(value.tokens),
    usageTokens,
    estimatedTokens,
    messageCount: positiveNumber(value.messageCount),
    createdAt: positiveNumber(value.createdAt) || Date.now(),
    reason: value.reason === undefined ? undefined : String(value.reason),
  }
}

function isRecord(value: unknown): value is ConfigRecord {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function isStateEntryRecord(value: unknown): value is ConfigRecord & { data?: unknown } {
  return isRecord(value) && value.type === "custom" && value.customType === STATE_TYPE
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined
}

function positiveNumber(value: unknown) {
  return Math.max(0, Number(value) || 0)
}

function positiveOptional(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : undefined
}

function sanitizeNudgeType(value: unknown): NudgeAudit["type"] {
  return ["context", "turn", "iteration"].includes(String(value)) ? (String(value) as NudgeAudit["type"]) : "turn"
}
