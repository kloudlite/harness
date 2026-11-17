# Setup

Give these steps to the user when no Kode tool is present. Never run the installer or the login yourself unless told.

1. Install `kode` (macOS, Linux; WSL on Windows): `curl -fsSL https://dev.kodespace.io/install.sh | sh`
2. Sign in (opens the browser): `kode login`
3. Connect the agent. Claude Code with the plugin (tools and skills; needs no `kode` binary): `/plugin marketplace add kloudlite/harness`, then `/plugin install kode@kode`; the first tool call opens the browser sign-in, and the consent page picks the teams; the agent lists or creates the desk. Another MCP client: `claude mcp add kd -- kode mcp`, or the JSON `{"mcpServers": {"kd": {"command": "kode", "args": ["mcp"]}}}`; for another team or desk, `["mcp", "TEAM", "--desk", "DESK"]`. A client that cannot start a program uses the remote URL `https://dev.kodespace.io/mcp` with OAuth.
4. Make a desk: `desk` `create` (with `environment` to connect one), or open one once with `kode -s NAME`. Every call then names it in `desk`.
5. Restart the client. It then lists the server `kd`.

After setup, `desk` with `action: "list"` must show the desk the user expects. Pass `desk` with its name (and `team` for a team desk) on each call.

## Hosts

Read your row.

| Host | Tools | Local commands | Local files | Who works |
|---|---|---|---|---|
| Claude Code with the plugin (remote server) | `mcp__plugin_kode_kd__*`, without `web_fetch`, `web_search` and `scratch_*` | yes | yes | one agent, the coordinator |
| MCP client with `kode mcp` | server `kd`, all scopes in one list | only with a shell tool | only with file tools | one agent, the coordinator |
| Remote connector (claude.ai, ChatGPT) | `/mcp` over OAuth | no | no | one agent, the coordinator |
| Kode runtime (shared) | split by role: the coordinator holds `worker_ask`, a worker holds `report` | the coordinator's scratch folder only | no | a coordinator and its workers; the role skills `coordinator` and `worker` |

- **The desk argument.** A call acts in the desk named by its `desk` argument (id or name) on the laptop door, the remote server, the plugin and a remote connector; a door refuses a call without it. `team` names which of the teams you connected.
- **The harness.** The harness drives one fixed desk, which it supplies itself: its agents pass no `desk`, `workspace` `create` always lands in that desk, and a task that needs another desk is for the user to open. Its tools are served by the bench, the process that serves your own tools on the desk: `desk` `stop` stops it too, so say so first and make it your last call.
- **MCP doors.** `kode mcp` (the laptop door) and `https://dev.kodespace.io/mcp` (the remote door) serve the same tools; a door's default `soft_ms` is 5 s and a `wait` is cut at 20 s (`tools.md`).
- **No tool.** Connecting a provider (the web console) and `kode env`, the tunnel to the laptop: give the user the exact command, or run it only on a host with a shell.
