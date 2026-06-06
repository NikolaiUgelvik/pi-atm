import { resolveLimit } from "./context-limit.js"
import { escapeAttr } from "./html-attr.js"
import { fingerprintMessage } from "./message-fingerprint.js"
import { prompt } from "./prompts.js"
import { estimateMessages } from "./pruning.js"
import { isToolCall } from "./tool-call-parts.js"
import type { AtmMessage, Config, NudgeDraft, NudgeType, PruneReport, RuntimeContext, State } from "./types.js"
import { EXT } from "./types.js"

export type NudgeRuntimeDeps = {
  getConfig: () => Config
  getState: () => State
  getCwd: () => string
  isManual: () => boolean
}

export function createNudgeRuntime(deps: NudgeRuntimeDeps) {
  return {
    maybeInjectNudge(messages: AtmMessage[], report: PruneReport, ctx?: RuntimeContext, originalMessages = messages) {
      return maybeInjectNudge(messages, report, ctx, originalMessages, deps)
    },
  }
}

function maybeInjectNudge(
  messages: AtmMessage[],
  report: PruneReport,
  ctx: RuntimeContext | undefined,
  originalMessages: AtmMessage[],
  deps: NudgeRuntimeDeps,
) {
  if (deps.isManual()) return undefined
  const reset = maybeResetNudgesAfterCompress(messages, originalMessages, deps.getState())
  if (reset !== undefined) return reset
  const signal = nudgeSignal(messages, report, ctx, deps.getConfig())
  if (!signal.overMin) return clearLowWatermarkNudges(messages, deps.getState())
  return injectNudgeForSignal(messages, signal, deps)
}

function maybeResetNudgesAfterCompress(messages: AtmMessage[], originalMessages: AtmMessage[], state: State) {
  if (!latestAssistantHasCompress(originalMessages)) return undefined
  if (!hasRecordedNudges(state)) return undefined
  state.nudges = { context: [], turn: [], iteration: [] }
  return { messages, changed: true }
}

function hasRecordedNudges(state: State) {
  return !!(state.nudges?.context?.length || state.nudges?.turn?.length || state.nudges?.iteration?.length)
}

function clearLowWatermarkNudges(messages: AtmMessage[], state: State) {
  if (!(state.nudges?.turn?.length || state.nudges?.iteration?.length)) return undefined
  state.nudges.turn = []
  state.nudges.iteration = []
  return { messages, changed: true }
}

type NudgeSignal = {
  tokens: number
  usageTokens?: number
  estimatedTokens: number
  overMax: boolean
  overMin: boolean
  sinceLastUser: number
}

function nudgeSignal(
  messages: AtmMessage[],
  report: PruneReport,
  ctx: RuntimeContext | undefined,
  config: Config,
): NudgeSignal {
  const estimatedTokens = estimatedContextTokens(messages, report)
  const limits = modelLimits(ctx, config)
  return {
    tokens: estimatedTokens,
    usageTokens: usageTokens(ctx),
    estimatedTokens,
    overMax: estimatedTokens >= limits.max,
    overMin: estimatedTokens >= limits.min,
    sinceLastUser: messagesSinceLastUser(messages),
  }
}

function estimatedContextTokens(messages: AtmMessage[], report: PruneReport) {
  return Math.max(0, Number(report.afterTokens) || estimateMessages(messages))
}

function modelLimits(ctx: RuntimeContext | undefined, config: Config) {
  const model = ctx?.model
  const window = modelWindow(model)
  const key = modelKey(model)
  return {
    max: resolveLimit(maxConfiguredLimit(config, key), window),
    min: resolveLimit(minConfiguredLimit(config, key), window),
  }
}

function modelWindow(model: RuntimeContext["model"] | undefined) {
  return model?.contextWindow ?? 200_000
}

function modelKey(model: RuntimeContext["model"] | undefined) {
  return model?.id ?? model?.name ?? ""
}

function maxConfiguredLimit(config: Config, modelKey: string) {
  return config.compress.modelMaxLimits?.[modelKey] ?? config.compress.maxContextLimit
}

function minConfiguredLimit(config: Config, modelKey: string) {
  return config.compress.modelMinLimits?.[modelKey] ?? config.compress.minContextLimit
}

