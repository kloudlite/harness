---
name: kloudlite
description: Load first for any request about Kloudlite, or that names a workspace, environment, session, intercept, sandbox, volume, snapshot, pipeline, secret, variable or connector - "set up my project on Kloudlite", "delete all workspaces", "what is running in my environment", "connect Kloudlite to Claude". Gives the definitions, the tools, the safety rules and the setup steps when the Kloudlite tools are missing. Task steps are in kloudlite-develop (code against real services), kloudlite-verify (checks in sandboxes) and kloudlite-automate (pipelines).
---

# Kloudlite

This skill gives the definitions and the rules. The task skills give the steps: `kloudlite-develop`, `kloudlite-verify` and `kloudlite-automate`. They do not repeat the definitions. Read this skill first.

In a request, the words workspace, environment, session, service, intercept, sandbox, volume, snapshot, pipeline, secret and connector mean Kloudlite objects. "Delete all workspaces" means: list the Kloudlite workspaces with `workspace_list`, then obey "Safety rules".

## Components

All work runs in the context of one team: a person's own team or a shared team. A team is not a component. These are the nine components.

1. **Workspace.** A development machine in the cloud. It has a home (`/home/kl`) that is kept while it is stopped, source code in `~/workspace`, packages from nixpkgs, a tool server for programs and SSH for terminals. It is standalone, or managed: created in a session, which starts, stops and deletes it. Only a managed workspace reaches an environment. A clone or a restore is a new standalone workspace.
2. **Environment.** A set of services that run together, each from a container image, for example an API, a database and a cache. Each service is reachable by its name on its ports, for example `postgres://db:5432`. One disk holds the data of the services that mount a folder. Many sessions can connect to one environment.
3. **Session.** A network group. It joins a set of workspaces and sandboxes to one environment, or to none. Its workspaces reach the services of that environment by name. A session belongs to the person who created it. Other members work in their own sessions on the same environment.
4. **Intercept.** Sends all traffic of one environment service to a workspace of the session. The service pauses, and the code in the workspace answers its callers. Callers keep the same name and port. An intercept is for the whole environment: every caller of the service reaches the workspace.
5. **Sandbox.** A short-lived, isolated machine that runs one command and ends when the command exits. Its files are gone when it ends, and it cannot start again. A sandbox created in a session reaches the session's environment.
6. **Volume.** The saved storage of one workspace or one environment: its disk and the chain of snapshots taken of it. A snapshot is a read-only copy of the disk at one time. A named volume numbers its snapshots: `name@1`, `name@2`. A reference is `name` (the newest version), `name@N`, or a snapshot id.
7. **Pipeline.** A versioned JSON definition of jobs. Each job runs its steps in its own sandbox. A run starts one version by hand, on a schedule, from a webhook call, or after another pipeline ends.
8. **Secrets and variables.** A variable is a `NAME=value` pair in the `env` of a workspace, service, sandbox or job. A secret is a named value of an owner. A variable refers to it with the whole value `${{ secrets.NAME }}`. Nobody can read a secret value back.
9. **Connector.** A link from an owner to a code host (GitHub, GitLab) or to a container registry. A git connector gives read-only `git clone` over HTTPS to workspaces, sandboxes and pipeline jobs. A registry connector gives image pushes and private image pulls. The user connects a provider in the web console.

How they relate:

```
team ─┬─ session ── joins ──> workspaces, sandboxes ──> environment (0 or 1)
      │                         intercept: environment service ──> workspace of the session
      ├─ environment ── services (image, ports, env, mounts)
      ├─ volume ── snapshots, name@N <── workspace, environment, pipeline job (saveTo, fromSnapshot)
      ├─ pipeline ── versions ── runs ── jobs (one sandbox each)
      ├─ secrets ──> env of a workspace, service, sandbox or job
      └─ connectors ──> git clone (workspace, sandbox, job); image push and pull
```

## Ids and names

| Object | Id starts with |
|---|---|
| Workspace | `ws-` |
| Environment | `env-` |
| Session | `ses-` |
| Sandbox | `sbx-` |

