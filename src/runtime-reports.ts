import { clone } from "./clone.js"
import { allTimeStats } from "./persistence.js"
import { pruneForContext } from "./pruning.js"
import { formatReport } from "./report.js"
import type { Compression, RuntimeContext, RuntimeReportsDeps, RuntimeUsage } from "./types.js"

export function createRuntimeReports(deps: RuntimeReportsDeps) {
  const getConfig = deps.getConfig
  const getState = deps.getState
  const isManual = deps.isManual
  const activeCompressions = deps.activeCompressions
  const notify = deps.notify

  function notifyCompression(ctx: RuntimeContext, created: Compression[]) {
    const config = getConfig()
    if (config.pruneNotification === "off") return
    const removed = created.reduce((sum, c) => sum + Math.max(0, c.originalTokenEstimate - c.summaryTokenEstimate), 0)
    const summary = created.reduce((sum, c) => sum + c.summaryTokenEstimate, 0)
    const ratio = ratioText(
      created.reduce((sum, c) => sum + c.originalTokenEstimate, 0),
      summary,
    )
    if (config.pruneNotification === "minimal")
      return notify(
        ctx,
        `ATM compressed ${created.length} block${created.length === 1 ? "" : "s"}, saved ~${removed} tokens.`,
        "info",
      )
    const bar = progressBar(summary, summary + removed)
    const details = created
      .map(
        (c) =>
          `- b${c.id}${c.topic ? ` ${c.topic}` : ""}: ${c.fingerprints.length} msgs, ${c.originalTokenEstimate} → ${c.summaryTokenEstimate}, saved ~${Math.max(0, c.originalTokenEstimate - c.summaryTokenEstimate)}, ${c.durationMs ?? 0}ms${config.compress.showCompression ? `\n${c.summary}` : ""}`,
      )
      .join("\n")
    notify(
      ctx,
      `ATM compression complete\n${bar} summary/original ratio ${ratio}\nRemoved ~${removed} tokens; active summary ~${summary} tokens.\n${details}`,
      "info",
    )
  }

  function statsReport() {
    const state = getState()
    const last = state.stats.lastContext
      ? formatReport(state.stats.lastContext, "Last provider context")
      : "No provider context has been pruned yet."
    const original = state.compressions.reduce((sum, c) => sum + (c.originalTokenEstimate ?? 0), 0)
    const summaries = state.compressions.reduce((sum, c) => sum + (c.summaryTokenEstimate ?? 0), 0)
    const time = state.compressions.reduce((sum, c) => sum + (c.durationMs ?? 0), 0)
    const all = allTimeStats()
    return `ATM stats\nSession:\n- Context runs: ${state.stats.contextRuns ?? 0}\n- Compressions: ${state.compressions.length} (${activeCompressions().length} active)\n- Compression ratio: ${ratioText(original, summaries)} (${original} → ${summaries})\n- Compression time: ${time}ms\n- Manually swept tool results: ${state.prunedTools?.length ?? 0}\n- Duplicate tool results pruned: ${state.stats.dedupePrunes}\n- Stale errored tool results pruned: ${state.stats.errorPrunes}\n- Cumulative estimated tokens saved: ${state.stats.estimatedTokensSaved}\n\nRecent nudges:\n${recentNudgesReport()}\n\nAll-time:\n- Sessions: ${all.sessions}\n- Compressions: ${all.compressions} (${all.activeCompressions} active)\n- Compression ratio: ${ratioText(all.originalTokens, all.summaryTokens)} (${all.originalTokens} → ${all.summaryTokens})\n- Compression time: ${all.compressionMs}ms\n- Pruned tools: ${all.prunedTools}\n- Estimated tokens saved: ${all.estimatedTokensSaved}\n\n${last}`
  }

  function recentNudgesReport() {
    const rows = (getState().nudgeAudit ?? []).slice(-5).map((n) => {
      const when = n.createdAt ? new Date(n.createdAt).toISOString() : "unknown-time"
      const firstLine =
        String(n.text ?? "")
          .split("\n")
          .find(Boolean) ?? ""
      const excerpt = firstLine.length > 140 ? `${firstLine.slice(0, 137)}...` : firstLine
      return `- ${when} ${n.type} ${n.tokens} tokens anchor=${n.anchor} messages=${n.messageCount}: ${excerpt}`
    })
    return rows.join("\n") || "No ATM nudges have been injected yet."
  }

  function listCompressions() {
    const rows = getState()
      .compressions.map(
        (c) =>
          `b${c.id} ${c.active ? "active" : c.userDecompressed ? "user-decompressed" : c.consumedBy ? `consumed-by-b${c.consumedBy}` : "inactive"} ${c.topic ?? "untitled"} | ${c.mode} | ${c.fingerprints.length} msgs | ${c.originalTokenEstimate} → ${c.summaryTokenEstimate} tokens | ~${Math.max(0, c.originalTokenEstimate - c.summaryTokenEstimate)} saved${c.consumedBlockIds?.length ? ` | consumes ${c.consumedBlockIds.map((id) => `b${id}`).join(", ")}` : ""}`,
      )
      .join("\n")
    return rows || "No compressions yet."
  }

  function contextReport(ctx: RuntimeContext, usage?: RuntimeUsage) {
    const config = getConfig()
    const state = getState()
    const raw = ctx.sessionManager.buildSessionContext().messages ?? []
    const preview = pruneForContext(raw, clone(state), config, !isManual() || config.manualMode.automaticStrategies)
    const reported = usage?.tokens ? `\nPi reported current usage: ${usage.tokens} tokens` : ""
    return `${formatReport(preview.report, "Current context preview")}${reported}\n\nRecent nudges:\n${recentNudgesReport()}\n\nCompressions:\n${listCompressions()}`
  }

  return { contextReport, listCompressions, notifyCompression, recentNudgesReport, statsReport }
}

function progressBar(kept: number, total: number) {
  const width = 20
  const pct = total > 0 ? kept / total : 0
  const fill = Math.max(0, Math.min(width, Math.round(width * pct)))
  return `[${"#".repeat(fill)}${"-".repeat(width - fill)}] ${Math.round(pct * 100)}% kept`
}

function ratioText(original: number, summary: number) {
  return original > 0 ? `${Math.round((summary / original) * 1000) / 10}%` : "n/a"
}
