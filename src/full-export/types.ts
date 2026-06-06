export const fullExportKinds = [
  "session_start",
  "input",
  "before_agent_start",
  "context",
  "provider_request",
  "provider_response",
  "turn_start",
  "turn_end",
  "message_start",
  "message_update",
  "message_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
  "tool_call",
  "tool_result",
  "session_shutdown",
  "atm_state",
] as const

export type FullExportKind = (typeof fullExportKinds)[number]

export type FullExportEvent = {
  version: 1
  id: string
  timestamp: string
  sessionKey: string
  cwd?: string
  kind: FullExportKind
  turnIndex?: number
  toolCallId?: string
  toolName?: string
  provider?: string
  model?: string
  payload: unknown
}

export const fullExportCategoryKinds = {
  message: ["input", "before_agent_start", "message_start", "message_update", "message_end", "turn_end"],
  tool: ["tool_execution_start", "tool_execution_update", "tool_execution_end", "tool_call", "tool_result"],
  provider: ["provider_request", "provider_response"],
  context: ["context"],
  session: ["session_start", "session_shutdown"],
  atm: ["atm_state"],
} as const satisfies Record<string, readonly FullExportKind[]>

export type FullExportCategory = keyof typeof fullExportCategoryKinds

export type ParsedFullExportFilter = {
  includeAll: boolean
  kinds: Set<FullExportKind>
  unknown: string[]
}

export type FullExportFallbackData = {
  entries: unknown[]
  contextMessages: unknown[]
  state: unknown
}

export type FullExportRenderInput = {
  events: FullExportEvent[]
  warnings: string[]
  filterLabel?: string
  generatedAt: string
  sessionKey: string
  cwd: string
  fallback?: FullExportFallbackData
}
