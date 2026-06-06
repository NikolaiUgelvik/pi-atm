import { compressionToolParameters } from "./compress-tool-schema.js"
import { appendConsumedSummaries, appendProtectedContent, consumedBlockIdsForMessages } from "./compression-content.js"
import { debugLog } from "./debug.js"
import { asRuntimeContext, toAtmMessages } from "./index-helpers.js"
import { isDefined } from "./message-guards.js"
import {
  estimateMessages,
  estimateText,
  fingerprintMessage,
  normalizeCompressionRequests,
  pruneForContext,
  stripAliasesFromMessages,
} from "./pruning.js"
import type { Compression, CompressionToolParams, Config, RuntimeContext, State } from "./types.js"
import { EXT } from "./types.js"
import { clone, textResult } from "./utils.js"

export type CompressReports = {
  notifyCompression(ctx: RuntimeContext, created: Compression[]): void
}

export type CompressToolDeps = {
  getConfig: () => Config
  getState: () => State
  isManual: () => boolean
  save: () => void
  activeCompressions: () => Compression[]
  reports: CompressReports
}

export function createCompressTool(deps: CompressToolDeps) {
  return {
    name: "compress",
    label: "Compress Context",
    description:
      "Replace stale conversation context with a durable technical summary without modifying session history.",
    promptSnippet: "Compress stale/completed context into a high-fidelity summary to reduce token usage.",
    promptGuidelines: [
      "Use compress when context is large or completed work no longer needs verbatim transcripts.",
      "When using compress, provide detailed technical summaries that preserve decisions, file paths, commands, errors, and next steps.",
      "Do not compress the most recent active debugging/tool-output context unless it is clearly stale.",
    ],
    parameters: compressionToolParameters,
    async execute(
      _toolCallId: string,
      params: CompressionToolParams,
      _signal: unknown,
      _onUpdate: unknown,
      ctx: RuntimeContext,
    ) {
      return executeCompressTool(params, ctx, deps)
    },
  }
}

async function executeCompressTool(params: CompressionToolParams, ctx: RuntimeContext, deps: CompressToolDeps) {
  const config = deps.getConfig()
  const state = deps.getState()
  const guard = await compressionGuard(params, ctx, config, state, deps)
  if (guard) return guard

  const startedAt = Date.now()
  const runtimeCtx = asRuntimeContext(ctx)
  const rawContext = toAtmMessages(runtimeCtx.sessionManager.buildSessionContext().messages ?? [])
  const rawComparable = stripAliasesFromMessages(rawContext)
  const visibleContext = visibleCompressionContext(rawContext, state, config, deps)
  const requests = normalizeCompressionRequests(visibleContext, params, config)
  if (requests.length === 0) return textResult("No eligible messages selected for compression.", true)

  const created = createCompressions(requests, rawComparable, params, state, config, startedAt)
  debugCompressionCreated(config, created)
  finalizeCompressionState(state)
  deps.save()
  ctx.ui.setStatus?.(EXT, `ATM ${deps.activeCompressions().length} active`)
  deps.reports.notifyCompression(runtimeCtx, created)
  return textResult(compressionResultText(created))
}

async function compressionGuard(
  params: CompressionToolParams,
  ctx: RuntimeContext,
  config: Config,
  state: State,
  deps: CompressToolDeps,
) {
  return (
    disabledGuard(config) ??
    permissionGuard(config) ??
    manualModeGuard(state, deps) ??
    (await confirmationGuard(params, ctx, config))
  )
}

function disabledGuard(config: Config) {
  return config.enabled ? undefined : textResult("ATM is disabled.", true)
}

function permissionGuard(config: Config) {
  return config.compress.permission === "deny" ? textResult("compress is denied by configuration.", true) : undefined
}

function manualModeGuard(state: State, deps: CompressToolDeps) {
  return deps.isManual() && !state.manualCompressionPending
    ? textResult("ATM manual mode is active. Do not retry compress until the user runs /atm compress.", true)
    : undefined
}

async function confirmationGuard(params: CompressionToolParams, ctx: RuntimeContext, config: Config) {
  if (config.compress.permission !== "ask" || !ctx.hasUI) return undefined
  const ok = await ctx.ui.confirm?.("Compress context?", params.topic ?? "Allow dynamic context compression?")
  return ok ? undefined : textResult("Compression cancelled by user.", true)
}

