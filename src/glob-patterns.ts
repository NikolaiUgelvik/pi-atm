export function matchesAny(value: string | undefined, patterns: Set<string> | string[]) {
  if (!value) return false
  for (const pattern of Array.from(patterns || [])) if (globMatch(value, pattern)) return true
  return false
}

function globMatch(value: string, pattern: string) {
  if (!pattern) return false
  return new RegExp(globToRegex(pattern)).test(value)
}

function globToRegex(pattern: string) {
  let out = "^"
  for (let index = 0; index < pattern.length; index++) {
    const token = globToken(pattern, index)
    out += token.regex
    index += token.skip
  }
  return `${out}$`
}

function globToken(pattern: string, index: number) {
  const char = pattern[index]
  if (char === "*" && pattern[index + 1] === "*") return globStarToken(pattern, index)
  if (char === "*") return { regex: "[^/]*", skip: 0 }
  if (char === "?") return { regex: "[^/]", skip: 0 }
  return { regex: escapeRegex(char), skip: 0 }
}

function globStarToken(pattern: string, index: number) {
  const includesSlash = pattern[index + 2] === "/"
  return includesSlash ? { regex: "(?:.*/)?", skip: 2 } : { regex: ".*", skip: 1 }
}

function escapeRegex(s: string) {
  return s.replace(/[|\\{}()[\]^$+?.]/g, "\\$&")
}
