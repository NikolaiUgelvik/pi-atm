# ATM Export Pi-Style Conversation View Design

## Summary

Update the ATM full HTML export so it keeps the current audit completeness but presents events in a Pi-export-inspired conversation view. The export should feel closer to Pi's session export: compact dark monospaced UI, sticky/resizable sidebar, centered content column, conversation-style user/assistant/tool blocks, and raw audit JSON available as secondary expandable detail.

This design is intentionally a visual and rendering redesign of `src/full-export/html.ts`. It does not change event recording, filtering semantics, or exported data shape.

## Goals

- Preserve every ATM full-export event currently included in the HTML output.
- Make the main pane read like a conversation instead of a raw sequence of audit cards.
- Keep ATM-specific audit value for provider requests/responses, context rewrites, and ATM state snapshots.
- Reuse the visual language of Pi's HTML session export as the design reference.
- Keep the export self-contained with inline CSS, inline JavaScript, and embedded JSON data.

## Non-goals

- Do not import or depend on Pi's export source at runtime.
- Do not change full-export event recording or `FullExportEvent` types.
- Do not omit provider/context/ATM events to make the view cleaner.
- Do not add external assets, CDN dependencies, or network requests.
- Do not implement a separate browser mockup or visual companion.

## Reference files inspected

- ATM renderer: `src/full-export/html.ts`
- ATM exported sample: `atm-export-2026-06-06T07-26-50-515Z.html`
- Pi exported sample: `pi-session-2026-06-06T07-17-46-256Z_019e9bcb-8290-7a78-82b7-29775a3e9096.html`
- Pi renderer artifacts:
  - `/Users/nikolaiugelvik/.nvm/versions/node/v24.14.0/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/export-html/index.js`
  - `/Users/nikolaiugelvik/.nvm/versions/node/v24.14.0/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/export-html/template.css`
  - `/Users/nikolaiugelvik/.nvm/versions/node/v24.14.0/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/export-html/template.js`

## Current state

`src/full-export/html.ts` currently renders:

- a fixed `aside` sidebar with metadata, search, chips, and one chronological link per event
- a `main` pane with one generic `.card` per event
- minimal known-payload labels for provider/context/tool events
- collapsible raw JSON per card
- simple client-side filter/search over cards

This is useful as an audit log but does not visually match Pi's session export. The Pi export uses:

- `#app` flex layout
- `#sidebar`, `#sidebar-resizer`, `#content`
- compact 12px monospace typography with `--line-height: 18px`
- sidebar search/filter controls and compact tree rows
- main pane capped around 800px width
- conversation blocks such as `.user-message`, `.assistant-message`, `.tool-execution`, custom/system blocks, and markdown/tool output styling

## Proposed architecture

Keep a single renderer module as the first implementation step, but reorganize `src/full-export/html.ts` around three concepts:

1. **Export data embedding**
   - Continue embedding the full `{ events, fallback, warnings }` JSON payload.
   - Use safe escaping for script JSON as today.

2. **Server-side initial HTML rendering**
   - Render sidebar rows and main conversation entries from `FullExportEvent[]`.
   - Render all events exactly once in chronological order.
   - Use event kind to choose Pi-like block classes and summaries.

3. **Client-side interaction**
   - Maintain search and filter chips.
   - Add Pi-like sidebar active-state behavior when clicking entries.
   - Filter both sidebar rows and main conversation entries.
   - Keep raw JSON expandable using native `<details>`.

If `html.ts` approaches Biome's 500-line non-test source limit, extract focused helpers into new modules such as `src/full-export/html-css.ts`, `src/full-export/html-script.ts`, or `src/full-export/html-renderers.ts` rather than adding ignores.

## Layout design

The generated document should use Pi-like structure:

```html
<body>
  <script id="atm-export-data" type="application/json">...</script>
  <div id="app">
    <aside id="sidebar">...</aside>
    <div id="sidebar-resizer"></div>
    <main id="content">...</main>
  </div>
</body>
```

### Sidebar

The sidebar should include:

- title: `ATM Full Export`
- generated timestamp, session key, cwd
- search input styled as `.sidebar-search`
- filter buttons styled as `.filter-btn`
- compact scrollable `.tree-container` with one row per event
- `.tree-status` showing visible count and total event count

Sidebar rows should be visually similar to Pi tree nodes:

- compact line height
- muted timestamps or event ids
- role/kind colored spans
- active row highlight
- rows not matching the active filter/search hidden instead of removed

The sidebar does not need full branch-tree logic because ATM full-export events are chronological audit events, not Pi session tree entries. It can still use Pi's tree visual language.

### Main content

The main pane should include:

