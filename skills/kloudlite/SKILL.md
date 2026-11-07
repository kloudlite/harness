---
name: kloudlite
description: Gives the Kloudlite definitions, the rules for picking and building workspaces, environments and sessions, the tool groups, the safety rules and the setup steps. Load first when the Kloudlite tools are present (`session`, `workspace`) and the task is to run, test, build or change code; when a request names a workspace, environment, session, intercept, capsule, volume, snapshot, pipeline, secret, variable or connector; for status, logs, stop, start, delete and quota questions ("what do I have", "logs of db", "delete the review workspace"); and when a tool answers "not logged in", "403 ... paused", or the server lists only the `session` tool. Not for steps of a task - use kloudlite-develop (set up, run against real services, intercept), kloudlite-verify (one-time checks in capsules) or kloudlite-automate (pipelines).
---

# Kloudlite

This skill gives the definitions and the rules. The task skills give the steps: `kloudlite-develop`, `kloudlite-verify`, `kloudlite-automate`. They do not repeat the definitions. Read this skill first.

The words workspace, environment, session, service, intercept, capsule, volume, snapshot, pipeline, secret and connector mean Kloudlite objects. When the Kloudlite tools are present, code runs in a workspace, not on the user's computer, whatever the request says.

## Components

All work runs in the context of one team: a person's own team or a shared team. A team is not a component. Nine components:

1. **Workspace.** A development machine in the cloud: a home kept while stopped, source in `~/workspace`, packages from nixpkgs, a tool server for programs, SSH for terminals. Standalone, or managed by a session.
2. **Environment.** A set of services that run together, each from a container image, reachable by name and port (`db:5432`). One disk holds the data of mounted folders.
3. **Session.** A network group that joins workspaces and capsules to one environment, or none. Private to its creator; teammates use their own sessions on the same environment.
4. **Intercept.** Sends all traffic of one environment service to a workspace of the session; the service pauses; callers keep the same name and port. Environment-wide.
5. **Capsule.** A disposable isolated container that runs one command or one shell and ends when it exits. In a session it reaches the environment. Files are gone at the end.
6. **Volume.** The saved storage of one workspace or environment: its disk and the chain of snapshots. A named volume numbers its snapshots `name@N`. A reference is `name` (newest), `name@N`, or a snapshot id.
7. **Pipeline.** A versioned JSON definition of jobs; each job runs its steps in its own capsule; a run starts one version by hand, on a schedule, from a webhook, or after another pipeline.
8. **Secrets and variables.** A variable is `NAME=value` in the `env` of a workspace, service, capsule or job. A secret is a named value of an owner; a variable refers to it as the whole value `${{ secrets.NAME }}`. No one reads a value back.
9. **Connector.** A link from an owner to a code host (GitHub, GitLab) or a container registry: read-only clone over HTTPS; image push and private pull. Connected in the web console.

Three facts decide every topology choice:

1. **Managed vs standalone.** A workspace created in a session is managed: it reaches the environment, and the session starts, stops and deletes it. A standalone workspace never joins a session. `workspace` with `action: "create"` and a `source`, and `action: "restore"`, make standalone workspaces.
2. **A capsule ends.** It is for one command; nothing in it survives. A capsule in a session is a managed member and reaches the environment.
3. **An intercept is environment-wide.** Every caller of the service, every teammate's session included, reaches the workspace. One workspace per service.

```
team ─┬─ session ── joins ──> workspaces, capsules ──> environment (0 or 1)
      │                         intercept: service ──> workspace of the session
      ├─ environment ── services (image, ports, env, mounts)
      ├─ volume ── snapshots, name@N <── workspace, environment, job (saveTo, fromSnapshot)
      ├─ pipeline ── versions ── runs ── jobs (one capsule each)
      ├─ secrets ──> env of a workspace, service, capsule or job
      └─ connectors ──> git clone; image push and pull
```

## Hosts

Read your row. The task skills never name a host.

| Host | Tools | Local commands | Local files | Who works |
|---|---|---|---|---|
| Claude Code with the plugin (remote server) | `mcp__plugin_kloudlite_kl__*`, without `web_fetch`, `web_search` and `scratch_*` | yes | yes | the one agent |
| MCP client with `kloudlite mcp` | server `kl`, all scopes in one list | only with a shell tool | only with file tools | the one agent |
| Remote connector (claude.ai, ChatGPT) | `/mcp` over OAuth | no | no | the one agent |
| Kloudlite runtime (shared) | split by role: main, workspace, subagent | no | no | the role skills |

