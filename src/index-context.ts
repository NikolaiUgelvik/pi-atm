import { detectCompaction } from "./compaction-detection.js"
import { asRuntimeContext, toAtmMessages } from "./context-conversion.js"
import { debugLog, debugSnapshot } from "./debug.js"
import type { FullExportEventInput } from "./full-export/recorder.js"
import { recordFullExportContext } from "./full-export/runtime.js"
import { applyPendingManualTrigger } from "./manual-trigger.js"
import { pruneForContext } from "./pruning.js"
import type { Config, RuntimeContext, State } from "./types.js"

export type ContextHandlerDeps = {
  getConfig: () => Config
  getState: () => State
  isManual: () => boolean
  save: () => void
  resetForCompaction: (id: string) => void
  fullExportRecord: (event: FullExportEventInput) => void
  nudgeRuntime: {
    maybeInjectNudge: ReturnType<typeof import("./index-nudges.js").createNudgeRuntime>["maybeInjectNudge"]
  }
}

type ContextEvent = {
  messages: unknown[]
}

export function createContextHandler(deps: ContextHandlerDeps) {
  return async (event: ContextEvent, ctx: RuntimeContext) => handleContext(event, ctx, deps)
}

function handleContext(event: ContextEvent, ctx: RuntimeContext, deps: ContextHandlerDeps) {
  const contextMessages = toAtmMessages(event.messages)
  if (!deps.getConfig().enabled) return recordDisabledContext(contextMessages, deps)
  const result = transformedContext(contextMessages, ctx, deps)
  recordEnabledContext(contextMessages, result, deps)
  return { messages: result.messages as unknown as typeof event.messages }
}

function recordDisabledContext(contextMessages: ReturnType<typeof toAtmMessages>, deps: ContextHandlerDeps) {
  recordFullExportContext({
    record: deps.fullExportRecord,
    originalMessages: contextMessages,
    transformedMessages: contextMessages,
    atmEnabled: false,
  })
}

function transformedContext(
  contextMessages: ReturnType<typeof toAtmMessages>,
  ctx: RuntimeContext,
  deps: ContextHandlerDeps,
) {
  const compacted = maybeResetCompaction(contextMessages, deps)
  const trigger = applyPendingTrigger(contextMessages, deps.getState())
  const pruned = prunedContext(trigger.messages, deps)
  const nudge = contextNudge(pruned, trigger.messages, ctx, deps)
  const messages = transformedMessages(pruned.messages, nudge)
  debugContext(messages, pruned.report, !!nudge?.changed, deps)
  updateContextStats(pruned.report, deps.getState())
  saveTransformedContext(
    { prunedChanged: pruned.changed, triggerChanged: trigger.changed, compacted, nudgeChanged: !!nudge?.changed },
    deps,
  )
  return { messages, report: pruned.report, trigger, compacted, nudge }
}

function contextNudge(
  pruned: ReturnType<typeof prunedContext>,
  originalMessages: ReturnType<typeof toAtmMessages>,
  ctx: RuntimeContext,
  deps: ContextHandlerDeps,
) {
  return deps.nudgeRuntime.maybeInjectNudge(pruned.messages, pruned.report, asRuntimeContext(ctx), originalMessages)
}

function transformedMessages(
  messages: ReturnType<typeof toAtmMessages>,
  nudge: ReturnType<ContextHandlerDeps["nudgeRuntime"]["maybeInjectNudge"]>,
) {
  return nudge?.changed ? nudge.messages : messages
}

function saveTransformedContext(
  flags: { prunedChanged: boolean; triggerChanged: boolean; compacted?: string; nudgeChanged: boolean },
  deps: ContextHandlerDeps,
) {
  if (flags.prunedChanged || flags.triggerChanged || flags.compacted || flags.nudgeChanged) deps.save()
}

function maybeResetCompaction(contextMessages: ReturnType<typeof toAtmMessages>, deps: ContextHandlerDeps) {
  const compacted = detectCompaction(contextMessages)
  if (compacted && compacted !== deps.getState().lastCompaction) deps.resetForCompaction(compacted)
  return compacted
}

function applyPendingTrigger(contextMessages: ReturnType<typeof toAtmMessages>, state: State) {
  const trigger = applyPendingManualTrigger(contextMessages, state.manualPendingPrompt)
  if (trigger.consumed) state.manualPendingPrompt = undefined
  return trigger
}

function prunedContext(messages: ReturnType<typeof toAtmMessages>, deps: ContextHandlerDeps) {
  return pruneForContext(
    messages,
    deps.getState(),
    deps.getConfig(),
    !deps.isManual() || deps.getConfig().manualMode.automaticStrategies,
  )
}

function debugContext(
  messages: ReturnType<typeof toAtmMessages>,
  report: ReturnType<typeof pruneForContext>["report"],
  nudgeInjected: boolean,
  deps: ContextHandlerDeps,
) {
  debugSnapshot(deps.getConfig(), "context", { messages, report, state: deps.getState() })
  debugLog(deps.getConfig(), "context transformed", {
    beforeTokens: report.beforeTokens,
    afterTokens: report.afterTokens,
    savedTokens: report.savedTokens,
    nudgeInjected,
  })
}

function updateContextStats(report: ReturnType<typeof pruneForContext>["report"], state: State) {
  state.stats.contextRuns = (state.stats.contextRuns ?? 0) + 1
  state.stats.lastContext = report
  if (report.savedTokens > 0) state.stats.estimatedTokensSaved += report.savedTokens
}

function recordEnabledContext(
  contextMessages: ReturnType<typeof toAtmMessages>,
  result: ReturnType<typeof transformedContext>,
  deps: ContextHandlerDeps,
) {
  recordFullExportContext({
    record: deps.fullExportRecord,
    originalMessages: contextMessages,
    trigger: result.trigger,
    compacted: result.compacted,
    transformedMessages: result.messages,
    report: result.report,
    nudge: result.nudge,
    atmEnabled: true,
    manualMode: deps.isManual(),
  })
}
