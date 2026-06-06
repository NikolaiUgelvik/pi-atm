import type { AtmMessage, RuntimeContext } from "./types.js"

export function toAtmMessages(messages: unknown): AtmMessage[] {
  return Array.isArray(messages) ? (messages as AtmMessage[]) : []
}

export function asRuntimeContext(ctx: unknown): RuntimeContext {
  return ctx as RuntimeContext
}
