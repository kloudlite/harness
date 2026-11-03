# Kloudlite plugin for Claude Code

Gives Claude Code the Kloudlite skills and the session's tools.

Needs the `kloudlite` CLI on `PATH` (the MCP server runs `kloudlite mcp`) and a session: the one `kloudlite sessions use` selected, or `session_pick`/`session_use` in the tools.

## Install

```sh
claude plugin marketplace add kloudlite/harness
claude plugin install kloudlite@kloudlite
```

Inside Claude Code: `/plugin marketplace add kloudlite/harness`, then `/plugin install kloudlite@kloudlite`.

## Update

```sh
claude plugin marketplace update kloudlite
claude plugin update kloudlite@kloudlite
```

## Uninstall

```sh
claude plugin uninstall kloudlite@kloudlite
claude plugin marketplace remove kloudlite
```

## Layout

`.claude-plugin/marketplace.json` at the repository root lists the plugin at `laptop-plugin/plugin`. `skills/` there is copied from `../skills` by `sync-skills.sh`.
