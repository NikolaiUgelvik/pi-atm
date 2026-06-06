import type { AtmMessage, MessagePart } from "./types.js"

type ProviderContext = { provider?: unknown; model?: unknown }

export function stripStaleProviderMetadata(messages: AtmMessage[]) {
  const current = currentProviderContext(messages)
  if (!current.provider && !current.model) return messages
  return messages.map((message) => stripAssistantMetadata(message, current))
}

function currentProviderContext(messages: AtmMessage[]): ProviderContext {
  const latestUser = [...messages].reverse().find(hasProviderMetadata)
  return {
    provider: latestUser?.provider ?? latestUser?.metadata?.provider,
    model: latestUser?.model ?? latestUser?.metadata?.model,
  }
}

function hasProviderMetadata(message: AtmMessage) {
  return (
    message.role === "user" &&
    (message.provider || message.model || message.metadata?.provider || message.metadata?.model)
  )
}

function stripAssistantMetadata(message: AtmMessage, current: ProviderContext) {
  if (message.role !== "assistant") return message
  return isCurrentProviderMessage(message, current) ? message : withoutProviderMetadata(message)
}

function isCurrentProviderMessage(message: AtmMessage, current: ProviderContext) {
  const provider = message.provider ?? message.metadata?.provider
  const model = message.model ?? message.metadata?.model
  return providerMatches(provider, current.provider) && providerMatches(model, current.model)
}

function providerMatches(value: unknown, current: unknown) {
  return !value || value === current
}

function withoutProviderMetadata(message: AtmMessage) {
  const out: AtmMessage = { ...message }
  delete out.provider
  delete out.model
  if (out.metadata) out.metadata = metadataWithoutProvider(out.metadata)
  if (Array.isArray(out.content)) out.content = out.content.map(stripProviderFromPart)
  return out
}

function metadataWithoutProvider<T extends Record<string, unknown>>(metadata: T) {
  const out = { ...metadata }
  delete out.provider
  delete out.model
  return out
}

function stripProviderFromPart(part: MessagePart): MessagePart {
  const out: MessagePart = { ...part }
  delete out.provider
  delete out.model
  if (out.metadata) out.metadata = metadataWithoutProvider(out.metadata)
  return out
}
