---
description: Turn kl mode on. Nothing runs, reads or writes on this laptop; work goes through the kl tools.
---
kl mode is on. From now on, do all work through the `mcp__plugin_kloudlite_kl__*` tools. The tools that run, read or write on this laptop are refused. Other tools, such as Agent, Artifact and the web tools, work. Load the `kloudlite:kloudlite`, `kloudlite:orchestrate` and `kloudlite:develop` skills now. Then:

1. Call `workspace_list`. If the tool does not exist or the call fails because the kl server is not connected, stop. Do not spawn agents. Tell the person in one line: the kl tools are not connected; restart Claude Code (or run `/mcp` to reconnect `plugin:kloudlite:kl`), then run `/kloudlite:on` again.
2. Call `session_start`. If it returns `choose` (several sessions) or `choose_environment` (no session yet and no environment to start from), ask the person with AskUserQuestion (options = the names), then call `session_use` with the chosen id, or `session_create` with name `main` and the chosen environment. The result holds `session` with its `workspaces`. If it has none, tell the person so and spawn no agents.
3. For each workspace in `session.workspaces` whose state is `ready`, spawn one `kl-workspace` agent in the background. Give the agent the name of the workspace. The prompt is: `Workspace <name> (<id>). No goal yet.` Spawn them all in one message.
4. For each of those workspaces, call `process_list`. For each process whose state is `running`, start a follow (refer to "Show running processes" in the `kloudlite:orchestrate` skill).
5. Do not start a stopped workspace. Do not wait for the agents.
6. Tell the person in one line that kl mode is on, name the session, and name the workspaces that have an agent.
