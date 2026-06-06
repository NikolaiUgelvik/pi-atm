import type { PruneReport } from "./types.js"

export function formatReport(r: PruneReport, title = "ATM context") {
  return [
    `${title}:`,
    messageSummary(r),
    tokenSummary(r),
    `- Roles before: ${formatCounts(r.byRoleBefore)}`,
    `- Roles after: ${formatCounts(r.byRoleAfter)}`,
    ...compressionLines(r),
    ...dedupeLines(r),
    ...errorLines(r),
  ].join("\n")
}

function messageSummary(r: PruneReport) {
  return `- Messages: ${r.beforeMessages} → ${r.afterMessages} (${signed(r.afterMessages - r.beforeMessages)})`
}

function tokenSummary(r: PruneReport) {
  return `- Estimated tokens: ${r.beforeTokens} → ${r.afterTokens} (saved ${r.savedTokens}, ${percent(r.savedTokens, r.beforeTokens)})`
}

function compressionLines(r: PruneReport) {
  if (!r.compressions.length) return ["- Active compression replacements: none"]
  return ["- Active compression replacements:", ...r.compressions.map(formatCompression)]
}

function formatCompression(c: PruneReport["compressions"][number]) {
  return `  - #${c.id}${topicLabel(c.topic)}: ${c.messages} msgs [${c.startIndex}..${c.endIndex}], ${c.beforeTokens} → ${c.afterTokens}, saved ${c.savedTokens}${consumedLabel(c.consumedBlockIds)}`
}

function topicLabel(topic: string | undefined) {
  return topic ? ` ${topic}` : ""
}

function consumedLabel(consumedBlockIds: number[] | undefined) {
  return consumedBlockIds?.length ? `, consumes ${consumedBlockIds.map((id) => `b${id}`).join(", ")}` : ""
}

function dedupeLines(r: PruneReport) {
  if (!r.dedupe.length) return ["- Duplicate tool results pruned: none"]
  return [
    `- Duplicate tool results pruned: ${r.dedupe.length} (${formatSavings(groupSavings(r.dedupe))})`,
    ...r.dedupe.slice(0, 10).map(formatDedupe),
    ...moreLine(r.dedupe.length),
  ]
}

function formatDedupe(d: PruneReport["dedupe"][number]) {
  return `  - ${d.toolName}: call @${d.callIndex}, kept @${d.keptCallIndex}, saved ${d.savedTokens}`
}

function errorLines(r: PruneReport) {
  if (!r.errors.length) return ["- Stale errored tool results pruned: none"]
  return [
    `- Stale errored tool results pruned: ${r.errors.length} (${formatSavings(groupSavings(r.errors))})`,
    ...r.errors.slice(0, 10).map(formatError),
    ...moreLine(r.errors.length),
  ]
}

function formatError(e: PruneReport["errors"][number]) {
  return `  - ${e.toolName}: ${e.userTurnsAfter} user turns old, saved ${e.savedTokens}`
}

function moreLine(length: number) {
  return length > 10 ? [`  - ... ${length - 10} more`] : []
}

function formatCounts(counts: Record<string, number>) {
  return (
    Object.entries(counts)
      .map(([k, v]) => `${k}:${v}`)
      .join(", ") || "none"
  )
}

function groupSavings(items: Array<{ toolName: string; savedTokens: number }>) {
  const out: Record<string, { count: number; saved: number }> = {}
  for (const item of items) addSaving(out, item)
  return out
}

function addSaving(
  out: Record<string, { count: number; saved: number }>,
  item: { toolName: string; savedTokens: number },
) {
  out[item.toolName] ??= { count: 0, saved: 0 }
  out[item.toolName].count++
  out[item.toolName].saved += item.savedTokens
}

function formatSavings(grouped: Record<string, { count: number; saved: number }>) {
  return Object.entries(grouped)
    .map(([tool, v]) => `${tool}×${v.count}, saved ${v.saved}`)
    .join("; ")
}

function signed(n: number) {
  return n > 0 ? `+${n}` : `${n}`
}

function percent(saved: number, before: number) {
  return before > 0 ? `${Math.round((saved * 1000) / before) / 10}%` : "0%"
}
