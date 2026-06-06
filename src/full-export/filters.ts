import {
  type FullExportCategory,
  type FullExportEvent,
  type FullExportKind,
  fullExportCategoryKinds,
  fullExportKinds,
  type ParsedFullExportFilter,
} from "./types.js"

const knownKinds = new Set<string>(fullExportKinds)
const categories = fullExportCategoryKinds as Record<FullExportCategory, readonly FullExportKind[]>

export function parseFullExportFilter(input: string | undefined): ParsedFullExportFilter {
  const tokens = (input ?? "")
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean)
  const kinds = new Set<FullExportKind>()
  const unknown: string[] = []

  for (const token of tokens) {
    if (knownKinds.has(token)) {
      kinds.add(token as FullExportKind)
    } else if (isFullExportCategory(token)) {
      for (const kind of categories[token]) kinds.add(kind)
    } else {
      unknown.push(token)
    }
  }

  return { includeAll: tokens.length === 0, kinds, unknown }
}

export function filterEvents(events: FullExportEvent[], filter = parseFullExportFilter(undefined)) {
  if (filter.includeAll) return events
  return events.filter((event) => filter.kinds.has(event.kind))
}

function isFullExportCategory(token: string): token is FullExportCategory {
  return token in categories
}
