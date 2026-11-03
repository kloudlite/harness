# Kloudlite plugin for Claude Code

Gives Claude Code the Kloudlite skills and the session's tools.

Needs no `kloudlite` binary: the MCP server is `https://dev.kloudlite.io/mcp`. The first tool call opens the browser sign-in, and the consent page picks the teams; the agent picks or creates the session.

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
