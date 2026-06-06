import type { AtmMessage, MessagePart } from "./types.js"
import { EXT } from "./types.js"

function stripAtmTags(s: string) {
  return (s || "")
    .replace(/<\/?atm[^>]*>/gi, "")
    .replace(/<atm-message[^>]*\/>/gi, "")
    .trimStart()
}

function isAliasCatalog(m: AtmMessage) {
  return (
    m.role === "custom" && m.customType === EXT && typeof m.content === "string" && /<atm-aliases\b/i.test(m.content)
  )
}

function stripAliasTagsFromMessage(m: AtmMessage): AtmMessage {
  if (typeof m.content === "string") return { ...m, content: stripAtmTags(m.content) }
  if (Array.isArray(m.content)) return { ...m, content: strippedContent(m.content) }
  return m
}

function strippedContent(content: MessagePart[]) {
  return content
    .map((part) =>
      part.type === "text" && typeof part.text === "string" ? { ...part, text: stripAtmTags(part.text) } : part,
    )
    .filter((part) => !(part.type === "text" && !part.text))
}

export function stripAliasesFromMessages(messages: AtmMessage[]): AtmMessage[] {
  return messages.filter((m) => !isAliasCatalog(m)).map(stripAliasTagsFromMessage)
}

export function stripAtmAliasTags(s: string) {
  return stripAtmTags(s)
}
