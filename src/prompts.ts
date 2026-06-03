import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { Config } from "./types.js"

const DEFAULTS: Record<string, string> = {
  "context-limit-nudge.md":
    "[Active Token Management]\nContext is above the configured limit. Use the compress tool to summarize stale/completed work. Preserve decisions, files, commands, errors, and next steps. Prefer ranges using m0001 aliases or block aliases like b1.",
  "turn-nudge.md":
    "[Active Token Management]\nContext is growing. If completed work is stale, consider compressing it while keeping recent active work verbatim.",
  "iteration-nudge.md":
    "[Active Token Management]\nMany assistant/tool messages have occurred since the last user turn. If this work is complete, compress stale context now and keep active debugging details verbatim.",
  "system.md":
    "Active Token Management is available. Use compress only for stale or completed context and produce high-fidelity summaries.",
  "compress-range.md":
    "Compress contiguous message ranges using startId/endId aliases. Summaries must preserve all technical details.",
  "compress-message.md": "Compress individual message aliases. Do not use block aliases in message mode.",
}

function homeBase() {
  return join(process.env.HOME || ".", ".pi/agent/atm-prompts")
}
function projectBase(cwd: string) {
  return join(cwd, ".pi/atm-prompts")
}

export function ensurePromptDefaults(config: Config) {
  if (!config.experimental?.customPrompts) return
  const dir = join(homeBase(), "defaults")
  mkdirSync(dir, { recursive: true })
  for (const [name, body] of Object.entries(DEFAULTS)) {
    const file = join(dir, name)
    if (!existsSync(file)) writeFileSync(file, `${body}\n`)
  }
  const readme = join(dir, "README.md")
  if (!existsSync(readme))
    writeFileSync(
      readme,
      "Copy files to an overrides directory to customize ATM prompts. Project overrides live in .pi/atm-prompts/overrides/.\n",
    )
  mkdirSync(join(homeBase(), "overrides"), { recursive: true })
}

export function prompt(config: Config, cwd: string, name: keyof typeof DEFAULTS) {
  if (!config.experimental?.customPrompts) return DEFAULTS[name]
  ensurePromptDefaults(config)
  for (const dir of [join(projectBase(cwd), "overrides"), join(homeBase(), "overrides")]) {
    const file = join(dir, name)
    if (!existsSync(file)) continue
    try {
      const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n").trim()
      if (text) return text
    } catch {}
  }
  return DEFAULTS[name]
}
