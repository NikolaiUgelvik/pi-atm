import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { Config, ConfigRecord, MutableRecord, NudgeAudit, State } from "./types.js"
import { defaultConfig, emptyState, STATE_TYPE } from "./types.js"
import { clone, stripJsonComments } from "./utils.js"

let lastConfigWarnings: string[] = []
export function getConfigWarnings() {
  return lastConfigWarnings
}

export function loadState(entries: unknown[]): State {
  const latestEntry = [...entries].reverse().find(isStateEntryRecord)
  const latest = latestEntry?.data
  const source = isRecord(latest) && latest.version === 1 ? latest : emptyState()
  const fallback = emptyState()
  const stats = isRecord(source.stats) ? source.stats : fallback.stats
  const defaultNudges = fallback.nudges ?? { context: [], turn: [], iteration: [] }
  const nudges = isRecord(source.nudges) ? source.nudges : defaultNudges
  return {
    ...fallback,
    ...source,
    version: 1,
    nextId: Math.max(1, Number(source.nextId) || fallback.nextId),
    compressions: Array.isArray(source.compressions) ? (source.compressions as State["compressions"]) : [],
    prunedTools: Array.isArray(source.prunedTools) ? (source.prunedTools as State["prunedTools"]) : [],
    stats: {
      ...fallback.stats,
      ...stats,
      contextRuns: Number(stats.contextRuns) || 0,
      dedupePrunes: Number(stats.dedupePrunes) || 0,
      errorPrunes: Number(stats.errorPrunes) || 0,
      estimatedTokensSaved: Number(stats.estimatedTokensSaved) || 0,
    },
    nudges: {
      context: Array.isArray(nudges.context) ? nudges.context.map(String) : [],
      turn: Array.isArray(nudges.turn) ? nudges.turn.map(String) : [],
      iteration: Array.isArray(nudges.iteration) ? nudges.iteration.map(String) : [],
    },
    nudgeAudit: sanitizeNudgeAudit(source.nudgeAudit),
  }
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

export function loadConfig(cwd: string): Config {
  lastConfigWarnings = []
  const candidates = [
    join(process.env.HOME || "", ".pi/agent/atm.jsonc"),
    join(process.env.HOME || "", ".pi/agent/atm.json"),
    join(cwd, ".pi/atm.jsonc"),
    join(cwd, ".pi/atm.json"),
  ]
  let cfg: Config = clone(defaultConfig)
  for (const file of candidates) {
    if (!existsSync(file)) continue
    try {
      const parsed: unknown = JSON.parse(stripJsonComments(readFileSync(file, "utf8")))
      lastConfigWarnings.push(...validateConfigShape(parsed, file))
      cfg = mergeConfig(cfg, parsed)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      lastConfigWarnings.push(`${file}: failed to parse ATM config: ${message}`)
    }
  }
  lastConfigWarnings.push(...validateConfigShape(cfg, "merged config"))
  return cfg
}

function validateConfigShape(obj: unknown, label: string, schema: unknown = defaultConfig, path = ""): string[] {
  if (!isRecord(obj) || !isRecord(schema)) return [`${label}: expected object at ${path || "root"}`]
  return Object.entries(obj).flatMap(([key, value]) => validateConfigEntry(key, value, schema, label, path))
}

function validateConfigEntry(key: string, value: unknown, schema: ConfigRecord, label: string, path: string) {
  if (!path && key === "$schema") return []
  const childPath = path ? `${path}.${key}` : key
  if (!(key in schema)) return [`${label}: unknown config key ${childPath}`]
  return validateConfigValue(value, schema[key], label, childPath)
}

function validateConfigValue(value: unknown, expected: unknown, label: string, path: string): string[] {
  if (Array.isArray(expected)) return validateArrayValue(value, label, path)
  if (isRecord(expected)) return validateObjectValue(value, expected, label, path)
  return validateScalarValue(value, expected, label, path)
}

function validateArrayValue(value: unknown, label: string, path: string) {
  if (!Array.isArray(value)) return [`${label}: ${path} should be an array`]
  return value.every((item) => typeof item === "string") ? [] : [`${label}: ${path} should contain only strings`]
}

function validateObjectValue(value: unknown, expected: ConfigRecord, label: string, path: string): string[] {
  if (!isRecord(value)) return [`${label}: ${path} should be an object`]
  if (Object.keys(expected).length === 0) return validateRecordValue(value, label, path)
  return validateConfigShape(value, label, expected, path)
}

function validateRecordValue(value: ConfigRecord, label: string, path: string) {
  return Object.entries(value).flatMap(([recordKey, recordValue]) =>
    typeof recordValue === "string" || typeof recordValue === "number"
      ? []
      : [`${label}: ${path}.${recordKey} should be a string/number limit`],
  )
}

function validateScalarValue(value: unknown, expected: unknown, label: string, path: string): string[] {
  if (typeof expected === "boolean" && typeof value !== "boolean") return [`${label}: ${path} should be boolean`]
  if (typeof expected === "number" && typeof value !== "number") return [`${label}: ${path} should be number`]
  if (typeof expected === "string") return validateStringLikeValue(value, label, path)
  return []
}

function validateStringLikeValue(value: unknown, label: string, path: string) {
  const warnings: string[] = []
  if (typeof value !== "string" && typeof value !== "number")
    warnings.push(`${label}: ${path} should be string/number limit or enum value`)
  if (path.endsWith("permission") && !["allow", "ask", "deny"].includes(String(value)))
    warnings.push(`${label}: ${path} must be allow, ask, or deny`)
  if (path.endsWith("mode") && !["range", "message"].includes(String(value)))
    warnings.push(`${label}: ${path} must be range or message`)
  return warnings
}

function mergeConfig(a: Config, b: unknown): Config {
  const arrayMergePaths = new Set([
    "protectedFilePatterns",
    "compress.protectedTools",
    "strategies.deduplication.protectedTools",
    "strategies.purgeErrors.protectedTools",
  ])
  return deepMergeWithArrays(a, b, "", arrayMergePaths) as Config
}

function deepMergeWithArrays(a: unknown, b: unknown, path: string, arrayMergePaths: Set<string>): MutableRecord {
  const out: MutableRecord = isRecord(a) ? { ...a } : {}
  if (!isRecord(b)) return out
  for (const [key, value] of Object.entries(b)) {
    const childPath = path ? `${path}.${key}` : key
    if (Array.isArray(value) && arrayMergePaths.has(childPath)) {
      const existing = Array.isArray(out[key]) ? out[key] : []
      out[key] = [...new Set([...existing, ...value])]
    } else if (isRecord(value)) {
      out[key] = deepMergeWithArrays(out[key], value, childPath, arrayMergePaths)
    } else {
      out[key] = value
    }
  }
  return out
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
