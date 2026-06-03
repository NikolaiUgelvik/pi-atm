export type Notify = "off" | "minimal" | "detailed"
export type NotifyType = "toast" | "chat"
export type CompressionMode = "range" | "message"
export type Permission = "allow" | "ask" | "deny"
export type NudgeType = "context" | "turn" | "iteration"
export type NotifyLevel = "info" | "error"

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
export type MutableRecord = Record<string, unknown>

export type MessageMetadata = {
  provider?: string
  model?: string
  [key: string]: unknown
}

export type TextPart = {
  type?: "text" | string
  text?: string
  thinking?: string
  summary?: string
  provider?: string
  model?: string
  metadata?: MessageMetadata
  [key: string]: unknown
}

export type ToolCallPart = TextPart & {
  type: "toolCall"
  id?: string
  name?: string
  arguments?: unknown
  input?: unknown
}

export type MessagePart = TextPart | ToolCallPart

export type AtmMessage = {
  role?: string
  content?: string | MessagePart[]
  customType?: string
  display?: boolean
  details?: MutableRecord
  timestamp?: number
  summary?: string
  output?: string
  toolCallId?: string
  toolName?: string
  isError?: boolean
  arguments?: unknown
  input?: unknown
  provider?: string
  model?: string
  metadata?: MessageMetadata
  compacted?: boolean
  isCompaction?: boolean
  usage?: unknown
  [key: string]: unknown
}

export type StateEntry = {
  type?: string
  customType?: string
  data?: unknown
  [key: string]: unknown
}

export type CompressionContentItem = {
  startId?: string
  endId?: string
  messageId?: string
  topic?: string
  summary: string
}

export type CompressionToolParams = {
  topic?: string
  summary?: string
  content?: CompressionContentItem[]
  focus?: string
  mode?: CompressionMode
  target?: "stale" | "since_last_user" | "all_except_recent"
  keepRecentMessages?: number
  startIndex?: number
  endIndex?: number
}

export type NormalizedCompressionRequest = {
  mode: CompressionMode
  selected: AtmMessage[]
  indexes: number[]
  summary: string
  topic?: string
}

export type RuntimeUsage = { tokens?: number | null; contextWindow?: number; percent?: number | null }
export type RuntimeModel = { id?: string; name?: string; contextWindow?: number }
export type RuntimeUi = {
  notify(message: string, level: NotifyLevel): void
  setStatus?(key: string, value: string): void
  confirm?(title: string, message?: string): Promise<boolean>
}
export type RuntimeSessionManager = {
  getEntries(): StateEntry[]
  buildSessionContext(): { messages?: AtmMessage[] }
  sessionId?: string
  session?: { id?: string }
  id?: string
}
export type RuntimeContext = {
  cwd?: string
  hasUI?: boolean
  ui: RuntimeUi
  session?: { id?: string }
  sessionId?: string
  sessionManager: RuntimeSessionManager
  getContextUsage?: () => RuntimeUsage | undefined
  model?: RuntimeModel
}

export type NudgeDraft = Omit<NudgeAudit, "createdAt">

export type RuntimeReportsDeps = {
  getConfig: () => Config
  getState: () => State
  isManual: () => boolean
  activeCompressions: () => Compression[]
  notify: (ctx: RuntimeContext, msg: string, level: NotifyLevel) => void
}

export type ConfigRecord = Record<string, unknown>

export type Config = {
  enabled: boolean
  debug: boolean
  pruneNotification: Notify
  pruneNotificationType: NotifyType
  manualMode: { enabled: boolean; automaticStrategies: boolean }
  turnProtection: { enabled: boolean; turns: number }
  protectedFilePatterns: string[]
  compress: {
    mode: CompressionMode
    permission: Permission
    showCompression: boolean
    minContextLimit: number | string
    maxContextLimit: number | string
    modelMinLimits: Record<string, number | string>
    modelMaxLimits: Record<string, number | string>
    nudgeFrequency: number
    iterationNudgeThreshold: number
    nudgeForce: "soft" | "strong"
    protectedTools: string[]
    protectTags: boolean
    protectUserMessages: boolean
    keepRecentMessages: number
  }
  strategies: {
    deduplication: { enabled: boolean; protectedTools: string[] }
    purgeErrors: { enabled: boolean; turns: number; protectedTools: string[] }
  }
  experimental: { customPrompts: boolean }
}