1. Get the id from `workspace_list`, `env_list` or `session_current`.
2. Give the id in the `workspace` or `env` argument of a tool. A name does not work there.
3. Use the name when you write to the user.
4. `volume_history`, `volume_refs` and `volume_delete` take the volume `id` from `volume_list`. Restore and clone take a reference in `snapshot_id`.
5. The `kloudlite` command takes a name, `team/name`, or an id.

## Tools

The tools come from `kloudlite mcp` or the laptop plugin (`mcp__plugin_kloudlite_kl__<name>`). They act on one session. A tool that starts work returns at once: poll `workspace_get` until `state` is `ready`, and call `env_wait` for an environment.

| Group | Tools |
|---|---|
| Session | `session_current`, `session_use`, `session_connect`, `session_disconnect` |
| Workspaces | `workspace_list`, `workspace_get`, `workspace_create`, `workspace_clone`, `workspace_restore`, `workspace_start`, `workspace_stop`, `workspace_delete`, `workspace_snapshot`, `worktree_add`, `worktree_drop` |
| Code | `read`, `write`, `edit`, `patch`, `glob`, `grep` |
| Run | `exec`, `process_list`, `process_output`, `process_write`, `process_kill`, `watch`, `watch_poll`, `watch_stop` |
| Packages | `packages_list`, `packages_add`, `packages_remove`, `packages_update` |
| Images | `container_build`, `container_push`, `builder_status` |
| Environments | `env_list`, `env_get`, `env_wait`, `env_create`, `env_clone`, `env_start`, `env_stop`, `env_delete`, `env_snapshot`, `env_restore`, `service_add`, `service_update`, `service_remove`, `service_logs` |
| Intercepts | `intercept`, `release` |
| Volumes | `volume_list`, `volume_history`, `volume_refs`, `volume_delete`, `snapshot_delete` |
| Account | `quota`, `regions`, `requests_list`, `request_get`, `request_create` |
| Web | `web_fetch`, `web_search` |

Every code, run, package and image tool takes `workspace`, the id of a `ready` workspace. With several sessions and none picked, the server lists only `session_pick`: ask the user which session, then call it.

These components have no tool. Use the `kloudlite` command on the user's computer, with `--json` for output that you parse:

| Component | Commands |
|---|---|
| Sandbox | `kloudlite sessions create-sandbox`, `kloudlite sandboxes get`, `logs`, `wait`, `list`, `terminate`, `delete` |
| Pipeline | `kloudlite pipelines create`, `update`, `get`, `versions`, `run`, `runs`, `get-run`, `logs`, `wait-run`, `cancel-run`, `rotate-webhook`, `delete` |
| Secret | `kloudlite secrets set`, `list`, `delete` |
| Connector | `kloudlite connectors list`, `remove` |
| Session lifecycle | `kloudlite sessions create`, `stop`, `start`, `delete` |
| Restart for new variables | `kloudlite workspaces restart`, `kloudlite environments restart --service NAME` |

If the host refuses local commands (the laptop plugin in kl mode answers `kl mode: use the kl tools; nothing runs on this laptop`), do not go around it. Tell the user to type `/kloudlite:off`, or give the exact command for the user to run.

## States

| Object | States | Up when |
|---|---|---|
| Workspace | `creating`, `ready`, `stopped`, `error`, `deleted` | `ready` |
| Environment | `creating`, `running`, `stopped`, `error`, `deleted` | `running`, and every service ready (`env_wait`) |
| Session | `running`, `starting`, `idle`, `stopped` | `running` |
| Sandbox (`phase`) | `pending`, `starting`, `running`, `terminated` | `terminated` with `reason` `Exited`: `exit_code` is the result |

Stop a poll at `error` or `deleted`: that state does not change to the one you want. An environment service with `failing: true` does not come up by waiting: read its `message`, fix the cause, and change the service again.

Idle stop: after 30 minutes without use, a session goes `idle` and its workspaces stop. A start of a workspace, a create in the session, or a connect of an environment wakes the session again. An object that the user stopped stays stopped.

## Services

**Packages are tools. Services belong in the environment.**

- Packages give the tools to develop: compilers, runtimes, test tools, CLIs. Examples: `go`, `nodejs`, `python3`, `rustc`, `postgresql` for the `psql` client.
- Never install, download or run a server (MongoDB, PostgreSQL, Redis, Kafka, RabbitMQ, Elasticsearch, MinIO) in a workspace. Add it to the environment with `service_add` and its public image.
- A package entry is `attr` or `attr@version` (`latest`, `N`, `N.N`, `N.N.N`). A version that is not in the cache answers `422` with the versions that are.

