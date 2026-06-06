import { indexFromAlias } from "./message-id-alias.js"
import type { AtmMessage } from "./types.js"
import { EXT } from "./types.js"

function blockIdFromAlias(id?: string) {
  const match = /^b(\d+)$/.exec(id || "")
  return match ? Number(match[1]) : undefined
}

export function compressionBlockId(m: AtmMessage): number | undefined {
  if (m.role !== "custom" || m.customType !== EXT || typeof m.content !== "string") return undefined
  const match = /<compressed-context\b[^>]*\bid="(\d+)"/i.exec(m.content)
  return match ? Number(match[1]) : undefined
}

export function indexFromMessageOrBlockAlias(messages: AtmMessage[], id?: string) {
  const msg = indexFromAlias(id)
  if (msg >= 0) return msg
  const block = blockIdFromAlias(id)
  return block ? messages.findIndex((m) => compressionBlockId(m) === block) : -1
}