- help/status bar explaining that this is a conversation-style audit view and raw JSON is available per entry
- header card with generation/session/cwd/filter metadata
- warnings and fallback data when present
- `#messages` container for all rendered event entries

`#content > *` should be full width with `max-width: 800px`, matching Pi export proportions.

## Event rendering design

Every event gets a main-pane entry with:

- stable DOM id from `event.id`
- `data-kind`, `data-filter-kind`, and `data-search`
- timestamp rendered in `.message-timestamp` or equivalent
- kind/metadata label
- rendered summary based on known payload shape
- raw JSON in a collapsible `<details class="raw-json">`

### Event-to-block mapping

- `input`
  - Render as `.user-message`.
  - Show the input text prominently when payload has `text`.
  - Raw JSON remains expandable.

- `before_agent_start`
  - Render as a custom/system prompt block.
  - Show prompt preview and note that system prompt/provider context is in raw JSON.

- `message_start`, `message_update`, `message_end`, `turn_start`, `turn_end`
  - Render as `.assistant-message` or lightweight timeline/system rows depending on role and payload.
  - Prefer readable message content when available.
  - For streaming update events, keep the event but avoid huge visual noise by showing concise previews with raw JSON expandable.

- `tool_execution_start`, `tool_execution_update`, `tool_execution_end`, `tool_call`, `tool_result`
  - Render as `.tool-execution`.
  - Use pending/success/error classes when error state is detectable from payload.
  - Show tool name, call id, command/path/arguments/result preview where available.

- `context`
  - Render as a custom/audit block.
  - Show original/transformed message counts and token/prune metadata when present.
  - Raw JSON exposes original and transformed arrays.

- `provider_request`
  - Render as a provider/audit block with a prominent label: exact provider request payload as recorded before send.
  - Show provider/model metadata when present.

- `provider_response`
  - Render as a provider/audit block with response metadata and usage/status preview where available.

- `atm_state`, `session_start`, `session_shutdown`
  - Render as compact system/audit blocks.
  - Show session key, cwd, model, state summary, or shutdown reason when present.

### Raw JSON

Raw JSON remains available for every entry:

```html
<details class="raw-json">
  <summary>Raw JSON</summary>
  <pre>...</pre>
</details>
```

The raw JSON should be visually secondary: muted summary, compact spacing, Pi-like code/pre styling.

## Filtering and search

Preserve existing filter categories:

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

Search should match:

- event kind
- timestamp
- provider/model/tool metadata
- rendered preview text
- raw JSON text

Filtering should update both:

- main conversation entries
- sidebar rows

The active filter button should use Pi's `.filter-btn.active` styling.

## Styling design

Adopt Pi export CSS conventions:

- CSS variables for colors, including `--accent`, `--border`, `--borderAccent`, `--muted`, `--dim`, `--text`, `--body-bg`, `--container-bg`, `--info-bg`
- `font-size: 12px`
- `line-height: var(--line-height)` where `--line-height: 18px`
- `#app` flex layout
- sticky full-height sidebar
- `#sidebar-resizer` with draggable width behavior
- compact 3px/4px border radii rather than large rounded cards
- user/tool/custom/provider blocks using Pi-inspired background colors

The exact theme can be static and self-contained; it does not need to resolve Pi user themes.

## Accessibility and usability

- Keep semantic `<button>`, `<input type="search">`, `<main>`, `<aside>`, and `<details>` elements.
- Preserve keyboard/browser-native behavior for search and details.
- Avoid requiring JavaScript for raw content visibility: initial HTML should contain all entries.
- JavaScript enhances filtering, active state, sidebar resize, and scroll-to-entry.

## Error handling and safety

- Escape all rendered HTML from event payloads.
- Escape script JSON safely, preserving the current anti-`</script>` protection.
- If payload shapes are unexpected, fall back to generic preview + raw JSON.
- If fallback export data is present, show a warning block before messages.
- Do not redact or transform raw JSON beyond HTML escaping.

## Testing plan

Implementation should add or update tests for:

- generated HTML contains Pi-like layout ids/classes: `#app`, `#sidebar`, `#sidebar-resizer`, `#content`, `#messages`
- all input events are rendered as user-message-style entries
- tool/provider/context events render with distinct Pi-like audit/tool classes
- raw JSON is present for each event
- filter/search script references both message entries and sidebar rows
- fallback warning remains visible when fallback data is supplied
- generated HTML remains self-contained

Manual verification should include regenerating or rendering an export and comparing it against the supplied Pi sample for overall layout similarity.

## Implementation notes

- Start with `src/full-export/html.ts`.
- Keep the data model unchanged.
- Prefer small helper functions for event classification, preview extraction, metadata extraction, and CSS/script generation.
- Watch the 500-line Biome limit; extract modules before reaching it.
- Do not commit changes unless explicitly requested.
