# Setup

Give these steps to the user when no Kode tool is present. Never run the installer or the login yourself unless told.

1. Install `kode` (macOS, Linux; WSL on Windows): `curl -fsSL https://dev.kodespace.io/install.sh | sh`
2. Sign in (opens the browser): `kode login`
3. Connect the agent. Claude Code with the plugin (tools and skills; needs no `kode` binary): `/plugin marketplace add kloudlite/harness`, then `/plugin install kode@kode`; the first tool call opens the browser sign-in, and the consent page picks the teams; the agent lists or creates the desk. Codex (ChatGPT) with the same plugin: `codex plugin marketplace add kloudlite/harness`, then install Kode from `/plugins`; sign-in works the same way. Another MCP client: `claude mcp add kd -- kode mcp`, or the JSON `{"mcpServers": {"kd": {"command": "kode", "args": ["mcp"]}}}`; for another team or desk, `["mcp", "TEAM", "--desk", "DESK"]`. A client that cannot start a program uses the remote URL `https://dev.kodespace.io/mcp` with OAuth.
4. Make a netgroup if you want one besides `main`: `netgroup` `create` (with `environment` to connect one). A call names it in `netgroup`; without it the call acts in your `main`.
5. Restart the client. It then lists the server `kd`.

After setup, `netgroup` with `action: "list"` must show the netgroup the user expects. Pass `netgroup` with its name (and `team` for a team's) on a call that acts elsewhere than `main`.

## Hosts

Read your row.

| Host | Tools | Local commands | Local files | Who works |
|---|---|---|---|---|
| Claude Code with the plugin (remote server) | `mcp__plugin_kode_kd__*`, without `web_fetch`, `web_search` and `scratch_*` | yes | yes | one agent, the coordinator |
| MCP client with `kode mcp` | server `kd`, all scopes in one list | only with a shell tool | only with file tools | one agent, the coordinator |
| Codex with the plugin (remote server) | the `kd` MCP tools, without `web_fetch`, `web_search` and `scratch_*` | yes | yes | one agent, the coordinator |
| Remote connector (claude.ai, ChatGPT) | `/mcp` over OAuth | no | no | one agent, the coordinator |
| Kode runtime (shared) | split by role: the coordinator holds `worker_ask`, a worker holds `report` | the coordinator's scratch folder only | no | a coordinator and its workers; the role skills `coordinator` and `worker` |

- **The netgroup argument.** On the remote door a call acts in the netgroup named by its optional `netgroup` argument (id or name), else in your `main`. `team` names which of the teams you connected.
- **The harness.** The harness drives one fixed desk, which it supplies itself: its agents pass no `desk`, `workspace` `create` always lands in that desk, and a task that needs another desk is for the user to open. Its tools are served by the bench, the process that serves your own tools on the desk: `netgroup` `stop` stops it too, so say so first and make it your last call.
- **MCP doors.** `kode mcp` (the laptop door) and `https://dev.kodespace.io/mcp` (the remote door) serve the same tools; the remote door's default `soft_ms` is 20 s, and it cuts a wait at 20 s, or at 40 s for a client that asks for progress (`tools.md`).
- **No tool.** Connecting a provider (the web console) and `kode env`, the tunnel to the laptop: give the user the exact command, or run it only on a host with a shell.
