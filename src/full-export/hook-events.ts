import type { FullExportEventInput } from "./recorder.js"
import type { FullExportKind } from "./types.js"

const lifecycleHooks: Array<{ hook: string; kind: FullExportKind }> = [
  { hook: "input", kind: "input" },
  { hook: "before_provider_request", kind: "provider_request" },
  { hook: "after_provider_response", kind: "provider_response" },
  { hook: "turn_start", kind: "turn_start" },
  { hook: "turn_end", kind: "turn_end" },
  { hook: "message_start", kind: "message_start" },
  { hook: "message_end", kind: "message_end" },
  { hook: "tool_execution_start", kind: "tool_execution_start" },
  { hook: "tool_execution_update", kind: "tool_execution_update" },
  { hook: "tool_execution_end", kind: "tool_execution_end" },
  { hook: "tool_call", kind: "tool_call" },
  { hook: "tool_result", kind: "tool_result" },
  { hook: "session_shutdown", kind: "session_shutdown" },
]

export function registerFullExportHookEvents(
  pi: { on(name: never, handler: (event: unknown) => void): void },
  record: (input: FullExportEventInput) => void,
) {
  for (const { hook, kind } of lifecycleHooks) {
    pi.on(hook as never, (event: unknown) => recordHookEvent(record, kind, event))
  }
}

function recordHookEvent(record: (input: FullExportEventInput) => void, kind: FullExportKind, event: unknown) {
  record({
    kind,
    payload: payloadFor(kind, event),
    ...providerMetadata(event),
    ...toolMetadata(event),
    ...turnMetadata(event),
  })
}

function payloadFor(kind: FullExportKind, event: unknown) {
  if (kind === "provider_request") return asRecord(event).payload ?? event
  return event
}

function providerMetadata(event: unknown) {
  return { provider: stringField(event, "provider"), model: stringField(event, "model") }
}

function toolMetadata(event: unknown) {
  return { toolCallId: stringField(event, "toolCallId", "id"), toolName: stringField(event, "toolName", "name") }
}

function turnMetadata(event: unknown) {
  return { turnIndex: numberField(event, "turnIndex") }
}

function stringField(value: unknown, ...keys: string[]) {
  const record = asRecord(value)
  for (const key of keys) {
    const field = record[key]
    if (field !== undefined && field !== null) return String(field)
  }
  return undefined
}

function numberField(value: unknown, key: string) {
  const field = asRecord(value)[key]
  return typeof field === "number" && Number.isFinite(field) ? field : undefined
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}