**Service data.** A service without `mounts` loses what it writes on each restart. Before each `service_add` or `service_update`:

1. Find what the service writes and must keep: records, uploads, queues, indexes. Read the image documentation or its Dockerfile `VOLUME` lines.
2. Give each such directory a mount in the same call: `{"folder": "mongo-data", "path": "/data/db"}`. Data written before a mount is lost.
3. A service that keeps all its data in another service needs no mount. Say so in your answer.

Example service: `{"name": "mongodb", "image": "mongo:7", "ports": [27017], "mounts": [{"folder": "mongo-data", "path": "/data/db"}]}`.

**Service images.** For standard software, use a public image. For code that the user owns, run the code in a workspace and intercept the service. Build an image with `container_build` only when the user asks to publish one.

## Safety rules

1. **Destructive actions.** A delete (`workspace_delete`, `env_delete`, `service_remove`, `volume_delete`, `snapshot_delete`, `worktree_drop`, `kloudlite ... delete`), an `env_restore`, and a stop of something the user did not name need an explicit request that names the targets. List the targets by name. If the user did not name them in this turn, ask in one line first. If the host shows its own confirmation, that is the confirmation.
2. **Snapshots only when asked.** Take a snapshot only when the user asks. The platform already keeps the data safe after a crash.
3. **No secret values in output.** Never print, echo, log or repeat a secret value. Pass a value to `kloudlite secrets set` on stdin only. Refer to secrets by name.
4. **Packages are tools, services are in the environment.** See "Services".
5. **Refused calls.** If the user refuses a call or a confirmation, that is the answer. Do not try again. Do not get the same result in another way.
6. **No backdoors.** If a call fails, tell the user the error as it is. Do not go around it through another workspace, session or tool.
7. **Limits.** A `409` that names a limit (`workspaces: 5 of 5 in use; request more under Quota`) does not pass on a retry. Tell the user. Offer `request_create` (`kind`: `quota`, `access`, `region` or `other`, with `reason`) only when the user asks for it.
8. **Shared environment.** Intercept the shared team environment. Make a copy of an environment only for a task that needs one (see `kloudlite-develop`). Release each intercept when the work is done.
9. **Short answers.** Give the result first. Do not repeat tool output.

## Setup

Kloudlite is not available when you have no Kloudlite tool: no `session_current` or `workspace_list` tool, by any prefix (`mcp__kl__`, `mcp__plugin_kloudlite_kl__`). Then do not guess and do not call an API. Tell the user these steps. Do not run an installer or a login yourself unless the user tells you to.

1. Install `kloudlite` (macOS and Linux; on Windows, use WSL):

   ```sh
   curl -fsSL https://dev.kloudlite.io/install.sh | sh
   ```

2. Sign in. The command opens the browser.

   ```sh
   kloudlite login
   ```

3. Connect the agent. Use one of these:
   - Claude Code with the plugin, which adds the tools, the skills and kl mode. `-t` is the team and `-s` the session; leave out `-t` for your own team:

     ```sh
     kloudlite claude -t TEAM -s SESSION
     ```

   - Any MCP client, with `kloudlite mcp` as a stdio server. For Claude Code without the plugin:

     ```sh
     claude mcp add kl -- kloudlite mcp
     ```

     A client with a JSON settings file takes `{"mcpServers": {"kl": {"command": "kloudlite", "args": ["mcp"]}}}`. For another team or session, use `["mcp", "TEAM", "--session", "SESSION"]`.

4. Pick or create a session. `kloudlite sessions use NAME` picks one; `kloudlite sessions use --new-environment NAME` creates an environment and a session on it. With no session at all, `kloudlite mcp` creates the session `main`.
5. Restart the client. The client then lists the server `kl` and its tools.

After setup, call `session_current` and check that it names the session that the user expects. If it does not, call `session_use` with `name` (and `team` for a team session).

If a tool answers ``not logged in — run `kloudlite login` ``, tell the user to run `kloudlite login` and restart the client. A `403` with `your access to TEAM is paused` needs a team admin.
