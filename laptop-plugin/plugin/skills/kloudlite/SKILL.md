---
name: kloudlite
description: Gives the Kloudlite definitions, the rules for picking and building workspaces, environments and sessions, the tool groups, the safety rules and the setup steps. Load first when the Kloudlite tools are present (session_current, workspace_list) and the task is to run, test, build or change code; when a request names a workspace, environment, session, intercept, sandbox, volume, snapshot, pipeline, secret, variable or connector; for status, logs, stop, start, delete and quota questions ("what do I have", "logs of db", "delete the review workspace"); and when a tool answers "not logged in", "403 ... paused", or the server lists only session_pick. Not for steps of a task - use kloudlite-develop (set up, run against real services, intercept), kloudlite-verify (one-time checks in sandboxes) or kloudlite-automate (pipelines).
---

# Kloudlite

This skill gives the definitions and the rules. The task skills give the steps: `kloudlite-develop`, `kloudlite-verify`, `kloudlite-automate`. They do not repeat the definitions. Read this skill first.

The words workspace, environment, session, service, intercept, sandbox, volume, snapshot, pipeline, secret and connector mean Kloudlite objects. When the Kloudlite tools are present, code runs in a workspace, not on the user's computer, whatever the request says.

## Components

All work runs in the context of one team: a person's own team or a shared team. A team is not a component. Nine components:

1. **Workspace.** A development machine in the cloud: a home kept while stopped, source in `~/workspace`, packages from nixpkgs, a tool server for programs, SSH for terminals. Standalone, or managed by a session.
2. **Environment.** A set of services that run together, each from a container image, reachable by name and port (`db:5432`). One disk holds the data of mounted folders.
3. **Session.** A network group that joins workspaces and sandboxes to one environment, or none. Private to its creator; teammates use their own sessions on the same environment.
4. **Intercept.** Sends all traffic of one environment service to a workspace of the session; the service pauses; callers keep the same name and port. Environment-wide.
5. **Sandbox.** A short-lived isolated machine that runs one command and ends when it exits. In a session it reaches the environment. Files are gone at the end.
6. **Volume.** The saved storage of one workspace or environment: its disk and the chain of snapshots. A named volume numbers its snapshots `name@N`. A reference is `name` (newest), `name@N`, or a snapshot id.
7. **Pipeline.** A versioned JSON definition of jobs; each job runs its steps in its own sandbox; a run starts one version by hand, on a schedule, from a webhook, or after another pipeline.
8. **Secrets and variables.** A variable is `NAME=value` in the `env` of a workspace, service, sandbox or job. A secret is a named value of an owner; a variable refers to it as the whole value `${{ secrets.NAME }}`. No one reads a value back.
9. **Connector.** A link from an owner to a code host (GitHub, GitLab) or a container registry: read-only clone over HTTPS; image push and private pull. Connected in the web console.

Three facts decide every topology choice:

1. **Managed vs standalone.** A workspace created in a session is managed: it reaches the environment, and the session starts, stops and deletes it. A standalone workspace never joins a session. `workspace_clone` and `workspace_restore` make standalone workspaces.
2. **A sandbox ends.** It is for one command; nothing in it survives. A sandbox in a session is a managed member and reaches the environment.
3. **An intercept is environment-wide.** Every caller of the service, every teammate's session included, reaches the workspace. One workspace per service.

```
team ─┬─ session ── joins ──> workspaces, sandboxes ──> environment (0 or 1)
      │                         intercept: service ──> workspace of the session
      ├─ environment ── services (image, ports, env, mounts)
      ├─ volume ── snapshots, name@N <── workspace, environment, job (saveTo, fromSnapshot)
      ├─ pipeline ── versions ── runs ── jobs (one sandbox each)
      ├─ secrets ──> env of a workspace, service, sandbox or job
      └─ connectors ──> git clone; image push and pull
```

## Hosts

Read your row. The task skills never name a host.

| Host | Tools | Local commands | Local files | Who works |
|---|---|---|---|---|
| Claude Code with the plugin | `mcp__plugin_kloudlite_kl__*` | yes | yes | the one agent |
| MCP client with `kloudlite mcp` | server `kl`, all scopes in one list | only with a shell tool | only with file tools | the one agent |
| Remote connector (claude.ai, ChatGPT) | `/mcp` over OAuth | no | no | the one agent |
| Kloudlite harness | split by role: main, workspace, subagent | no | no | the role skills |

