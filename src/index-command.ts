import { loadState } from "./config.js"
import { debugLog } from "./debug.js"
import { runFullExportCommand } from "./full-export/command.js"
import { parseCompressionId, toAtmMessages } from "./index-helpers.js"
import { loadPersistentState } from "./persistence.js"
import { sweepTools } from "./pruning.js"
import type { Config, RuntimeContext, State } from "./types.js"
import { EXT } from "./types.js"

export type CommandReports = {
  contextReport(ctx: RuntimeContext, usage: unknown): string
  statsReport(): string
  listCompressions(): string
}

export type AtmCommandDeps = {
  getConfig: () => Config
  getState: () => State
  setState: (state: State) => void
  getCwd: () => string
  getSessionKey: () => string
  isManual: () => boolean
  save: () => void
  activeCompressions: () => Array<{ active: boolean }>
  reports: CommandReports
  sendUserMessage: (message: string) => void
}

type CommandArgs = {
  cmd: string
  rest: string[]
  tail: string
  ctx: RuntimeContext
  state: State
  deps: AtmCommandDeps
}

type CommandHandler = (args: CommandArgs) => void

const helpText =
  "/atm [compress [focus]] | export [filter] | context | stats | sweep [n] | decompress <id> | recompress <id> | manual [on|off] | enable | disable"

export function createAtmCommandHandler(deps: AtmCommandDeps) {
  return async (args: string, ctx: RuntimeContext) => {
    const parsed = parseCommand(args)
    const state = reloadCommandState(ctx, deps)
    const handler = commandHandlers[parsed.cmd] ?? unknownCommand
    handler({ ...parsed, ctx, state, deps })
  }
}

function parseCommand(args: string) {
  const [rawCmd, ...rest] = (args || "").trim().split(/\s+/).filter(Boolean)
  const cmd = rawCmd || "compress"
  return { cmd, rest, tail: rest.join(" ") }
}

function reloadCommandState(ctx: RuntimeContext, deps: AtmCommandDeps) {
  const entryState = loadState(ctx.sessionManager.getEntries())
  const fileState = loadPersistentState(deps.getSessionKey())
  const state = fileState && (fileState.lastUpdated ?? 0) >= (entryState.lastUpdated ?? 0) ? fileState : entryState
  deps.setState(state)
  return state
}

const commandHandlers: Record<string, CommandHandler> = {
  help: helpCommand,
  export: exportCommand,
  context: contextCommand,
  stats: statsCommand,
  manual: manualCommand,
  enable: enableCommand,
  disable: disableCommand,
  sweep: sweepCommand,
  compress: compressCommand,
  decompress: compressionStateCommand,
  recompress: compressionStateCommand,
}

function helpCommand({ ctx }: CommandArgs) {
  ctx.ui.notify(helpText, "info")
}

function exportCommand({ tail, ctx, state, deps }: CommandArgs) {
  runFullExportCommand({ filterText: tail, ctx, cwd: deps.getCwd(), sessionKey: deps.getSessionKey(), state })
}

function contextCommand({ ctx, deps }: CommandArgs) {
  ctx.ui.notify(deps.reports.contextReport(ctx, ctx.getContextUsage?.()), "info")
}

function statsCommand({ ctx, deps }: CommandArgs) {
  ctx.ui.notify(deps.reports.statsReport(), "info")
}

function manualCommand({ tail, ctx, state, deps }: CommandArgs) {
  state.manualMode = manualModeValue(tail, deps)
  deps.save()
  ctx.ui.notify(`ATM manual mode ${deps.isManual() ? "on" : "off"}.`, "info")
}

function manualModeValue(tail: string, deps: AtmCommandDeps) {
  if (tail === "on") return true
  if (tail === "off") return false
  return !deps.isManual()
}

function enableCommand({ ctx, deps }: CommandArgs) {
  deps.getConfig().enabled = true
  ctx.ui.notify("ATM enabled for this runtime. Persist in .pi/atm.jsonc if desired.", "info")
}

function disableCommand({ ctx, deps }: CommandArgs) {
  deps.getConfig().enabled = false
  ctx.ui.notify("ATM disabled for this runtime. Persist in .pi/atm.jsonc if desired.", "info")
}

function sweepCommand({ rest, ctx, state, deps }: CommandArgs) {
  const raw = toAtmMessages(ctx.sessionManager.buildSessionContext().messages ?? [])
  const swept = sweepTools(raw, positiveNumber(rest[0]), deps.getConfig(), state)
  debugLog(deps.getConfig(), "manual sweep", { swept })
  deps.save()
  ctx.ui.notify(sweepMessage(swept), "info")
}

function positiveNumber(value: string | undefined) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : undefined
}

function sweepMessage(swept: Array<{ toolName?: string; toolCallId: string }>) {
  return swept.length
    ? `ATM swept ${swept.length} tool result${swept.length === 1 ? "" : "s"}: ${swept.map((item) => item.toolName ?? item.toolCallId).join(", ")}`
    : "No eligible tool results to sweep."
}

function compressCommand({ tail, state, deps }: CommandArgs) {
  state.manualMode = true
  state.manualCompressionPending = true
  state.manualPendingPrompt = manualPrompt(tail)
  deps.save()
  deps.sendUserMessage(state.manualPendingPrompt)
}

function manualPrompt(tail: string) {
  return `Use the compress tool now. Compress stale or completed context, keep recent active work verbatim, and preserve all technical details.${tail ? ` Focus: ${tail}` : ""}`
}

function compressionStateCommand(args: CommandArgs) {
  const id = parseCompressionId(args.rest[0])
  if (!id) return args.ctx.ui.notify(args.deps.reports.listCompressions(), "info")
  const compression = args.state.compressions.find((item) => item.id === id)
  if (!compression) return args.ctx.ui.notify(`No compression #${id}.`, "error")
  updateCompressionState(args.cmd, compression, args.state)
  args.deps.save()
  args.ctx.ui.setStatus?.(EXT, `ATM ${args.deps.activeCompressions().length} active`)
  args.ctx.ui.notify(`Compression b${id} ${compression.active ? "recompressed" : "decompressed"}.`, "info")
}

function updateCompressionState(cmd: string, compression: State["compressions"][number], state: State) {
  if (cmd === "decompress") deactivateCompression(compression, state)
  else reactivateCompression(compression, state)
}

function deactivateCompression(compression: State["compressions"][number], state: State) {
  compression.active = false
  compression.userDecompressed = true
  for (const child of consumedChildren(compression, state, false)) child.active = true
}

function reactivateCompression(compression: State["compressions"][number], state: State) {
  compression.active = true
  compression.userDecompressed = false
  for (const child of consumedChildren(compression, state, true)) child.active = false
}

function consumedChildren(compression: State["compressions"][number], state: State, includeUserDecompressed: boolean) {
  return (compression.consumedBlockIds ?? [])
    .map((childId) => state.compressions.find((item) => item.id === childId && item.consumedBy === compression.id))
    .filter(
      (child): child is State["compressions"][number] =>
        !!child && (includeUserDecompressed || !child.userDecompressed),
    )
}

function unknownCommand({ cmd, ctx }: CommandArgs) {
  ctx.ui.notify(`Unknown /atm command: ${cmd}`, "error")
}
