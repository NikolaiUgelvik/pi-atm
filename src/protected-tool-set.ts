import { alwaysProtectedTools } from "./types.js"

export function toolSet(extra: string[]) {
  return new Set([...alwaysProtectedTools, ...(extra || [])])
}