`session_use` exists only on the laptop door (`kloudlite mcp` and the plugin). The harness and the remote connector drive their own session and have no way to switch; `workspace_create` always uses it. There, a task that needs another session is for the user to open.

Use a tool, not a command. Two things have no tool: connecting a provider (the web console) and `kloudlite env`, the tunnel to the laptop. For those, give the user the exact command, or run it only on a host with a shell.

## How to work

1. **Orient first.** Call `session_current`, `workspace_list`, then `env_get` of the session's environment. Three calls, every task, before any create. Say in one line what exists.
2. **Reuse before create.** A workspace that holds the repo, an environment that runs the app, a session on it: reuse them. Create only what is missing, and name it in the answer ("created workspace `api` and environment `shop-dev`"). Never a second object for the same job.
3. **Derive the set-up from the repository.** Read `docker-compose.yml`, `.env.example`, `README`, `Procfile`, `package.json`, `go.mod`, `pyproject.toml`, `Cargo.toml`: they give services, ports, variables and packages. Ask the user only what the repo does not say (which registry, which environment to share).
4. **Names.** Workspace: the repo or component (`api`, `web`). Environment: the app and purpose (`shop-dev`, `shop-pr-42`). Session: the piece of work (`orders`, `review-42`). Lowercase, hyphens, unique per owner.
5. **Pick the shape** (below). Decide the topology before the first create, say it in one line, then build it.
6. **Create what the task needs; tear down what you created.** Clones, environment copies, sandboxes, review workspaces and intercepts made for a task go at the end of the task. Objects the user had stay. The answer lists both.
7. **Lifecycle calls return at once.** Poll `workspace_get` until `ready` or `stopped`; call `env_wait` for an environment. Stop at `error` or `deleted`. A `failing` service needs its `message` and a fix, not more waiting. Back off: 2 s, 4 s, 8 s, 15 s.
8. **Packages are tools; services belong in the environment.** No database, queue or broker in a workspace. `references/services.md` gives image, ports and mounts.
9. **Service data.** A service that writes data gets a mount in the same call that creates it. A service without `mounts` loses its data on each restart, and data written before a mount is lost. Example: `{"name": "db", "image": "postgres:16", "ports": [5432], "mounts": [{"folder": "pg-data", "path": "/var/lib/postgresql/data"}]}`. A service that keeps all its data in another service needs none: say so.
10. **Processes.** Run a dev server detached (`exec` with `detach: true`). Read it with `process_output`. Confirm it listens on its port before an intercept. `process_kill` it when done. At most 32 processes.
11. **Intercept etiquette.** In a shared environment, intercept; do not copy. Agree who intercepts what. Release when done. Copy the environment only for data changes, risky migrations or experiments (shape 4).
12. **Secrets.** Never print a secret value. Set it with `secret_set`, never in a command line or a chat message, and never echo what the user typed. Refer by name. A rotation marks the readers; the restart is the user's choice.
13. **Quota and errors.** A `409` that names a limit does not pass on a retry: tell the user, and offer `request_create` only when asked. Report every error as it is. Never go around it through another object, session or tool. `references/errors.md` gives the action for each.
14. **Destructive actions** need an explicit request that names the targets. List the targets by name first. A refusal is final.
15. **Answer shape.** Result first, then the objects created and removed, then the next step. Never a dump of tool output.

## Pick the shape

The example app in every skill: a shop with `web`, `api`, `worker`, `db` (Postgres) and `cache` (Redis).

| Shape | Use when | Build |
|---|---|---|
| 1. One standalone workspace | A library, CLI, script, or a fix that needs no running service | `workspace_create` with packages from the repo; clone through the connector |
| 2. One managed workspace, session, environment | One component that needs real services | `env_create` with the services (or reuse); a session on it; `workspace_create` in the session |
| 3. One managed workspace per component, one session | A change across `web`, `api` and `worker` | One environment with every service; one session; a workspace per component; each intercepts its own service |
| 4. Copies | Risky data changes, experiments, PR review in a shared environment | `env_clone` for the environment; `workspace_clone` for a disposable standalone copy; `worktree_add` for a second branch in one workspace |

