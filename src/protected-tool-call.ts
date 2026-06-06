import { matchesAny } from "./glob-patterns.js"
import { extractPaths } from "./path-extraction.js"
import { toolSet } from "./protected-tool-set.js"
import type { Config, ToolCallPart } from "./types.js"

export function isProtectedToolCall(tc: ToolCallPart | undefined, config: Config) {
  if (!tc) return false
  if (matchesAny(tc.name, toolSet(config.compress.protectedTools))) return true
  const paths = extractPaths(tc.arguments ?? tc.input ?? {})
  return paths.some((path) => matchesAny(path, config.protectedFilePatterns))
}
