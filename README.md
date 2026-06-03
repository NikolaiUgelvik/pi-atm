# pi-atm

Active Token Management extension for [Pi](https://github.com/Earendil-Works/pi).

pi-atm keeps large sessions usable by non-destructively rewriting outbound LLM context, registering a model-facing `compress` tool for durable summaries, injecting compression nudges when context grows, and exposing `/atm` commands for manual control.

## Tools

- `compress` — replace stale or completed conversation context with a high-fidelity technical summary without modifying session history.

## Command

```text
/atm [compress [focus]] | context | stats | sweep [n] | decompress <id> | recompress <id> | manual [on|off] | enable | disable
```

## Installation

Install from GitHub as a Pi package:

```bash
pi install git:github.com/NikolaiUgelvik/pi-atm
```

Or use a local checkout while developing:

```bash
pi install /path/to/pi-atm
```

After changing extension code in a local checkout, reload Pi with `/reload`. If dependencies or `package.json` changed, restart Pi or reinstall/update the package.

## Configuration

ATM reads configuration from, in order:

- `~/.pi/agent/atm.jsonc`
- `~/.pi/agent/atm.json`
- `<project>/.pi/atm.jsonc`
- `<project>/.pi/atm.json`

The JSON schema is `atm.schema.json`.

Custom prompt overrides, when enabled, live under:

- `~/.pi/agent/atm-prompts`
- `<project>/.pi/atm-prompts`

Persistent state and debug logs use:

- `~/.pi/agent/state/atm`
- `~/.pi/agent/logs/atm`

## Development

Use Node `24.x` and npm `11.x`:

```bash
npm install
npm run check
npm run typecheck
```

The Pi package manifest loads extensions from `extensions/`; `extensions/pi-atm.ts` delegates to the implementation in `src/`.
