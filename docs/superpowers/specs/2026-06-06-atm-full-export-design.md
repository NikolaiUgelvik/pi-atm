# ATM Full Export Design

Date: 2026-06-06

## Summary

Add an opt-in full audit recorder to pi-atm and expose `/atm export` to generate a self-contained HTML export in the current working directory. The export is intended to be Pi's `/export`, but with all data that normal export omits: hidden/custom messages, context rewrites, tool lifecycle details, exact provider payloads sent to the LLM, provider response metadata, finalized assistant responses, and ATM state/debug events.

This feature is explicitly sensitive. It stores raw prompts, tool inputs/outputs, hidden messages, provider payloads, and response metadata without redaction when enabled.

## Goals

- Store every extension-observable event needed to reconstruct what happened in a Pi session.
- Capture the exact provider payload sent to the LLM using Pi's `before_provider_request` hook.
- Capture finalized assistant responses as Pi records them, including model/provider/usage metadata.
- Capture tool calls and tool results, including arguments, output, details, and error flags.
- Capture hidden/custom messages and ATM context transformations that do not appear in normal `/export`.
- Provide `/atm export` to write a polished, self-contained HTML file in the current working directory.
- Provide export UI filters similar to Pi's export UI so users can inspect by event kind.

## Non-goals

- Do not redact, summarize, or sanitize recorded payloads.
- Do not change Pi core `/export` behavior.
- Do not guarantee raw streaming response chunk capture unless Pi exposes that data through extension hooks. Version 1 records response status/headers and finalized assistant messages.
- Do not enable full recording by normal `debug: true`; raw capture must require a separate explicit environment variable.

## Enablement

Full recording is enabled only when this environment variable is truthy:

```sh
PI_ATM_FULL_EXPORT=1 pi
```

Truthy values are `1`, `true`, `yes`, and `on` case-insensitively. Any other value leaves recording disabled.

When enabled, ATM should notify in the UI during `session_start`:

> ATM full export recording is enabled. Raw prompts, hidden messages, tool data, and provider payloads will be stored without redaction.

This warning should also be written to the existing ATM debug daily log if `debug` is enabled.

## Storage

Raw audit events are appended as JSON Lines under the ATM log directory:

```text
~/.pi/agent/logs/atm/full-export/<session-key>.jsonl
```

The existing `sessionKeyFromContext()` should be reused so recording aligns with ATM's persistent state key. If the session key contains path-unsafe characters, encode or hash it for the filename while preserving the original session key in each event envelope.

Each audit event uses this envelope:

```ts
type FullExportEvent = {
  version: 1
  id: string
  timestamp: string
  sessionKey: string
  cwd?: string
  kind: FullExportKind
  turnIndex?: number
  toolCallId?: string
  toolName?: string
  provider?: string
  model?: string
  payload: unknown
}
```

`id` should be unique and stable enough for export links, for example `<epoch-ms>-<counter>`.

`payload` must store raw event data exactly as observed by the extension. For provider requests, `payload` must be the exact `event.payload` object received from `before_provider_request`, not a transformed ATM message list.

## Event kinds

Record these event kinds when full recording is enabled:

| Kind | Source hook | Payload |
| --- | --- | --- |
| `session_start` | `session_start` | Session reason, cwd, session key, session file if available, model if available, current entries snapshot metadata. |
| `input` | `input` | Raw user input text, images metadata/payload as exposed, source, streaming behavior. |
| `before_agent_start` | `before_agent_start` | Prompt, images metadata/payload as exposed, chained system prompt, structured system prompt options. |
| `context` | `context` | Original context messages, transformed messages returned by ATM, prune report, nudge status, compacted/trigger metadata. |
| `provider_request` | `before_provider_request` | Exact provider request payload immediately before it is sent. |
| `provider_response` | `after_provider_response` | HTTP status and normalized headers as exposed by Pi. |
| `turn_start` | `turn_start` | Turn index and timestamp. |
| `turn_end` | `turn_end` | Turn index, finalized assistant message, tool results. |
| `message_start` | `message_start` | Raw message object. |
| `message_update` | Not recorded for new exports | Streaming assistant deltas are intentionally skipped because they can create high-volume partial-character noise. Existing exports that contain this kind remain renderable. |
| `message_end` | `message_end` | Finalized message object. |
| `tool_execution_start` | `tool_execution_start` | Tool call id, tool name, args. |
| `tool_execution_update` | `tool_execution_update` | Tool call id, tool name, args, partial result. |
| `tool_execution_end` | `tool_execution_end` | Tool call id, tool name, result, error flag. |
| `tool_call` | `tool_call` | Tool call id, tool name, mutable input as seen before execution. |
| `tool_result` | `tool_result` | Tool call id, tool name, input, content, details, error flag. |
| `session_shutdown` | `session_shutdown` | Shutdown reason and target session file if present. |
| `atm_state` | ATM save/debug points | ATM state snapshots or save summaries useful for reconstructing compression behavior. |

The implementation must favor completeness over compactness. Duplicate data from overlapping hooks is acceptable because `/atm export` can group and filter it, and duplicates are preferable to losing raw observable data.

## Integration with existing ATM context hook

The current `context` handler already computes:

- `contextMessages`
- compaction detection result
- manual trigger result
- pruned/transformed `messages`
- `report`
- nudge injection result

