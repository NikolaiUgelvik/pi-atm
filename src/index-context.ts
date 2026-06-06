import { debugLog, debugSnapshot } from "./debug.js"
import type { FullExportEventInput } from "./full-export/recorder.js"
import { recordFullExportContext } from "./full-export/runtime.js"
import { applyPendingManualTrigger, asRuntimeContext, detectCompaction, toAtmMessages } from "./index-helpers.js"
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
  const nudge = deps.nudgeRuntime.maybeInjectNudge(
    pruned.messages,
    pruned.report,
    asRuntimeContext(ctx),
    trigger.messages,
  )
  const messages = nudge?.changed ? nudge.messages : pruned.messages
  const changed = pruned.changed || !!nudge?.changed
  debugContext(messages, pruned.report, !!nudge?.changed, deps)
  updateContextStats(pruned.report, deps.getState())
  if (changed || trigger.changed || compacted) deps.save()
  return { messages, report: pruned.report, trigger, compacted, nudge }
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
