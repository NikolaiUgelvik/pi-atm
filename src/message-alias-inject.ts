import { escapeAttr } from "./html-attr.js"
import { stripAliasesFromMessages, stripAtmAliasTags } from "./message-alias-strip.js"
import { aliasForIndex } from "./message-id-alias.js"
import type { AtmMessage, MessagePart } from "./types.js"
import { EXT } from "./types.js"

function aliasCatalog(messages: AtmMessage[]): AtmMessage {
  const rows = messages.map(aliasRow).join("\n")
  return {
    role: "custom",
    customType: EXT,
    display: false,
    details: { aliasCatalog: true },
    content: `<atm-aliases>\n${rows}\n</atm-aliases>`,
  }
}

function aliasRow(m: AtmMessage, index: number) {
  const role = escapeAttr(String(m.role ?? "unknown"))
  const preview = escapeAttr(stripAtmAliasTags(aliasPreviewText(m)).replace(/\s+/g, " ").trim().slice(0, 160))
  return `  <message id="${aliasForIndex(index)}" role="${role}" preview="${preview}" />`
}

function aliasPreviewText(message: AtmMessage) {
  if (typeof message.content === "string") return message.content
  if (Array.isArray(message.content)) return message.content.map(aliasPartText).join("\n")
  return String(message.summary ?? message.output ?? "")
}

function aliasPartText(part: MessagePart) {
  if (typeof part.text === "string") return part.text
  if (typeof part.thinking === "string") return part.thinking
  return part.type === "toolCall" ? `${part.name ?? "tool"} ${JSON.stringify(part.arguments ?? {})}` : ""
}

export function injectMessageAliases(messages: AtmMessage[]): AtmMessage[] {
  if (!messages.length) return messages
  const clean = stripAliasesFromMessages(messages)
  return [...clean, aliasCatalog(clean)]
}