`session` with `action: "use"` exists on the laptop door (`kloudlite mcp`, which also takes `action: "pick"`) and on the remote server (the plugin and a remote connector), where it picks among your sessions in the teams you connected (`team` moves between them). Only the harness drives one fixed session and cannot switch; `workspace` with `action: "create"` always uses the current session. In the harness, a task that needs another session is for the user to open.

Use a tool, not a command. Two things have no tool: connecting a provider (the web console) and `kloudlite env`, the tunnel to the laptop. For those, give the user the exact command, or run it only on a host with a shell.

## How to work

1. **Orient first.** Call `session` with `action: "current"`, `workspace` with `action: "list"` (the owner's workspaces; `thisSession` marks this session's), then `env` with `action: "get"` of the session's environment. Three calls, every task, before any create. Say in one line what exists.
1b. **Scope is this session.** The tools reach everything of the owner; a task is about this session's workspaces and environment unless the person names another object. Act outside the session only on an explicit name or id; when a request would touch something outside and the person did not name it, say what you found and ask before acting.
2. **Reuse before create.** A workspace that holds the repo, an environment that runs the app, a session on it: reuse them. Create only what is missing, and name it in the answer ("created workspace `api` and environment `shop-dev`"). Never a second object for the same job.
3. **Derive the set-up from the repository.** Read `docker-compose.yml`, `.env.example`, `README`, `Procfile`, `package.json`, `go.mod`, `pyproject.toml`, `Cargo.toml`: they give services, ports, variables and packages. Ask the user only what the repo does not say (which registry, which environment to share).
4. **Names.** Workspace: the repo or component (`api`, `web`). Environment: the app and purpose (`shop-dev`, `shop-pr-42`). Session: the piece of work (`orders`, `review-42`). Lowercase, hyphens, unique per owner.
5. **Pick the shape** (below). Decide the topology before the first create, say it in one line, then build it.
6. **Create what the task needs; tear down what you created.** Clones, environment copies, capsules, review workspaces and intercepts made for a task go at the end of the task. Objects the user had stay. The answer lists both.
7. **Wait with `wait: true`.** Create, start, restore and `run` start take `wait: true` and answer when the object has settled, or at `soft_ms` (default 25000) with `{promoted: true, id, kind}`: call the `wait` action of the `kind` tool (`session`: `get`). `exec` and `container_build` promote with `kind: "process"`: loop `process` `wait` with `since`/`since_err` from `next`/`next_err`. A `wait` action takes `timeout_ms` and answers `timed_out: true` at the limit: call it again. A `failing` service needs its `message` and a fix, not more waiting.
8. **Packages are tools; services belong in the environment.** No database, queue or broker in a workspace. `references/services.md` gives image, ports and mounts.
9. **Service data.** A service that writes data gets a mount in the same call that creates it. A service without `mounts` loses its data on each restart, and data written before a mount is lost. Example: `{"name": "db", "image": "postgres:16", "ports": [5432], "mounts": [{"folder": "pg-data", "path": "/var/lib/postgresql/data"}]}`. A service that keeps all its data in another service needs none: say so.
10. **Processes.** Run a dev server detached (`exec` with `detach: true`). Read it with `process` and `action: "output"`. Confirm it listens on its port before an intercept. `process` with `action: "kill"` stops it when done. At most 32 processes. A plain `exec` still running after 25 s is promoted: it answers `promoted: true` and an `id`; call `process` with `action: "wait"` and that `id` until `state` is `exited`. `exec` takes `notify`: `never`, `on_failure` (default) or `always`. Call `status` once at the start of each turn: it lists the notices a client did not show, and the running processes. `status` also lists the session's workspaces with their running processes. A process that crashes, a workspace restart, stop or error and a change of the environment's state arrive as a `notices:` second content item after the answer of a later tool call, a crash with its last stderr lines, so do not poll for them. Only a detached or promoted `exec` reports; `kill` silences it. An exited process is never restarted; a detached one killed by a workspace stop is relaunched, output opening `[restarted <time>: <reason>]`, unless the exec passed `relaunch: false`; each `restarts` entry names `reason` and `by`, and `workspace` `restart` answers the new entry as `restart`; `by: agent` marks a restart you asked for and `relaunch` the processes a restart brought back. `process` states: `running`, `exited`, `gone`, `killed_by_restart` (the workspace restarted; run it again).
11. **Intercept etiquette.** In a shared environment, intercept; do not copy. Agree who intercepts what. Stop it when done. Copy the environment only for data changes, risky migrations or experiments (shape 4).
12. **Secrets.** Never print a secret value. Set it with `secret_set` (you can set, list and delete secrets; a value is never read back), never in a command line or a chat message, and never echo what the user typed. Refer by name. A rotation marks the readers; the restart is the user's choice.
13. **Quota and errors.** A `409` that names a limit does not pass on a retry: tell the user, and offer `request_create` only when asked. Report every error as it is. Never go around it through another object, session or tool. `references/errors.md` gives the action for each.
14. **Destructive actions** need an explicit request that names the targets. List the targets by name first. A refusal is final.
15. **Answer shape.** Result first, then the objects created and removed, then the next step. Never a dump of tool output.

