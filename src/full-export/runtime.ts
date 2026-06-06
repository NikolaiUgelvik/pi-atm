import { debugLog } from "../debug.js"
import type { Config, RuntimeContext } from "../types.js"
import { appendFullExportEvent, type FullExportEventInput, isFullExportEnabled } from "./recorder.js"

const rawExportWarning =
  "ATM full export recording is enabled. Raw prompts, hidden messages, tool data, and provider payloads will be stored without redaction."

export function createFullExportRuntime({
  getConfig,
  getSessionKey,
  getCwd,
}: {
  getConfig: () => Config
  getSessionKey: () => string
  getCwd: () => string
}) {
  let counter = 0
  let recording = isFullExportEnabled()
  const record = (input: FullExportEventInput) => {
    if (!recording) return
    try {
      appendFullExportEvent({ sessionKey: getSessionKey(), cwd: getCwd(), counter: ++counter }, input)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      debugLog(getConfig(), "full export recording failed", { kind: input.kind, message })
    }
  }
  return {
    isRecording: () => recording,
    refresh: () => {
      recording = isFullExportEnabled()
      return recording
    },
    record,
  }
}

export function recordFullExportSessionStart(args: {
  record: (input: FullExportEventInput) => void
  config: Config
  ctx: RuntimeContext
  cwd: string
  sessionKey: string
  event: unknown
  entriesCount: number
}) {
  const sessionEvent = asRecord(args.event)
  args.ctx.ui.notify(rawExportWarning, "warning")
  debugLog(args.config, rawExportWarning, { sessionKey: args.sessionKey, cwd: args.cwd })
  args.record({
    kind: "session_start",
    payload: {
      cwd: args.cwd,
      sessionKey: args.sessionKey,
      reason: sessionEvent.reason,
      sessionFile: sessionEvent.sessionFile,
      model: args.ctx.model,
      entriesCount: args.entriesCount,
    },
    model: args.ctx.model?.id ?? args.ctx.model?.name,
  })
}

export function recordFullExportContext(args: {
  record: (input: FullExportEventInput) => void
  originalMessages: unknown[]
  transformedMessages: unknown[]
  atmEnabled: boolean
  trigger?: unknown
  compacted?: unknown
  report?: unknown
  nudge?: { changed?: boolean }
  manualMode?: boolean
}) {
  args.record({
    kind: "context",
    payload: {
      originalMessages: args.originalMessages,
      trigger: args.trigger,
      compacted: args.compacted,
      transformedMessages: args.transformedMessages,
      report: args.report,
      nudge: args.nudge ? { changed: !!args.nudge.changed } : undefined,
      atmEnabled: args.atmEnabled,
      manualMode: args.manualMode,
    },
  })
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}
