export function escapeHtml(value: string) {
  const replacements: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }
  return value.replace(/[&<>"']/g, (char) => replacements[char] ?? char)
}

export function escapeScriptJson(value: string) {
  return escapeHtml(value).replace(/<\//g, "<\\/")
}