Ask in order. Does the work need a running service? No: shape 1. How many components change? One: shape 2; several: shape 3. Would it disturb a shared environment, or try several options? Yes: shape 4. Is it a one-time check? Use a sandbox, not a workspace (`kloudlite-verify`).

Parallel work: only a managed workspace reaches the environment, and a clone is standalone. So "two features at once against the services" is two managed workspaces in the session (each clones the repo) or two worktrees in one managed workspace. A clone keeps or explores a machine's state without services.

## Ids and states

| Object | Id starts with | States |
|---|---|---|
| Workspace | `ws-` | `creating`, `ready`, `stopped`, `error`, `deleted` |
| Environment | `env-` | `creating`, `running`, `stopped`, `error`, `deleted` |
| Session | `ses-` | `running`, `starting`, `idle`, `stopped` |
| Sandbox | `sbx-` | `phase`: `pending`, `starting`, `running`, `terminated`; with `reason` `Exited`, `exit_code` is the result |

Get ids from `workspace_list`, `env_list` or `session_current`. Tools take the id, not the name; write the name to the user. `volume_history`, `volume_refs` and `volume_delete` take the volume `id` from `volume_list`. Restore and clone take a reference in `snapshot_id`.

A session goes `idle` after 30 minutes without use, and its workspaces stop. A start, a create in the session, or a connect wakes it. What the user stopped stays stopped.

## Tools

The tools act on one session. Every code, run, package and image tool takes `workspace`, the id of a `ready` workspace. `references/tools.md` lists every tool with its arguments.

| Group | Tools |
|---|---|
| Session | `session_current`, `session_use`, `session_connect`, `session_disconnect`, `session_create`, `session_stop`, `session_start`, `session_delete`, `session_ttl` |
| Workspaces | `workspace_list`, `workspace_get`, `workspace_create`, `workspace_clone`, `workspace_restore`, `workspace_start`, `workspace_stop`, `workspace_delete`, `workspace_snapshot`, `worktree_add`, `worktree_drop`, `workspace_env_get`, `workspace_env_set`, `workspace_restart`, `workspace_ttl` |
| Code | `read`, `write`, `edit`, `patch`, `glob`, `grep` |
| Run | `exec`, `process_list`, `process_output`, `process_write`, `process_kill`, `watch`, `watch_poll`, `watch_stop` |
| Packages | `packages_list`, `packages_add`, `packages_remove`, `packages_update` |
| Images | `container_build`, `container_push`, `builder_status` |
| Environments | `env_list`, `env_get`, `env_wait`, `env_create`, `env_clone`, `env_start`, `env_stop`, `env_delete`, `env_snapshot`, `env_restore`, `service_add`, `service_update`, `service_remove`, `service_logs`, `service_restart`, `env_ttl` |
| Intercepts | `intercept`, `release` |
| Volumes | `volume_list`, `volume_history`, `volume_refs`, `volume_delete`, `snapshot_delete` |
| Account | `quota`, `regions`, `requests_list`, `request_get`, `request_create` |
| Sandboxes | `sandbox_create`, `sandbox_get`, `sandbox_wait`, `sandbox_logs`, `sandbox_list`, `sandbox_terminate`, `sandbox_delete` |
| Pipelines | `pipeline_list`, `pipeline_get`, `pipeline_save`, `pipeline_versions`, `pipeline_version_delete`, `pipeline_delete`, `webhook_rotate`, `run_start`, `run_list`, `run_get`, `run_wait`, `run_logs`, `run_cancel` |
| Secrets and connectors | `secret_set`, `secret_list`, `secret_delete`, `connector_list` |
| Web | `web_fetch`, `web_search` |

With several sessions and none picked, the server lists only `session_pick`: ask the user which, call it, continue.

## Reads, lifecycle and deletes

These need no scenario.

