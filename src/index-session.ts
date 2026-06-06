import { getConfigWarnings, loadConfig, loadState } from "./config.js"
import type { FullExportEventInput } from "./full-export/recorder.js"
import { recordFullExportSessionStart } from "./full-export/runtime.js"
import { asRuntimeContext } from "./index-helpers.js"
import { loadPersistentState, sessionKeyFromContext } from "./persistence.js"
import { ensurePromptDefaults } from "./prompts.js"
import type { Config, RuntimeContext, State } from "./types.js"
import { EXT } from "./types.js"

export type SessionStartDeps = {
  setConfig: (config: Config) => void
  setState: (state: State) => void
  setSessionKey: (sessionKey: string) => void
  setCwd: (cwd: string) => void
  activeCompressionCount: () => number
  fullExport: {
    refresh: () => boolean
    record: (event: FullExportEventInput) => void
  }
}

export function createSessionStartHandler(deps: SessionStartDeps) {
  return async (event: unknown, ctx: RuntimeContext) => {
    const runtimeCtx = asRuntimeContext(ctx)
    const cwd = ctx.cwd ?? process.cwd()
    const config = loadConfig(cwd)
    ensurePromptDefaults(config)
    const sessionKey = sessionKeyFromContext(runtimeCtx, cwd)
    const entries = ctx.sessionManager.getEntries()
    const state = latestState(loadState(entries), loadPersistentState(sessionKey))
    state.sessionKey = sessionKey

    deps.setCwd(cwd)
    deps.setConfig(config)
    deps.setSessionKey(sessionKey)
    deps.setState(state)

    notifyConfigWarnings(ctx)
    if (config.enabled) ctx.ui.setStatus?.(EXT, `ATM ${deps.activeCompressionCount()} active`)
    recordSessionStart(event, runtimeCtx, cwd, sessionKey, entries.length, config, deps)
  }
}

function latestState(entryState: State, fileState: State | undefined) {
  return fileState && (fileState.lastUpdated ?? 0) >= (entryState.lastUpdated ?? 0) ? fileState : entryState
}

function notifyConfigWarnings(ctx: RuntimeContext) {
  const warnings = getConfigWarnings()
  for (const warning of warnings.slice(0, 5)) ctx.ui.notify(`ATM config warning: ${warning}`, "error")
  if (warnings.length > 5) ctx.ui.notify(`ATM config warning: ${warnings.length - 5} more warnings omitted.`, "error")
}

function recordSessionStart(
  event: unknown,
  ctx: RuntimeContext,
  cwd: string,
  sessionKey: string,
  entriesCount: number,
  config: Config,
  deps: SessionStartDeps,
) {
  if (!deps.fullExport.refresh()) return
  recordFullExportSessionStart({
    record: deps.fullExport.record,
    config,
    ctx,
    cwd,
    sessionKey,
    event,
    entriesCount,
  })
}
