# Setup

Give these steps to the user when no Kode tool is present. Never run the installer or the login yourself unless told.

1. Install `kode` (macOS, Linux; WSL on Windows): `curl -fsSL https://dev.kodespace.io/install.sh | sh`
2. Sign in (opens the browser): `kode login`
3. Connect the agent. Claude Code with the plugin (tools and skills; needs no `kode` binary): `/plugin marketplace add kloudlite/harness`, then `/plugin install kode@kode`; the first tool call opens the browser sign-in, and the consent page picks the teams; the agent lists or creates the desk. Another MCP client: `claude mcp add kd -- kode mcp`, or the JSON `{"mcpServers": {"kd": {"command": "kode", "args": ["mcp"]}}}`; for another team or desk, `["mcp", "TEAM", "--desk", "DESK"]`. A client that cannot start a program uses the remote URL `https://dev.kodespace.io/mcp` with OAuth.
4. Make a desk: `desk` `create` (with `environment` to connect one), or open one once with `kode -s NAME`. Every call then names it in `desk`.
5. Restart the client. It then lists the server `kd`.

After setup, `desk` with `action: "list"` must show the desk the user expects. Pass `desk` with its name (and `team` for a team desk) on each call.
