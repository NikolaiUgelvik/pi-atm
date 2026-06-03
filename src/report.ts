import type { PruneReport } from "./types.js"

export function formatReport(r: PruneReport, title = "ATM context") {
  const lines = [
    `${title}:`,
    `- Messages: ${r.beforeMessages} → ${r.afterMessages} (${signed(r.afterMessages - r.beforeMessages)})`,
    `- Estimated tokens: ${r.beforeTokens} → ${r.afterTokens} (saved ${r.savedTokens}, ${percent(r.savedTokens, r.beforeTokens)})`,
    `- Roles before: ${formatCounts(r.byRoleBefore)}`,
    `- Roles after: ${formatCounts(r.byRoleAfter)}`,
  ]
  if (r.compressions.length) {
    lines.push("- Active compression replacements:")
    for (const c of r.compressions)
      lines.push(
        `  - #${c.id}${c.topic ? ` ${c.topic}` : ""}: ${c.messages} msgs [${c.startIndex}..${c.endIndex}], ${c.beforeTokens} → ${c.afterTokens}, saved ${c.savedTokens}${c.consumedBlockIds?.length ? `, consumes ${c.consumedBlockIds.map((id) => `b${id}`).join(", ")}` : ""}`,
      )
  } else lines.push("- Active compression replacements: none")
  if (r.dedupe.length) {
    const byTool = groupSavings(r.dedupe)
    lines.push(`- Duplicate tool results pruned: ${r.dedupe.length} (${formatSavings(byTool)})`)
    for (const d of r.dedupe.slice(0, 10))
      lines.push(`  - ${d.toolName}: call @${d.callIndex}, kept @${d.keptCallIndex}, saved ${d.savedTokens}`)
    if (r.dedupe.length > 10) lines.push(`  - ... ${r.dedupe.length - 10} more`)
  } else lines.push("- Duplicate tool results pruned: none")
  if (r.errors.length) {
    const byTool = groupSavings(r.errors)
    lines.push(`- Stale errored tool results pruned: ${r.errors.length} (${formatSavings(byTool)})`)
    for (const e of r.errors.slice(0, 10))
      lines.push(`  - ${e.toolName}: ${e.userTurnsAfter} user turns old, saved ${e.savedTokens}`)
    if (r.errors.length > 10) lines.push(`  - ... ${r.errors.length - 10} more`)
  } else lines.push("- Stale errored tool results pruned: none")
  return lines.join("\n")
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
  for (const item of items) {
    out[item.toolName] ??= { count: 0, saved: 0 }
    out[item.toolName].count++
    out[item.toolName].saved += item.savedTokens
  }
  return out
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
