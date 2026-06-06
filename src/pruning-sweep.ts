import { hasToolCallId } from "./message-guards.js"
import { messageIsTurnProtected } from "./pruning-protection.js"
import type { AtmMessage, Config, PrunedTool, State } from "./types.js"
import { estimateMessages, findToolCallIndex, isProtectedToolCall, matchesAny, toolCallFor, toolSet } from "./utils.js"

export function sweepTools(messages: AtmMessage[], n: number | undefined, config: Config, state: State) {
  const candidates = sweepCandidates(messages, n, config, existingPrunedTools(state))
  const swept = candidates.reverse().map(toPrunedTool)
  state.prunedTools ??= []
  state.prunedTools.push(...swept)
  state.stats.estimatedTokensSaved += estimatedSweepSavings(swept)
  return swept
}

function existingPrunedTools(state: State) {
  return new Set((state.prunedTools ?? []).map((tool) => tool.toolCallId))
}

function sweepCandidates(messages: AtmMessage[], limit: number | undefined, config: Config, existing: Set<string>) {
  const protectedTools = toolSet([])
  const out: Array<AtmMessage & { toolCallId: string }> = []
  const cursor = reverseUserBoundedCursor(messages, limit)
  while (cursor.next()) {
    const index = cursor.index
    const message = messages[index]
    if (message && isSweepCandidate(messages, index, message, config, existing, protectedTools)) out.push(message)
    if (limit && out.length >= limit) break
  }
  return out
}

function reverseUserBoundedCursor(messages: AtmMessage[], limit: number | undefined) {
  let index = messages.length
  let userSeen = false
  return {
    get index() {
      return index
    },
    next() {
      while (--index >= 0) {
        const message = messages[index]
        if (limit || message?.role !== "user") return true
        if (userSeen) return false
        userSeen = true
      }
      return false
    },
  }
}

function isSweepCandidate(
  messages: AtmMessage[],
  index: number,
  message: AtmMessage,
  config: Config,
  existing: Set<string>,
  protectedTools: Set<string>,
): message is AtmMessage & { toolCallId: string } {
  return (
    message.role === "toolResult" &&
    hasToolCallId(message) &&
    !existing.has(message.toolCallId) &&
    !matchesAny(message.toolName, protectedTools) &&
    !messageIsTurnProtected(messages, index, config) &&
    !isProtectedToolCall(
      toolCallFor(messages[findToolCallIndex(messages, message.toolCallId)], message.toolCallId),
      config,
    )
  )
}

function toPrunedTool(message: AtmMessage & { toolCallId: string }): PrunedTool {
  return {
    toolCallId: message.toolCallId,
    toolName: message.toolName,
    reason: "manually swept by /atm sweep",
    originalTokenEstimate: estimateMessages([message]),
  }
}

function estimatedSweepSavings(swept: PrunedTool[]) {
  return swept.reduce((sum, tool) => sum + Math.max(0, (tool.originalTokenEstimate ?? 0) - 12), 0)
}
