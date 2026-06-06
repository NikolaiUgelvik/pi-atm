import { createHash } from "node:crypto"
import { clone } from "./clone.js"
import { stableJson } from "./stable-json.js"
import type { AtmMessage, MessagePart } from "./types.js"
import { EXT } from "./types.js"

export function fingerprintMessage(m: AtmMessage) {
  return createHash("sha1")
    .update(stableJson(normalizeForHash(m)))
    .digest("hex")
}

function normalizeForHash(m: AtmMessage) {
  const x = normalizedAliasFreeMessage(clone(m))
  delete x.timestamp
  delete x.usage
  return x
}

function normalizedAliasFreeMessage(message: AtmMessage): AtmMessage {
  return isAliasCatalog(message) ? { role: "custom", content: "" } : stripAliasMarkup(message)
}

function isAliasCatalog(message: AtmMessage) {
  return (
    message.role === "custom" &&
    message.customType === EXT &&
    typeof message.content === "string" &&
    /<atm-aliases\b/i.test(message.content)
  )
}

function stripAliasMarkup(message: AtmMessage): AtmMessage {
  if (typeof message.content === "string") return { ...message, content: withoutAtmTags(message.content) }
  if (Array.isArray(message.content))
    return { ...message, content: message.content.map(stripAliasPart).filter(hasTextOrNonText) }
  return message
}

function stripAliasPart(part: MessagePart): MessagePart {
  return part.type === "text" && typeof part.text === "string" ? { ...part, text: withoutAtmTags(part.text) } : part
}

function hasTextOrNonText(part: MessagePart) {
  return part.type !== "text" || !!part.text
}

function withoutAtmTags(value: string) {
  return (value || "")
    .replace(/<\/?atm[^>]*>/gi, "")
    .replace(/<atm-message[^>]*\/>/gi, "")
    .trimStart()
}
