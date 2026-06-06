export function resolveLimit(v: number | string, window: number) {
  if (typeof v === "number") return v
  const match = /^(\d+(?:\.\d+)?)%$/.exec(v)
  return match ? Math.floor((window * Number(match[1])) / 100) : Number(v) || 100_000
}
