export function parseCompressionId(value?: string) {
  const match = /^b?(\d+)$/.exec(value || "")
  return match ? Number(match[1]) : 0
}