## Pick the shape

The example app in every skill: a shop with `web`, `api`, `worker`, `db` (Postgres) and `cache` (Redis).

| Shape | Use when | Build |
|---|---|---|
| 1. One standalone workspace | A library, CLI, script, or a fix that needs no running service | `workspace` `create` with packages from the repo; clone through the connector |
| 2. One managed workspace, session, environment | One component that needs real services | `env` `create` with the services (or reuse); a session on it; `workspace` `create` in the session |
| 3. One managed workspace per component, one session | A change across `web`, `api` and `worker` | One environment with every service; one session; a workspace per component; each intercepts its own service |
| 4. Copies | Risky data changes, experiments, PR review in a shared environment | `env` `create` with `source` for the environment; `workspace` `create` with `source` for a disposable standalone copy; `worktree` `add` for a second branch in one workspace |

Ask in order. Does the work need a running service? No: shape 1. How many components change? One: shape 2; several: shape 3. Would it disturb a shared environment, or try several options? Yes: shape 4. Is it a one-time check? Use a capsule, not a workspace (`kloudlite-verify`).

Parallel work: only a managed workspace reaches the environment, and a clone is standalone. So "two features at once against the services" is two managed workspaces in the session (each clones the repo) or two worktrees in one managed workspace. A clone keeps or explores a machine's state without services.

## Ids and states

| Object | Id starts with | States |
|---|---|---|
| Workspace | `ws-` | `creating`, `ready`, `stopped`, `error`, `deleted` |
| Environment | `env-` | `creating`, `running`, `stopped`, `error`, `deleted` |
| Session | `ses-` | `running`, `starting`, `idle`, `stopped` |
| Capsule | `cap-` | `phase`: `pending`, `starting`, `running`, `terminated`; with `reason` `Exited`, `exit_code` is the result |

Get ids from the `list` actions of `workspace` and `env`, or from `session` `current`. Tools take the id or the name; write the name to the user. `volume` `get` and `delete` take the volume `id` from `volume` `list`. Restore takes a reference in `snapshot_id`; create takes one in `source`.

A session goes `idle` after 30 minutes without use, and its workspaces stop. A start, a create in the session, or a connect wakes it. What the user stopped stays stopped. After a wake, the next tool answer reports each workspace restart and stop that happened while idle.

## Tools

The tools act on one session. Most tools are one per resource: `action` picks the verb. Every code, run, package and image tool takes `workspace`, the id of a `ready` workspace. `references/tools.md` lists every tool with its actions and arguments.

| Group | Tools | Actions |
|---|---|---|
| Session | `session` | `session`: `current`, `list`, `create`, `use`, `pick` on the laptop door, `start`, `stop`, `delete`, `ttl` |
| Workspaces | `workspace`, `workspace_vars`, `worktree` | `workspace`: `list`, `get`, `create`, `restore`, `start`, `stop`, `restart`, `delete`, `wait`, `ttl`, `snapshot`; `workspace_vars`: `get`, `set`; `worktree`: `add`, `drop` |
| Code | `read`, `write`, `edit`, `glob`, `grep` | none |
| Run | `exec`, `process`, `watch` | `process`: `list`, `output`, `wait`, `write`, `close_stdin`, `kill`; `watch`: `start`, `poll`, `stop` |
| Packages | `packages` | `packages`: `list`, `add`, `remove`, `update` |
| Images | `container_build`, `container_push` | none |
| Environments | `env`, `service` | `env`: `list`, `get`, `create`, `start`, `stop`, `delete`, `wait`, `ttl`, `snapshot`, `restore`; `service`: `add`, `update`, `remove`, `logs` |
| Intercepts | `intercept` | none |
| Volumes | `volume`, `snapshot` | `volume`: `list`, `get`, `delete`; `snapshot`: `delete` |
| Account | `quota`, `regions`, `requests_list`, `request_get`, `request_create` | none |
| Capsules | `capsule` | `capsule`: `create`, `get`, `list`, `wait`, `logs`, `delete` |
| Pipelines | `pipeline`, `run`, `webhook_rotate` | `pipeline`: `list`, `get`, `save`, `delete`; `run`: `start`, `list`, `get`, `wait`, `logs`, `cancel` |
| Secrets and connectors | `secret_set`, `secret_list`, `secret_delete`, `connector_list` | none |
| Web | `web_fetch`, `web_search` | none |

