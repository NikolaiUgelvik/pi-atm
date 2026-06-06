export function escapeAttr(s: string) {
  const replacements: Record<string, string> = { '"': "&quot;", "&": "&amp;", "<": "&lt;", ">": "&gt;" }
  return s.replace(/["&<>]/g, (c) => replacements[c] ?? c)
}
