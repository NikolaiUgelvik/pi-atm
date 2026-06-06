import type { FullExportEvent, FullExportRenderInput } from "./types.js"

const filterButtons: Array<{ label: string; filter: string }> = [
  { label: "all", filter: "all" },
  { label: "user/input", filter: "input" },
  { label: "assistant/message", filter: "message" },
  { label: "hidden/custom", filter: "hidden" },
  { label: "tool call", filter: "tool_call" },
  { label: "tool result", filter: "tool_result" },
  { label: "context", filter: "context" },
  { label: "provider request", filter: "provider_request" },
  { label: "provider response", filter: "provider_response" },
  { label: "ATM/session", filter: "atm_session" },
]

export function renderFullExportHtml(input: FullExportRenderInput) {
  const payload = JSON.stringify({ events: input.events, fallback: input.fallback, warnings: input.warnings })
  const cards = input.events.map(renderEventCard).join("\n")
  const nav = input.events.map(renderNavItem).join("\n")
  const warnings = input.warnings.map((warning) => `<div class="warning">${escapeHtml(warning)}</div>`).join("\n")
  const fallback = input.fallback ? renderFallback(input.fallback) : ""

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ATM Full Export</title>
<style>${css()}</style>
</head>
<body>
<script id="atm-export-data" type="application/json">${escapeScriptJson(payload)}</script>
<aside>
  <h1>ATM Full Export</h1>
  <div class="meta">Generated ${escapeHtml(input.generatedAt)}</div>
  <div class="meta">Session ${escapeHtml(input.sessionKey)}</div>
  <div class="meta">cwd ${escapeHtml(input.cwd)}</div>
  <input id="search" type="search" placeholder="Search events" />
  <div class="chips">${filterButtons.map(renderFilterButton).join("")}</div>
  <nav>${nav}</nav>
</aside>
<main>
  ${warnings}
  ${fallback}
  ${cards || '<section class="card"><h2>No events</h2><p>No recorded full export events matched this export.</p></section>'}
</main>
<script>${clientScript()}</script>
</body>
</html>`
}

function renderFilterButton(button: { label: string; filter: string }) {
  return `<button data-filter="${escapeHtml(button.filter)}">${escapeHtml(button.label)}</button>`
}

function renderNavItem(event: FullExportEvent) {
  return `<a href="#${escapeHtml(event.id)}" data-kind="${escapeHtml(event.kind)}">${escapeHtml(event.timestamp)}<br /><strong>${escapeHtml(event.kind)}</strong><br />${escapeHtml(preview(event))}</a>`
}

function renderEventCard(event: FullExportEvent) {
  const raw = JSON.stringify(event.payload, null, 2)
  return `<section class="card" id="${escapeHtml(event.id)}" data-kind="${escapeHtml(event.kind)}" data-search="${escapeHtml(searchText(event))}">
<header>
  <h2>${escapeHtml(event.kind)}</h2>
  <div>${escapeHtml(event.timestamp)}</div>
  <div>${metadata(event)}</div>
</header>
${renderKnownPayload(event)}
<details><summary>Raw JSON</summary><pre>${escapeHtml(raw)}</pre></details>
</section>`
}

function metadata(event: FullExportEvent) {
  return [event.provider, event.model, event.toolName, event.toolCallId]
    .filter(Boolean)
    .map((value) => escapeHtml(String(value)))
    .join(" · ")
}

function renderKnownPayload(event: FullExportEvent) {
  if (event.kind === "provider_request")
    return `<p class="badge">Exact provider request payload as recorded before send</p>`
  if (event.kind === "provider_response") return `<p class="badge">Provider response metadata</p>`
  if (event.kind === "context") {
    return `<p class="badge">ATM context rewrite: original and transformed messages are in raw JSON</p>`
  }
  if (event.kind.includes("tool"))
    return `<p class="badge">Tool event ${escapeHtml(event.toolName ?? "unknown tool")}</p>`
  return `<p>${escapeHtml(preview(event))}</p>`
}

function renderFallback(fallback: NonNullable<FullExportRenderInput["fallback"]>) {
  return `<section class="card warning"><h2>Fallback export data</h2><p>Full recording was not available for all session history. Exact provider payloads and event history may be unavailable.</p><details open><summary>Fallback JSON</summary><pre>${escapeHtml(JSON.stringify(fallback, null, 2))}</pre></details></section>`
}

function preview(event: FullExportEvent) {
  const text = typeof event.payload === "string" ? event.payload : JSON.stringify(event.payload)
  return (text ?? "").replace(/\s+/g, " ").slice(0, 180)
}

function searchText(event: FullExportEvent) {
  return [
    event.kind,
    event.provider,
    event.model,
    event.toolName,
    event.toolCallId,
    preview(event),
    JSON.stringify(event.payload),
  ]
    .filter(Boolean)
    .join(" ")
}

function escapeHtml(value: string) {
  const replacements: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }
  return value.replace(/[&<>"']/g, (char) => replacements[char] ?? char)
}

function escapeScriptJson(value: string) {
  return escapeHtml(value).replace(/<\//g, "<\\/")
}

function css() {
  return `body{margin:0;background:#0d1117;color:#d6deeb;font:14px ui-monospace,SFMono-Regular,Menlo,monospace}aside{position:fixed;inset:0 auto 0 0;width:320px;overflow:auto;background:#111827;border-right:1px solid #263244;padding:16px;box-sizing:border-box}main{margin-left:352px;padding:24px;max-width:1100px}h1,h2{color:#f8fafc}a{display:block;color:#9ccfd8;text-decoration:none;border-bottom:1px solid #263244;padding:8px 0}.meta{color:#94a3b8;margin:6px 0}#search{width:100%;box-sizing:border-box;background:#0b1220;color:#f8fafc;border:1px solid #334155;border-radius:8px;padding:8px}.chips{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0}.chips button{background:#1f2937;color:#d6deeb;border:1px solid #334155;border-radius:999px;padding:5px 8px;cursor:pointer}.chips button.active{background:#2563eb}.card{background:#111827;border:1px solid #263244;border-radius:14px;margin:0 0 16px;padding:16px}.warning{border-color:#f59e0b;background:#1f1a0b}.badge{display:inline-block;background:#172554;color:#bfdbfe;border-radius:999px;padding:4px 8px}pre{overflow:auto;background:#020617;border-radius:10px;padding:12px;white-space:pre-wrap}header{display:flex;justify-content:space-between;gap:12px;align-items:baseline}`
}

function clientScript() {
  return `const search=document.getElementById('search');const buttons=[...document.querySelectorAll('[data-filter]')];let active='all';function matchesKind(card){const kind=card.dataset.kind||'';if(active==='all')return true;if(active==='message')return ['input','before_agent_start','message_start','message_update','message_end','turn_end'].includes(kind);if(active==='hidden')return (card.dataset.search||'').includes('custom')||(card.dataset.search||'').includes('hidden');if(active==='atm_session')return ['atm_state','session_start','session_shutdown'].includes(kind);return kind===active}function apply(){const q=(search.value||'').toLowerCase();for(const card of document.querySelectorAll('.card[id]')){const text=(card.dataset.search||'').toLowerCase();card.style.display=matchesKind(card)&&text.includes(q)?'block':'none'}}search.addEventListener('input',apply);for(const button of buttons){button.addEventListener('click',()=>{active=button.dataset.filter;buttons.forEach(b=>b.classList.toggle('active',b===button));apply()})}buttons[0]?.classList.add('active');apply();`
}
