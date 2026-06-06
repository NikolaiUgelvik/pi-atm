export function extractPaths(value: unknown): string[] {
  const out: string[] = []
  visitPathValue(value, "", out)
  return [...new Set(out)]
}

function visitPathValue(value: unknown, key: string, out: string[]) {
  if (typeof value === "string") collectPathsFromString(value, key, out)
  else if (Array.isArray(value)) visitPathArray(value, key, out)
  else if (isPlainObject(value)) visitPathRecord(value, out)
}

function visitPathArray(values: unknown[], key: string, out: string[]) {
  for (const value of values) visitPathValue(value, key, out)
}

function visitPathRecord(value: object, out: string[]) {
  for (const [key, child] of Object.entries(value)) visitPathValue(child, key, out)
}

function isPlainObject(value: unknown): value is object {
  return !!value && typeof value === "object"
}

function collectPathsFromString(value: string, key: string, out: string[]) {
  if (isPathLikeString(value, key)) out.push(value)
  collectRegexMatches(value, /(?:^|\s)([\w./-]+\.[\w-]+)(?=\s|$)/g, out)
  collectRegexMatches(value, /^\+\+\+\s+b\/(.+)$/gm, out)
  collectRegexMatches(value, /^---\s+a\/(.+)$/gm, out)
  collectRegexMatches(value, /^\*\*\*\s+(?:Update|Add|Delete)\s+File:\s+(.+)$/gm, out)
}

function isPathLikeString(value: string, key: string) {
  return /^(filePath|path|filename|file|cwd)$/i.test(key) || /[/.]/.test(value)
}

function collectRegexMatches(value: string, regex: RegExp, out: string[]) {
  for (const match of value.matchAll(regex)) out.push(match[1].trim())
}