function visibleCompressionContext(
  rawContext: ReturnType<typeof toAtmMessages>,
  state: State,
  config: Config,
  deps: CompressToolDeps,
) {
  const pruned = pruneForContext(
    rawContext,
    clone(state),
    config,
    !deps.isManual() || config.manualMode.automaticStrategies,
  )
  return stripAliasesFromMessages(pruned.messages)
}

function createCompressions(
  requests: ReturnType<typeof normalizeCompressionRequests>,
  rawComparable: ReturnType<typeof toAtmMessages>,
  params: CompressionToolParams,
  state: State,
  config: Config,
  startedAt: number,
) {
  const created: Compression[] = []
  for (const request of requests)
    created.push(createCompression(request, rawComparable, params, state, config, startedAt))
  return created
}

function createCompression(
  request: ReturnType<typeof normalizeCompressionRequests>[number],
  rawComparable: ReturnType<typeof toAtmMessages>,
  params: CompressionToolParams,
  state: State,
  config: Config,
  startedAt: number,
) {
  const selected = selectedMessages(request, rawComparable)
  const finalSummary = finalCompressionSummary(request, selected, state, config)
  const compression = compressionFromRequest(request, selected, finalSummary, params, state.nextId++, startedAt)
  deactivateConsumedCompressions(state, compression)
  state.compressions.push(compression)
  state.stats.compressionsCreated++
  state.stats.estimatedTokensSaved += compressionSavings(compression)
  return compression
}

function selectedMessages(
  request: ReturnType<typeof normalizeCompressionRequests>[number],
  rawComparable: ReturnType<typeof toAtmMessages>,
) {
  const rawSelected = (request.indexes ?? []).map((index) => rawComparable[index]).filter(isDefined)
  return rawSelected.length === request.selected.length ? rawSelected : request.selected
}

function finalCompressionSummary(
  request: ReturnType<typeof normalizeCompressionRequests>[number],
  selected: ReturnType<typeof toAtmMessages>,
  state: State,
  config: Config,
) {
  return appendProtectedContent(appendConsumedSummaries(request.summary, request.selected, state), selected, config)
}

function compressionFromRequest(
  request: ReturnType<typeof normalizeCompressionRequests>[number],
  selected: ReturnType<typeof toAtmMessages>,
  summary: string,
  params: CompressionToolParams,
  id: number,
  startedAt: number,
): Compression {
  return {
    id,
    mode: request.mode,
    active: true,
    createdAt: Date.now(),
    summary,
    topic: request.topic ?? params.topic,
    focus: params.focus,
    fingerprints: selected.map(fingerprintMessage),
    startFingerprint: fingerprintMessage(selected[0]),
    endFingerprint: fingerprintMessage(selected[selected.length - 1]),
    originalTokenEstimate: estimateMessages(selected),
    summaryTokenEstimate: estimateText(summary),
    durationMs: Date.now() - startedAt,
    consumedBlockIds: consumedBlockIdsForMessages(request.selected),
  }
}

function deactivateConsumedCompressions(state: State, compression: Compression) {
  for (const consumedId of compression.consumedBlockIds ?? []) {
    const consumed = state.compressions.find((item) => item.id === consumedId)
    if (consumed) {
      consumed.active = false
      consumed.consumedBy = compression.id
    }
  }
}

function compressionSavings(compression: Compression) {
  return Math.max(0, compression.originalTokenEstimate - compression.summaryTokenEstimate)
}

function debugCompressionCreated(config: Config, created: Compression[]) {
  debugLog(config, "compression created", {
    ids: created.map((compression) => compression.id),
    topics: created.map((compression) => compression.topic),
    savedTokens: created.map(compressionSavings),
  })
}

function finalizeCompressionState(state: State) {
  if (!state.manualCompressionPending) return
  state.manualCompressionPending = false
  state.manualMode = true
}

function compressionResultText(created: Compression[]) {
  return `Compression active: ${created.map((compression) => `#${compression.id} saved ~${compressionSavings(compression)} tokens`).join("; ")}.`
}
