import { writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import type { RuntimeContext, State } from "../types.js"
import { filterEvents, parseFullExportFilter } from "./filters.js"
import { renderFullExportHtml } from "./html.js"
import { buildFallbackExportData, fullExportEventPath, readFullExportEvents } from "./recorder.js"

export function runFullExportCommand(args: {
  filterText: string
  ctx: RuntimeContext
  cwd: string
  sessionKey: string
  state: State
}) {
  const filter = parseFullExportFilter(args.filterText)
  const read = readFullExportEvents(fullExportEventPath(undefined, args.sessionKey))
  const warnings = [...read.warnings]
  if (filter.unknown.length) warnings.push(`Unknown filter token(s): ${filter.unknown.join(", ")}`)

  const fallback = read.events.length ? undefined : buildMissingRecordingFallback(args.ctx, args.state, warnings)
  const events = filterEvents(read.events, filter)
  const generatedAt = new Date().toISOString()
  const filename = `atm-export-${generatedAt.replace(/[:.]/g, "-")}.html`
  const outDir = args.ctx.cwd ?? args.cwd ?? process.cwd()
  const outPath = join(outDir, filename)
  const html = renderFullExportHtml({
    events,
    warnings,
    fallback,
    generatedAt,
    filterLabel: args.filterText || "all",
    sessionKey: args.sessionKey,
    cwd: outDir,
  })
  writeFileSync(outPath, html)
  args.ctx.ui.notify(
    `ATM export wrote ${shownPath(outPath, filename)} with ${events.length} event${events.length === 1 ? "" : "s"}.`,
    "info",
  )
}

function buildMissingRecordingFallback(ctx: RuntimeContext, state: State, warnings: string[]) {
  warnings.push(
    "Full export recording was not enabled or no event file exists for this session. Exact provider payloads and event history are unavailable.",
  )
  return buildFallbackExportData(ctx.sessionManager, state)
}

function shownPath(outPath: string, filename: string) {
  const path = relative(process.cwd(), outPath)
  return path.startsWith("..") ? outPath : path || filename
}
