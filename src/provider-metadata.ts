import type { AtmMessage, MessagePart } from "./types.js"

export function stripStaleProviderMetadata(messages: AtmMessage[]) {
  const latestUser = [...messages]
    .reverse()
    .find((m) => m.role === "user" && (m.provider || m.model || m.metadata?.provider || m.metadata?.model))
  const currentProvider = latestUser?.provider ?? latestUser?.metadata?.provider
  const currentModel = latestUser?.model ?? latestUser?.metadata?.model
  if (!currentProvider && !currentModel) return messages
  return messages.map((m) => {
    if (m.role !== "assistant") return m
    const provider = m.provider ?? m.metadata?.provider
    const model = m.model ?? m.metadata?.model
    if ((!provider || provider === currentProvider) && (!model || model === currentModel)) return m
    const out: AtmMessage = { ...m }
    delete out.provider
    delete out.model
    if (out.metadata) {
      out.metadata = { ...out.metadata }
      delete out.metadata.provider
      delete out.metadata.model
    }
    if (Array.isArray(out.content)) out.content = out.content.map(stripProviderFromPart)
    return out
  })
}

function stripProviderFromPart(part: MessagePart): MessagePart {
  const out: MessagePart = { ...part }
  delete out.provider
  delete out.model
  if (out.metadata) {
    out.metadata = { ...out.metadata }
    delete out.metadata.provider
    delete out.metadata.model
  }
  return out
}