function usageTokens(ctx: RuntimeContext | undefined) {
  const rawUsageTokens = ctx?.getContextUsage?.()?.tokens
  return typeof rawUsageTokens === "number" ? rawUsageTokens : undefined
}

function injectNudgeForSignal(messages: AtmMessage[], signal: NudgeSignal, deps: NudgeRuntimeDeps) {
  const type = nudgeType(signal, deps.getConfig())
  const anchor = nudgeAnchor(messages)
  if (!shouldNudgeAt(type, anchor, messages.length, deps)) return undefined
  const reason = nudgeReason(type, signal)
  const text = buildNudgeText(type, reason, signal.overMax, deps)
  const draft = { type, anchor, text, ...signal, messageCount: messages.length, reason }
  recordNudge(draft, deps.getState())
  return { messages: [...messages, nudgeMessage(draft)], changed: true }
}

function nudgeType(signal: NudgeSignal, config: Config): NudgeType {
  if (signal.overMax) return "context"
  return signal.sinceLastUser >= config.compress.iterationNudgeThreshold ? "iteration" : "turn"
}

function nudgeReason(type: NudgeType, signal: NudgeSignal) {
  return type === "iteration"
    ? `${signal.sinceLastUser} messages since last user turn`
    : `${signal.tokens || "unknown"} tokens`
}

function messagesSinceLastUser(messages: AtmMessage[]) {
  let count = 0
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === "user") break
    count++
  }
  return count
}

function latestAssistantHasCompress(messages: AtmMessage[]) {
  const latest = [...messages].reverse().find((message) => message.role === "assistant")
  const content = Array.isArray(latest?.content) ? latest.content : []
  return content.some(isCompressToolCall)
}

function isCompressToolCall(part: unknown) {
  const candidate = part as Parameters<typeof isToolCall>[0]
  return isToolCall(candidate) && (candidate.name === "compress" || candidate.name === "compress_context")
}

function nudgeAnchor(messages: AtmMessage[]) {
  return fingerprintMessage(messages[messages.length - 1] ?? { role: "custom", content: "empty" })
}

function shouldNudgeAt(type: NudgeType, anchor: string, length: number, deps: NudgeRuntimeDeps) {
  const state = deps.getState()
  state.nudges ??= { context: [], turn: [], iteration: [] }
  const anchors = state.nudges[type] ?? []
  if (anchors.includes(anchor)) return false
  const frequencyHit = length % Math.max(1, deps.getConfig().compress.nudgeFrequency) === 0
  return anchors.length === 0 || frequencyHit || type === "context"
}

function buildNudgeText(type: NudgeType, reason: string, overMax: boolean, deps: NudgeRuntimeDeps) {
  const config = deps.getConfig()
  const template = prompt(config, deps.getCwd(), nudgeTemplate(type))
  const force = overMax || config.compress.nudgeForce === "strong" ? "strongly" : "when useful"
  return `${template}\nCurrent context signal: ${reason}. ${force} consider compressing stale work. Refer to message aliases like m0001/m0002 or block aliases like b1 when provided.`
}

function nudgeTemplate(type: NudgeType) {
  if (type === "context") return "context-limit-nudge.md"
  return type === "iteration" ? "iteration-nudge.md" : "turn-nudge.md"
}

function nudgeMessage(audit: NudgeDraft): AtmMessage {
  return {
    role: "custom",
    customType: EXT,
    display: false,
    timestamp: Date.now(),
    details: {
      nudge: true,
      notification: false,
      type: audit.type,
      anchor: audit.anchor,
      tokens: audit.tokens,
      usageTokens: audit.usageTokens,
      estimatedTokens: audit.estimatedTokens,
      messageCount: audit.messageCount,
      reason: audit.reason,
    },
    content: `<active-token-management-nudge type="${audit.type}" tokens="${audit.tokens}" anchor="${escapeAttr(audit.anchor)}">\n${audit.text}\n</active-token-management-nudge>`,
  }
}

function recordNudge(audit: NudgeDraft, state: State) {
  state.nudges ??= { context: [], turn: [], iteration: [] }
  state.nudges[audit.type] = [...(state.nudges[audit.type] ?? []), audit.anchor].slice(-50)
  state.nudgeAudit = [...(state.nudgeAudit ?? []), { ...audit, createdAt: Date.now() }].slice(-100)
}
