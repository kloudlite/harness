# Kode plugin for Claude Code

Gives Claude Code the Kode skills and the desk's tools.

Needs no `kode` binary: the MCP server is `https://dev.kloudlite.io/mcp`. The first tool call opens the browser sign-in, and the consent page picks the teams; the agent picks or creates the desk.

## Install

```sh
claude plugin marketplace add kloudlite/harness
claude plugin install kode@kode
```

Inside Claude Code: `/plugin marketplace add kloudlite/harness`, then `/plugin install kode@kode`.

## Update

```sh
claude plugin marketplace update kode
claude plugin update kode@kode
```

## Uninstall

```sh
claude plugin uninstall kode@kode
claude plugin marketplace remove kode
```

## Layout

`.claude-plugin/marketplace.json` at the repository root lists the plugin at `laptop-plugin/plugin`. `skills/` there is copied from `../skills` by `sync-skills.sh`.