- **What do I have:** the three orient calls, plus `env_list`.
- **Status:** `workspace_get`, `env_get`, `env_wait`. Intercepts in force: `env_get`, `services[].interceptedBy`.
- **Logs of a service:** `service_logs` with `tail`, `since`, `previous` (after a crash). It names the workspace when an intercept holds the service.
- **Start and stop:** `workspace_start`, `workspace_stop`, `env_start`, `env_stop`. A stop of something the user did not name needs a name first. `session_stop` also stops the bench, which serves your own tools: say so first and make it your last call.
- **Delete:** safety rule 1, then `workspace_delete`, `env_delete`, `volume_delete`, `snapshot_delete`.
- **Quota:** `quota` shows the ceilings and the use. A raise is `request_create` (`kind`: `quota`, `access`, `region` or `other`, with `reason`), only when the user asks.

## Safety rules

1. **Destructive actions.** `workspace_delete`, `env_delete`, `service_remove`, `volume_delete`, `snapshot_delete`, `worktree_drop`, `env_restore`, any delete of a sandbox, pipeline (or a version) or secret, `session_delete`, `run_cancel`, `session_stop`, and a stop of something the user did not name need a request that names the targets. List them by name. If the user did not name them in this turn, ask in one line first. A host confirmation counts as the confirmation.
2. **Snapshots only when asked.** The platform already keeps data safe after a crash.
3. **No secret values in output.** Never print, echo, log or repeat one.
4. **Refused calls.** If the user refuses a call, that is the answer. Do not retry or get the same result another way.
5. **No backdoors.** If a call fails, tell the user the error. Do not go around it.
6. **Limits.** See "How to work", rule 13.
7. **Shared environment.** Intercept it, release when done, copy only for a task that needs one.
8. **Short answers.** Result first. Do not repeat tool output.

## Tie-breakers

| Phrase | Skill | Rule |
|---|---|---|
| "run the tests", "check it works", "try it" | `kloudlite-verify` | Once, now, isolated, a result to read |
| "run the tests every night / on every push / after the build" | `kloudlite-automate` | Repeats without a person |
| "run my server", "hit it with real traffic", "fix the bug" | `kloudlite-develop` | Edits code or keeps a process running |
| "why did it fail" | verify for a sandbox, automate for a pipeline run | Which record it is |
| "set up", "give me a workspace with Postgres" | `kloudlite-develop` | Creates the shape |
| "what do I have", "status of X", "logs of db", "delete X", "stop my session" | this skill alone | Reads, lifecycle and deletes need no scenario |
| A change, then "and check it" | develop, then verify | Every develop scenario ends with "to check the result, use `kloudlite-verify`" |

## Setup and recovery

Act on the symptom you see.

| Symptom | What to do |
|---|---|
| No Kloudlite tool at all (no `session_current` or `workspace_list` under any prefix) | Do not guess and do not call an API. Tell the user the five steps below. Never run the installer or the login yourself unless told. |
| A tool answers ``not logged in — run `kloudlite login` `` | Tell the user that command, then to restart the client. |
| The server lists only `session_pick` | Ask which session, call it, continue. |
| `403 your access to TEAM is paused` | A team admin must restore access. Stop. |

The five steps:

1. Install `kloudlite` (macOS, Linux; WSL on Windows): `curl -fsSL https://dev.kloudlite.io/install.sh | sh`
2. Sign in (opens the browser): `kloudlite login`
3. Connect the agent. Claude Code with the plugin (tools, skills, agents): install it from the marketplace, `/plugin marketplace add kloudlite/harness`, then `/plugin install kloudlite@kloudlite`; the session is the one `kloudlite sessions use` selected, or `session_pick`/`session_use`. Another MCP client: `claude mcp add kl -- kloudlite mcp`, or the JSON `{"mcpServers": {"kl": {"command": "kloudlite", "args": ["mcp"]}}}`; for another team or session, `["mcp", "TEAM", "--session", "SESSION"]`. The remote connector uses its URL once it exists.
4. Pick or create a session: `kloudlite sessions use NAME`, or `kloudlite sessions use --new-environment NAME`. With no session, `kloudlite mcp` creates `main`.
5. Restart the client. It then lists the server `kl`.

After setup, `session_current` must name the session the user expects. If not, call `session_use` with `name` (and `team` for a team session).
