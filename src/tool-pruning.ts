import type { MutableRecord } from "./types.js"

export function pruneFailedToolInput(v: unknown): unknown {
  if (typeof v === "string") return "[input removed due to failed tool call]"
  if (Array.isArray(v)) return v.map(pruneFailedToolInput)
  if (!v || typeof v !== "object") return v
  const out: MutableRecord = {}
  for (const [k, value] of Object.entries(v)) {
    if (k === "questions") out[k] = "[questions removed - see output for user's answers]"
    else out[k] = pruneFailedToolInput(value)
  }
  return out
}
