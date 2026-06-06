export function stableJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? String(v)
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`
  const record = v as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableJson(record[k])}`)
    .join(",")}}`
}