export type Compression = {
  id: number
  mode: CompressionMode
  active: boolean
  createdAt: number
  summary: string
  topic?: string
  focus?: string
  fingerprints: string[]
  startFingerprint?: string
  endFingerprint?: string
  originalTokenEstimate: number
  summaryTokenEstimate: number
  durationMs?: number
  consumedBlockIds?: number[]
  consumedBy?: number
  userDecompressed?: boolean
}

export type PrunedTool = {
  toolCallId: string
  toolName?: string
  reason: string
  originalTokenEstimate?: number
}

export type NudgeAudit = {
  type: NudgeType
  anchor: string
  text: string
  tokens: number
  usageTokens?: number
  estimatedTokens?: number
  messageCount: number
  createdAt: number
  reason?: string
}

export type State = {
  version: 1
  nextId: number
  manualMode?: boolean
  manualCompressionPending?: boolean
  manualPendingPrompt?: string
  sessionKey?: string
  lastUpdated?: number
  lastCompaction?: string
  nudges?: { context: string[]; turn: string[]; iteration: string[] }
  nudgeAudit?: NudgeAudit[]
  compressions: Compression[]
  prunedTools?: PrunedTool[]
  stats: {
    compressionsCreated: number
    contextRuns: number
    dedupePrunes: number
    errorPrunes: number
    estimatedTokensSaved: number
    lastContext?: PruneReport
  }
}

export type PruneReport = {
  timestamp: number
  beforeMessages: number
  afterMessages: number
  beforeTokens: number
  afterTokens: number
  savedTokens: number
  byRoleBefore: Record<string, number>
  byRoleAfter: Record<string, number>
  compressions: Array<{
    id: number
    topic?: string
    mode: CompressionMode
    messages: number
    beforeTokens: number
    afterTokens: number
    savedTokens: number
    startIndex?: number
    endIndex?: number
    consumedBlockIds?: number[]
  }>
  dedupe: Array<{
    toolName: string
    callIndex: number
    keptCallIndex: number
    beforeTokens: number
    afterTokens: number
    savedTokens: number
  }>
  errors: Array<{
    toolName: string
    userTurnsAfter: number
    beforeTokens: number
    afterTokens: number
    savedTokens: number
    excerpt: string
  }>
}

export const EXT = "active-token-management"
export const STATE_TYPE = "active-token-management-state"

export const defaultConfig: Config = {
  enabled: true,
  debug: false,
  pruneNotification: "detailed",
  pruneNotificationType: "toast",
  manualMode: { enabled: false, automaticStrategies: true },
  turnProtection: { enabled: false, turns: 4 },
  protectedFilePatterns: [],
  compress: {
    mode: "range",
    permission: "allow",
    showCompression: false,
    minContextLimit: 50_000,
    maxContextLimit: 100_000,
    modelMinLimits: {},
    modelMaxLimits: {},
    nudgeFrequency: 5,
    iterationNudgeThreshold: 15,
    nudgeForce: "soft",
    protectedTools: ["task", "skill", "todowrite", "todoread"],
    protectTags: false,
    protectUserMessages: false,
    keepRecentMessages: 20,
  },
  strategies: {
    deduplication: { enabled: true, protectedTools: [] },
    purgeErrors: { enabled: true, turns: 4, protectedTools: [] },
  },
  experimental: { customPrompts: false },
}

export const alwaysProtectedTools = new Set([
  "task",
  "skill",
  "todowrite",
  "todoread",
  "compress",
  "compress_context",
  "batch",
  "plan_enter",
  "plan_exit",
  "write",
  "edit",
])

export const emptyState = (): State => ({
  version: 1,
  nextId: 1,
  compressions: [],
  prunedTools: [],
  nudges: { context: [], turn: [], iteration: [] },
  nudgeAudit: [],
  stats: { compressionsCreated: 0, contextRuns: 0, dedupePrunes: 0, errorPrunes: 0, estimatedTokensSaved: 0 },
})
