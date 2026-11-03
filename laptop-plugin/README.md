# Kloudlite plugin for Claude Code

Gives Claude Code the Kloudlite skills and the session's tools. Claude Code runs nothing on your computer in kl mode.

Needs the `kloudlite` CLI on `PATH` (hooks run `kloudlite mode`, the MCP server runs `kloudlite mcp`) and a session.

## Install

```sh
claude plugin marketplace add kloudlite/harness
claude plugin install kloudlite@kloudlite
```

Inside Claude Code: `/plugin marketplace add kloudlite/harness`, then `/plugin install kloudlite@kloudlite`.

`kloudlite claude` needs none of this: it writes the plugin it embeds and starts Claude Code with it.

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
