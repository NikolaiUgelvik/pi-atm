import { createHash } from "node:crypto"
import type { AtmMessage, Config, MessagePart, MutableRecord, ToolCallPart } from "./types.js"
import { alwaysProtectedTools, EXT } from "./types.js"

export function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T
}

export function stableJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? String(v)
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`
  const record = v as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableJson(record[k])}`)
    .join(",")}}`
}

export function stripJsonComments(s: string) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1")
    .replace(/,\s*([}\]])/g, "$1")
}

export function textResult(text: string, isError = false) {
  return { isError, content: [{ type: "text" as const, text }], details: undefined }
}

export function escapeAttr(s: string) {
  const replacements: Record<string, string> = { '"': "&quot;", "&": "&amp;", "<": "&lt;", ">": "&gt;" }
  return s.replace(/["&<>]/g, (c) => replacements[c] ?? c)
}

export function resolveLimit(v: number | string, window: number) {
  if (typeof v === "number") return v
  const m = /^(\d+(?:\.\d+)?)%$/.exec(v)
  return m ? Math.floor((window * Number(m[1])) / 100) : Number(v) || 100_000
}

export function estimateText(s: string) {
  return Math.ceil((s || "").length / 4)
}

export function estimateMessages(ms: AtmMessage[]) {
  return ms.reduce((n, m) => n + estimateText(textOf(m) + stableJson(m).slice(0, 2000)), 0)
}

export function textOf(m: AtmMessage | undefined): string {
  if (!m) return ""
  if (typeof m.content === "string") return m.content
  if (Array.isArray(m.content)) return m.content.map(textFromPart).join("\n")
  if (typeof m.summary === "string") return m.summary
  if (typeof m.output === "string") return m.output
  return stableJson(m)
}

function textFromPart(part: MessagePart) {
  if (typeof part.text === "string") return part.text
  if (typeof part.thinking === "string") return part.thinking
  if (part.type === "toolCall") return `${part.name ?? "tool"} ${stableJson(part.arguments)}`
  return ""
}

function aliasForIndex(i: number) {
  return `m${String(i + 1).padStart(4, "0")}`
}

export function indexFromAlias(id?: string) {
  const m = /^m(\d{4})$/.exec(id || "")
  return m ? Number(m[1]) - 1 : -1
}

function blockIdFromAlias(id?: string) {
  const m = /^b(\d+)$/.exec(id || "")
  return m ? Number(m[1]) : undefined
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

export function range(start: number, end: number) {
  return Array.from({ length: end - start + 1 }, (_, n) => start + n)
}

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
  if (Array.isArray(m.content)) {
    const content = m.content
      .map((part) =>
        part.type === "text" && typeof part.text === "string" ? { ...part, text: stripAtmTags(part.text) } : part,
      )
      .filter((part) => !(part.type === "text" && !part.text))
    return { ...m, content }
  }
  return m
}

export function stripAliasesFromMessages(messages: AtmMessage[]): AtmMessage[] {
  return messages.filter((m) => !isAliasCatalog(m)).map(stripAliasTagsFromMessage)
}

function aliasCatalog(messages: AtmMessage[]): AtmMessage {
  const rows = messages
    .map((m, i) => {
      const role = escapeAttr(String(m.role ?? "unknown"))
      const preview = escapeAttr(stripAtmTags(textOf(m)).replace(/\s+/g, " ").trim().slice(0, 160))
      return `  <message id="${aliasForIndex(i)}" role="${role}" preview="${preview}" />`
    })
    .join("\n")
  return {
    role: "custom",
    customType: EXT,
    display: false,
    details: { aliasCatalog: true },
    content: `<atm-aliases>\n${rows}\n</atm-aliases>`,
  }
}

export function injectMessageAliases(messages: AtmMessage[]): AtmMessage[] {
  if (!messages.length) return messages
  const clean = stripAliasesFromMessages(messages)
  return [...clean, aliasCatalog(clean)]
}

export function fingerprintMessage(m: AtmMessage) {
  return createHash("sha1")
    .update(stableJson(normalizeForHash(m)))
    .digest("hex")
}

function normalizeForHash(m: AtmMessage) {
  const x = stripAliasesFromMessages([clone(m)])[0] ?? clone(m)
  delete x.timestamp
  delete x.usage
  return x
}

export function findToolCallIndex(messages: AtmMessage[], id: string) {
  return messages.findIndex(
    (m) => m.role === "assistant" && Array.isArray(m.content) && m.content.some((part) => isToolCallWithId(part, id)),
  )
}

function isToolCall(part: MessagePart): part is ToolCallPart {
  return part.type === "toolCall"
}

function isToolCallWithId(part: MessagePart, id: string): part is ToolCallPart {
  return isToolCall(part) && part.id === id
}

export function toolCallFor(m: AtmMessage | undefined, id: string): ToolCallPart | undefined {
  if (!Array.isArray(m?.content)) return undefined
  return m.content.find((part): part is ToolCallPart => isToolCallWithId(part, id))
}

export function normalizeToolArgs(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normalizeToolArgs)
  if (!v || typeof v !== "object") return v
  const out: MutableRecord = {}
  for (const key of Object.keys(v).sort()) {
    const value = (v as MutableRecord)[key]
    if (value === null || value === undefined) continue
    out[key] = normalizeToolArgs(value)
  }
  return out
}

export function toolCallKey(m: AtmMessage | undefined, id: string) {
  const tc = toolCallFor(m, id)
  return tc ? `${tc.name}:${stableJson(normalizeToolArgs(tc.arguments ?? {}))}` : undefined
}

export function toolSet(extra: string[]) {
  return new Set([...alwaysProtectedTools, ...(extra || [])])
}

export function matchesAny(value: string | undefined, patterns: Set<string> | string[]) {
  if (!value) return false
  for (const p of Array.from(patterns || [])) if (globMatch(value, p)) return true
  return false
}

function globMatch(value: string, pattern: string) {
  if (!pattern) return false
  return new RegExp(globToRegex(pattern)).test(value)
}

function globToRegex(pattern: string) {
  let out = "^"
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    const next = pattern[i + 1]
    if (c === "*" && next === "*") {
      const slash = pattern[i + 2] === "/"
      out += slash ? "(?:.*/)?" : ".*"
      i += slash ? 2 : 1
    } else if (c === "*") out += "[^/]*"
    else if (c === "?") out += "[^/]"
    else out += escapeRegex(c)
  }
  return `${out}$`
}

function escapeRegex(s: string) {
  return s.replace(/[|\\{}()[\]^$+?.]/g, "\\$&")
}

function extractPaths(v: unknown): string[] {
  const out: string[] = []
  const visit = (x: unknown, key = "") => {
    if (typeof x === "string") {
      if (/^(filePath|path|filename|file|cwd)$/i.test(key) || /[/.]/.test(x)) out.push(x)
      for (const m of x.matchAll(/(?:^|\s)([\w./-]+\.[\w-]+)(?=\s|$)/g)) out.push(m[1])
      for (const m of x.matchAll(/^\+\+\+\s+b\/(.+)$/gm)) out.push(m[1])
      for (const m of x.matchAll(/^---\s+a\/(.+)$/gm)) out.push(m[1])
      for (const m of x.matchAll(/^\*\*\*\s+(?:Update|Add|Delete)\s+File:\s+(.+)$/gm)) out.push(m[1].trim())
    } else if (Array.isArray(x)) {
      x.forEach((y) => {
        visit(y, key)
      })
    } else if (x && typeof x === "object") {
      for (const [k, y] of Object.entries(x)) visit(y, k)
    }
  }
  visit(v)
  return [...new Set(out)]
}

export function isProtectedToolCall(tc: ToolCallPart | undefined, config: Config) {
  if (!tc) return false
  if (matchesAny(tc.name, toolSet(config.compress.protectedTools))) return true
  const paths = extractPaths(tc.arguments ?? tc.input ?? {})
  return paths.some((p) => matchesAny(p, config.protectedFilePatterns))
}

export function messageTouchesProtectedToolOrFile(messages: AtmMessage[], i: number, config: Config) {
  const m = messages[i]
  if (m?.role === "assistant" && Array.isArray(m.content))
    return m.content.some((part) => isToolCall(part) && isProtectedToolCall(part, config))
  if (m?.role === "toolResult" && m.toolCallId)
    return isProtectedToolCall(toolCallFor(messages[findToolCallIndex(messages, m.toolCallId)], m.toolCallId), config)
  return false
}