Full export recording should write a `context` event containing both the pre-ATM messages and the final messages returned to Pi. This event must not rely on `config.debug`; it depends only on `PI_ATM_FULL_EXPORT`.

The existing `debugSnapshot()` and `debugLog()` functions should remain unchanged for normal debug mode. Full export should live in a new focused module, for example `src/full-export/recorder.ts`, to avoid bloating `src/debug.ts` or `src/index.ts` past Biome's 500-line limit.

## `/atm export` command

Add a new subcommand:

```text
/atm export [filter]
```

With no filter argument, export all recorded events. If a filter argument is provided, treat it as a comma-separated list of event kinds or broad categories.

Examples:

```text
/atm export
/atm export provider_request,provider_response
/atm export tool,context
```

Broad categories:

- `message`: `input`, `before_agent_start`, `message_start`, `message_update` (legacy), `message_end`, `turn_end`
- `tool`: `tool_execution_start`, `tool_execution_update`, `tool_execution_end`, `tool_call`, `tool_result`
- `provider`: `provider_request`, `provider_response`
- `context`: `context`
- `session`: `session_start`, `session_shutdown`
- `atm`: `atm_state`

The command writes a file in `ctx.cwd` or the process cwd fallback:

```text
atm-export-YYYY-MM-DDTHH-MM-SS-sssZ.html
```

After writing, notify the user with the relative or absolute path and event count.

If full recording is disabled or no event file exists, `/atm export` should still generate an HTML file containing available data from:

- `ctx.sessionManager.getEntries()`
- `ctx.sessionManager.buildSessionContext().messages`
- current ATM state

It should include a visible warning that exact provider payloads and event history are unavailable because recording was not enabled for the session.

## HTML export design

The generated HTML must be self-contained: inline CSS, inline JavaScript, and embedded JSON event data. It should not load external resources.

The visual design should be similar to Pi's `/export` sample:

- dark theme
- monospaced text
- sticky sidebar
- timeline/navigation list
- search box
- filter chips
- main detail pane/cards
- collapsible raw JSON blocks

### Sidebar

The sidebar lists events in chronological order. Each item shows:

- timestamp
- event kind
- role/tool/provider label when relevant
- short preview derived from payload

Clicking an item scrolls/focuses the corresponding event card.

### Filters

Provide filter chips or toggles for:

- all
- user/input
- assistant/message
- hidden/custom
- tool call
- tool result
- context
- provider request
- provider response
- ATM/session

The client-side filter should combine with search. Search matches kind, labels, preview text, and raw JSON text.

### Event cards

Each event card includes:

- header with kind, timestamp, provider/model/tool metadata
- rendered preview for known payloads
- raw JSON details in a collapsible `<details>` element

Provider request cards should prominently show:

- provider/model if known
- request payload JSON exactly as recorded

Context cards should show:

- original message count
- transformed message count
- token estimates from prune report if available
- expandable original and transformed message arrays

Tool cards should show:

- tool name
- call id
- input/arguments
- content/result
- error status

Hidden/custom messages should be labeled clearly instead of omitted.

## Data safety and error handling

- Recording failures must not break the agent loop. Catch serialization and filesystem errors, then write a minimal error to the daily debug log when possible.
- Use synchronous append only if simple and safe; otherwise queue writes to avoid interleaving during parallel tool execution.
- JSON serialization must handle circular or unserializable values by replacing the specific event payload with an error object. Do not silently drop the whole event.
- Export generation should tolerate malformed JSONL lines by including a warning in the HTML and continuing with valid events.
- The export command must not mutate ATM compression state.

## Module structure

Suggested files:

```text
src/full-export/types.ts
src/full-export/recorder.ts
src/full-export/html.ts
src/full-export/filters.ts
```

Responsibilities:

- `types.ts`: event kinds, envelope types, filter category types.
- `recorder.ts`: env parsing, path resolution, safe append, safe JSON serialization, event id generation.
- `filters.ts`: parse `/atm export` arguments and filter events by kind/category.
- `html.ts`: render self-contained HTML export.

`src/index.ts` should only wire hooks and commands to the recorder/exporter to keep the main extension file below Biome's line limit.

## Testing strategy

Add unit tests for:

- env var truthy/falsy parsing
- event filename/path safety
- JSONL append envelope shape
- malformed JSONL tolerance
- filter parsing for exact kinds and broad categories
- HTML escaping of user/tool/provider content
- HTML includes filter controls and embedded event data
- `/atm export` fallback behavior when no full event file exists can be covered by unit-level exporter tests if command integration is hard to mock

Manual verification:

1. Run Pi with `PI_ATM_FULL_EXPORT=1`.
2. Send a prompt that causes at least one tool call.
3. Run `/atm export`.
4. Open the generated HTML file.
5. Verify provider request payloads, hidden/custom messages, tool calls, tool results, context events, and finalized assistant messages are visible and filterable.

## Implementation constraints

- `after_provider_response` exposes response status and headers, not necessarily raw response body or stream chunks. The exporter must label this as provider response metadata.
- Finalized assistant response content must come from `message_end` and/or `turn_end`.
- `message_update` can produce high-volume streaming deltas and must not be recorded for new exports. Keep render/filter support for old exports that already contain this event kind.
- Because this feature writes sensitive data, keep the environment variable separate from existing `debug` config.