With several sessions and none picked, the server lists only `session`: ask the user which, call it with `action: "pick"` and the `id`, continue.

## Reads, lifecycle and deletes

These need no scenario.

- **What do I have:** the three orient calls, plus `env` with `action: "list"`.
- **Status:** `workspace` or `env` with `action: "get"` or `"wait"`. Intercepts in force: `env` `get`, `services[].interceptedBy`.
- **Logs of a service:** `service` with `action: "logs"`, `name`, and `tail`, `since`, `previous` (after a crash). It names the workspace when an intercept holds the service.
- **Start and stop:** `workspace` and `env` with `action: "start"` or `"stop"`. A stop of something the user did not name needs a name first. `session` `stop` also stops the bench, which serves your own tools: say so first and make it your last call.
- **Delete:** safety rule 1, then the `delete` action of `workspace`, `env`, `volume` or `snapshot`.
- **Quota:** `quota` shows the ceilings and the use. A raise is `request_create` (`kind`: `quota`, `access`, `region` or `other`, with `reason`), only when the user asks.

## Safety rules

1. **Destructive actions.** The `delete` action of any tool, `service` `remove`, `worktree` `drop`, `env` `restore`, any delete of a capsule, pipeline (or a version) or secret, `run` `cancel`, `session` `stop`, and a stop of something the user did not name need a request that names the targets. List them by name. If the user did not name them in this turn, ask in one line first. A host confirmation counts as the confirmation.
2. **Snapshots only when asked.** The platform already keeps data safe after a crash.
3. **No secret values in output.** Never print, echo, log or repeat one.
4. **Refused calls.** If the user refuses a call, that is the answer. Do not retry or get the same result another way.
5. **No backdoors.** If a call fails, tell the user the error. Do not go around it.
6. **Limits.** See "How to work", rule 13.
7. **Shared environment.** Intercept it, stop the intercept when done, copy only for a task that needs one.
8. **Short answers.** Result first. Do not repeat tool output.

## Tie-breakers

| Phrase | Skill | Rule |
|---|---|---|
| "run the tests", "check it works", "try it" | `kloudlite-verify` | Once, now, isolated, a result to read |
| "run the tests every night / on every push / after the build" | `kloudlite-automate` | Repeats without a person |
| "run my server", "hit it with real traffic", "fix the bug" | `kloudlite-develop` | Edits code or keeps a process running |
| "why did it fail" | verify for a capsule, automate for a pipeline run | Which record it is |
| "set up", "give me a workspace with Postgres" | `kloudlite-develop` | Creates the shape |
| "what do I have", "status of X", "logs of db", "delete X", "stop my session" | this skill alone | Reads, lifecycle and deletes need no scenario |
| A change, then "and check it" | develop, then verify | Every develop scenario ends with "to check the result, use `kloudlite-verify`" |

## Setup and recovery

Act on the symptom you see.

| Symptom | What to do |
|---|---|
| No Kloudlite tool at all (no `session` or `workspace` under any prefix) | Do not guess and do not call an API. Tell the user the five steps below. Never run the installer or the login yourself unless told. |
| A tool answers ``not logged in — run `kloudlite login` `` | Tell the user that command, then to restart the client. |
| The server lists only `session` | Ask which session, call `session` with `action: "pick"`, continue. |
| `403 your access to TEAM is paused` | A team admin must restore access. Stop. |

The five steps:

1. Install `kloudlite` (macOS, Linux; WSL on Windows): `curl -fsSL https://dev.kloudlite.io/install.sh | sh`
2. Sign in (opens the browser): `kloudlite login`
3. Connect the agent. Claude Code with the plugin (tools and skills; needs no `kloudlite` binary): `/plugin marketplace add kloudlite/harness`, then `/plugin install kloudlite@kloudlite`; the first tool call opens the browser sign-in, and the consent page picks the teams; the agent picks or creates the session. Another MCP client: `claude mcp add kl -- kloudlite mcp`, or the JSON `{"mcpServers": {"kl": {"command": "kloudlite", "args": ["mcp"]}}}`; for another team or session, `["mcp", "TEAM", "--session", "SESSION"]`. A client that cannot start a program uses the remote URL `https://dev.kloudlite.io/mcp` with OAuth.
4. Pick or create a session: `kloudlite sessions use NAME`, or `kloudlite sessions use --new-environment NAME`. With no session, `kloudlite mcp` creates `main`.
5. Restart the client. It then lists the server `kl`.

After setup, `session` with `action: "current"` must name the session the user expects. If not, call `session` with `action: "use"` and `name` (and `team` for a team session).
