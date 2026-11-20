# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

The agent-facing side of Kode, a Bun monorepo:

- `skills/` — the skills: `kode` (the platform, its rules and how to choose) and `caveman`. `kode` is the one the plugin ships.
- `laptop-plugin/` — the Claude Code and Codex plugin: the remote `kd` MCP server and the `kode` skill (`plugin/skills/` is a copy, made by `laptop-plugin/sync-skills.sh`). Pushing `main` publishes it.
- `packages/tools` — the tool definitions (names, descriptions, schemas) the Kode runtime serves; `scripts/dump-schemas.ts` writes them out for the runtime's fixture (kode `bins/runtime/tests/fixtures/tool-schemas.json`).

## Commands

```bash
bun install
bun run check                                   # tsc --noEmit across the workspaces
bun test skills laptop-plugin packages/tools    # what CI runs
bun scripts/dump-schemas.ts                     # the tool schemas, for the runtime fixture
```

## Rules

- A skill change: edit `skills/<name>/`, run `sh laptop-plugin/sync-skills.sh`, bump the plugin version in `laptop-plugin/plugin/.claude-plugin/plugin.json`, `laptop-plugin/plugin/.codex-plugin/plugin.json` and `.claude-plugin/marketplace.json`.
- A tool change: edit `packages/tools`, dump the schemas, take the changed tools into the runtime fixture in kode, and ship `kode-runtime`. The runtime must list a new argument before the api sends it.
