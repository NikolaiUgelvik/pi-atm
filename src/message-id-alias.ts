export function indexFromAlias(id?: string) {
  const match = /^m(\d{4})$/.exec(id || "")
  return match ? Number(match[1]) - 1 : -1
}

export function aliasForIndex(index: number) {
  return `m${String(index + 1).padStart(4, "0")}`
}
