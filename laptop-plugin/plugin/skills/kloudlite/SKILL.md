---
name: kloudlite
description: Gives the Kloudlite definitions, the rules for picking and building workspaces, environments and desks, the tool groups, the safety rules and the setup steps. Load first when the Kloudlite tools are present (`desk`, `workspace`) and the task is to run, test, build or change code; when a request names a workspace (or a sandbox), environment, desk, intercept, capsule, volume, snapshot, pipeline, secret, variable or connector; for status, logs, stop, start, delete and quota questions ("what do I have", "logs of db", "delete the review workspace"); and when a tool answers "not logged in", "403 ... paused", or the server lists only the `desk` tool. Not for steps of a task - use kloudlite-develop (set up, run against real services, intercept), kloudlite-verify (one-time checks in capsules) or kloudlite-automate (pipelines).
---

# Kloudlite

This skill gives the definitions and the rules. The task skills give the steps: `kloudlite-develop`, `kloudlite-verify`, `kloudlite-automate`. They do not repeat the definitions. Read this skill first.

The words workspace, environment, desk, service, intercept, capsule, volume, snapshot, pipeline, secret and connector mean Kloudlite objects. When the Kloudlite tools are present, code runs in a workspace, not on the user's computer, whatever the request says.

## Components

All work runs in the context of one team: a person's own team or a shared team. A team is not a component. Nine components:

1. **Workspace.** The sandbox an agent works in: an isolated machine in the cloud with its own kernel, a home kept while stopped, source in `~/workspace`, packages from nixpkgs, a tool server for programs, SSH for terminals. It lives until it is deleted. Standalone, or managed by a desk.
2. **Environment.** A set of services that run together, each from a container image, reachable by name and port (`db:5432`). One disk holds the data of mounted folders.
3. **Desk.** One piece of work: the agent's conversation, the workspaces and capsules it uses, and the environment they reach. Private to its creator; teammates use their own desks on the same environment.
4. **Intercept.** Sends all traffic of one environment service to a workspace of the desk; the service pauses; callers keep the same name and port. Environment-wide.
5. **Capsule.** A disposable sandbox: an isolated container that runs one command or one shell and ends when it exits. In a desk it reaches the environment. Files are gone at the end. It is never where an agent works; that is a workspace.
6. **Volume.** The saved storage of one workspace or environment: its disk and the chain of snapshots. A named volume numbers its snapshots `name@N`. A clone shares its source's volume and history: its snapshots appear there and take the source's volume name. A reference is `name` (newest), `name@N`, or a snapshot id.
7. **Pipeline.** A versioned JSON definition of jobs; each job runs its steps in its own capsule; a run starts one version by hand, on a schedule, from a webhook, or after another pipeline.
8. **Secrets and variables.** A variable is `NAME=value` in the `env` of a workspace, service, capsule or job. A secret is a named value of an owner; a variable refers to it as the whole value `${{ secrets.NAME }}`. No one reads a value back.
9. **Connector.** A link from an owner to a code host (GitHub, GitLab) or a container registry: read-only clone over HTTPS; image push and private pull. Connected in the web console.

**"Sandbox" means a workspace.** Other platforms call the agent's machine a sandbox; in Kloudlite that machine is a workspace. When the user asks for a sandbox, give a workspace, unless they ask for one command or a throwaway run, which is a capsule.

Three facts decide every topology choice:

1. **Managed vs standalone.** A workspace created in a desk is managed: it reaches the environment, and the desk starts, stops and deletes it. A standalone workspace never joins a desk. `workspace` with `action: "create"` and a `source` makes a copy that joins the desk the tool acts for, so it is managed; `action: "restore"` from a desk joins the desk the same way, while a restore or clone made from the laptop CLI (`workspaces clone`, `workspaces restore`, `devices workspaces clone`) is standalone. To clone into a desk from the laptop, use `kloudlite desks clone-workspace WORKSPACE --to NAME` (a device workspace also needs `--snapshot ID`).
2. **A capsule ends.** It is for one command; nothing in it survives. A capsule in a desk is a managed member and reaches the environment.
3. **An intercept is environment-wide.** Every caller of the service, every teammate's desk included, reaches the workspace. One workspace per service.

```
team ─┬─ desk ── joins ──> workspaces, capsules ──> environment (0 or 1)
      │                         intercept: service ──> workspace of the desk
      ├─ environment ── services (image, ports, env, mounts)
      ├─ volume ── snapshots, name@N <── workspace, environment, job (saveTo, fromSnapshot)
      ├─ pipeline ── versions ── runs ── jobs (one capsule each)
      ├─ secrets ──> env of a workspace, service, capsule or job
      └─ connectors ──> git clone; image push and pull
```

## Device workspaces

A device workspace runs on the person's own Mac, in an operating system sandbox, and its folder is an ordinary folder there. `workspace` with `action: "create"` and `device` (an id `dev-…` from the `devices` tool) makes one in the desk. Without `device` the workspace is a cloud one, whatever else the call says.

1. The device must be online and active in the team that owns the desk. If it is offline or active elsewhere, the create is refused with a sentence that says which; the person runs `kloudlite start` or `kloudlite devices connect TEAM`.
2. A device workspace has no ssh. Its tools (`read`, `write`, `exec`) reach it through the gateway. `exec` runs in the sandbox: it writes only the workspace folder, and the network reaches every host except the Kloudlite API and any the person denied (an `allow` list from the person narrows it to that list). It never reaches the Mac itself: loopback, the Mac's other local services and the names `kloudlite` writes into `/etc/hosts` are refused, by address or by name.
3. `workspace` `snapshot` takes a copy-on-write snapshot on the Mac (the workspace restarts while it is made). `create` with `source` and `snapshot` (a `dsnap-…` id) clones it, and the copy joins the desk. `restore` with a `dsnap-…` id as `snapshot_id` makes a new workspace the same way.
4. A device workspace reaches the desk's environment only through `KL_ENV_{SERVICE}_{PORT}` (and `KL_ENV_{SERVICE}` for a service's first port), set to `127.0.0.1:{port}`. Read them with `exec` `env | grep ^KL_ENV` and connect to that address, for any protocol. Names such as `db`, `db.main` or `notes.mac-test` do not resolve in the sandbox, and the proxy refuses them with `403 not in the allowlist`; do not try them, and do not try another workspace's name either. A service added after the workspace started gets its variable after `workspace` `restart`. The forward uses the workspace's own desk, whichever desk the laptop is on. A workspace reaches only the services of its own desk, never another desk's, and never another workspace's forward.
5. `devices` lists the machines with `online`, `enabled` and `account`: pick one that is online and whose `account` is the desk's team. An agent cannot start the Mac's service or connect a device to a team; hand the person the command. A name is unique within its account, and these names are reserved in every account: `ws`, `env`, `api`, `admin`, `system`, `kl`, `bld-…`, and anything that looks like an id.

## Hosts

Read your row. The task skills never name a host.

| Host | Tools | Local commands | Local files | Who works |
|---|---|---|---|---|
| Claude Code with the plugin (remote server) | `mcp__plugin_kloudlite_kl__*`, without `web_fetch`, `web_search` and `scratch_*` | yes | yes | the one agent |
| MCP client with `kloudlite mcp` | server `kl`, all scopes in one list | only with a shell tool | only with file tools | the one agent |
| Remote connector (claude.ai, ChatGPT) | `/mcp` over OAuth | no | no | the one agent |
| Kloudlite runtime (shared) | split by role: main, workspace, subagent | no | no | the role skills |

A call acts in the desk named by its `desk` argument (id or name, on the laptop door and the remote server, the plugin and a remote connector); a door refuses a call without it. `team` names which of the teams you connected. Only the harness drives one fixed desk, which it supplies itself: its agents pass no `desk`, and `workspace` with `action: "create"` always lands in that desk. In the harness, a task that needs another desk is for the user to open.

Use a tool, not a command. Two things have no tool: connecting a provider (the web console) and `kloudlite env`, the tunnel to the laptop. For those, give the user the exact command, or run it only on a host with a shell.

## How to work

1. **Orient first.** Call `desk` with `action: "list"`, `workspace` with `action: "list"` (the owner's workspaces; `thisDesk` marks this desk's), then `env` with `action: "get"` of the desk's environment. Three calls, every task, before any create. Say in one line what exists.
1b. **Scope is this desk.** The tools reach everything of the owner; a task is about this desk's workspaces and environment unless the person names another object. Act outside the desk only on an explicit name or id; when a request would touch something outside and the person did not name it, say what you found and ask before acting.
2. **Reuse before create.** A workspace that holds the repo, an environment that runs the app, a desk on it: reuse them. Create only what is missing, and name it in the answer ("created workspace `api` and environment `shop-dev`"). Never a second object for the same job.
3. **Derive the set-up from the repository.** Read `docker-compose.yml`, `.env.example`, `README`, `Procfile`, `package.json`, `go.mod`, `pyproject.toml`, `Cargo.toml`: they give services, ports, variables and packages. Ask the user only what the repo does not say (which registry, which environment to share).
4. **Names.** Workspace: the repo or component (`api`, `web`). Environment: the app and purpose (`shop-dev`, `shop-pr-42`). Desk: the piece of work (`orders`, `review-42`). Lowercase, hyphens, unique per owner.
5. **Pick the shape** (below). Decide the topology before the first create, say it in one line, then build it.
6. **Create what the task needs; tear down what you created.** Clones, environment copies, capsules, review workspaces and intercepts made for a task go at the end of the task. Objects the user had stay. The answer lists both.
7. **Wait with `wait: true`.** Create, start, restore and `run` start take `wait: true` and answer when the object has settled, or at `soft_ms` (default 5000 on a remote door, which also cuts any wait at 20 s; 25000 in the harness) with `{promoted: true, id, kind, poll_after_ms}`: call the `wait` action of the `kind` tool (`desk`: `get`) after `poll_after_ms`. `exec` and `container_build` promote with `kind: "process"`: loop `process` `wait` with `since`/`since_err` from `next`/`next_err`. A `wait` action takes `timeout_ms` and answers `timed_out: true` at the limit: call it again. A `failing` service needs its `message` and a fix, not more waiting. The loop applies when a `promoted` answer arrives; a client that waits on MCP tasks waits on its own and never sees one.
8. **Packages are tools; services belong in the environment.** No database, queue or broker in a workspace. `references/services.md` gives image, ports and mounts.
9. **Service data.** A service that writes data gets a mount in the same call that creates it. A service without `mounts` loses its data on each restart, and data written before a mount is lost. Example: `{"name": "db", "image": "postgres:16", "ports": [5432], "mounts": [{"folder": "pg-data", "path": "/var/lib/postgresql/data"}]}`. A service that keeps all its data in another service needs none: say so.
10. **Processes.** Run a dev server detached (`exec` with `detach: true`). Read it with `process` and `action: "output"`. Confirm it listens on its port before an intercept. `process` with `action: "kill"` stops it when done. At most 32 processes. A plain `exec` still running past `soft_ms` is promoted: it answers `promoted: true`, an `id` and `poll_after_ms`; after that call `process` with `action: "wait"` and that `id` until `state` is `exited`. `exec` takes `notify`: `never`, `on_failure` (default) or `always`. Call `status` once at the start of each turn: it lists the notices a client did not show, and the running processes. `status` also lists the desk's workspaces with their running processes. A process that crashes, a workspace restart, stop or error and a change of the environment's state arrive as a `notices:` second content item after the answer of a later tool call, a crash with its last stderr lines, so do not poll for them. Only a detached or promoted `exec` reports; `kill` silences it. An exited process is never restarted; a detached one killed by a workspace stop is relaunched, output opening `[restarted <time>: <reason>]`, unless the exec passed `relaunch: false`; each `restarts` entry names `reason` and `by`, and `workspace` `restart` answers the new entry as `restart`; `by: agent` marks a restart you asked for and `relaunch` the processes a restart brought back. `process` states: `running`, `exited`, `gone`, `killed_by_restart` (the workspace restarted; run it again).
11. **Intercept etiquette.** In a shared environment, intercept; do not copy. Agree who intercepts what. Stop it when done. Copy the environment only for data changes, risky migrations or experiments (shape 4).
12. **Secrets.** Never print a secret value. Set it with `secret_set` (you can set, list and delete secrets; a value is never read back), never in a command line or a chat message, and never echo what the user typed. Refer by name. A rotation marks the readers; the restart is the user's choice.
13. **Quota and errors.** A `409` that names a limit does not pass on a retry: tell the user, and offer `request_create` only when asked. A pipeline job refused only by the `capsules`, `cpu` or `memoryGb` quota waits up to 30 minutes (`waiting for quota: …`) instead of failing. Report every error as it is. Never go around it through another object, desk or tool. `references/errors.md` gives the action for each.
14. **Destructive actions** need an explicit request that names the targets. Over MCP no card asks for you: ask the person in text, naming the targets, and call only after a yes. List the targets by name first. A refusal is final.
15. **Answer shape.** Result first, then the objects created and removed, then the next step. Never a dump of tool output.
16. **Argument errors.** A call with an argument the action does not take is refused with `unknown argument` and the list the action takes. Read the list, fix the call, and call once more. Do not retry the same call, and do not drop the argument and carry on: the object you get would not be the one you asked for.
17. **No probe objects.** Do not create a workspace, environment or capsule only to learn what a tool does, and do not delete what the user made. This skill says what each tool does; if it does not say, ask.
18. **Do not search for a shell on the person's machine.** You have no ssh to a device workspace and no shell on the person's Mac. Work in the workspace with `exec`, `read`, `write`, `edit` and the other tools; they are all it exposes. Anything that needs the Mac itself (`kloudlite login`, `start`, `devices …`) is a command to hand to the person, exactly written.

## Pick the shape

The example app in every skill: a shop with `web`, `api`, `worker`, `db` (Postgres) and `cache` (Redis).

| Shape | Use when | Build |
|---|---|---|
| 1. One standalone workspace | A library, CLI, script, or a fix that needs no running service | `workspace` `create` with packages from the repo; clone through the connector |
| 2. One managed workspace, desk, environment | One component that needs real services | `env` `create` with the services (or reuse); a desk on it; `workspace` `create` in the desk |
| 3. One managed workspace per component, one desk | A change across `web`, `api` and `worker` | One environment with every service; one desk; a workspace per component; each intercepts its own service |
| 4. Copies | Risky data changes, experiments, PR review in a shared environment | `env` `create` with `source` for the environment; `workspace` `create` with `source` for a disposable copy in the desk; `worktree` `add` for a second branch in one workspace |

Ask in order. Does the work need a running service? No: shape 1. How many components change? One: shape 2; several: shape 3. Would it disturb a shared environment, or try several options? Yes: shape 4. Is it a one-time check? Use a capsule, not a workspace (`kloudlite-verify`).

Parallel work: only a managed workspace reaches the environment, and a clone joins no desk unless it is made in one (`workspace` `create` with `source`, or `kloudlite desks clone-workspace`). So "two features at once against the services" is two managed workspaces in the desk (each clones the repo) or two worktrees in one managed workspace. A clone keeps or explores a machine's state without services.

## Ids and states

| Object | Id starts with | States |
|---|---|---|
| Workspace | `ws-` | `creating`, `ready`, `stopped`, `error`, `deleted` |
| Environment | `env-` | `creating`, `running`, `stopped`, `error`, `deleted` |
| Desk | `desk-` | `running`, `starting`, `idle`, `stopped` |
| Capsule | `cap-` | `phase`: `pending`, `starting`, `running`, `terminated`; with `reason` `Exited`, `exit_code` is the result |

Get ids from the `list` actions of `workspace` and `env`, or from `desk` `list`. Tools take the id or the name; write the name to the user. `volume` `get` and `delete` take the volume `id` from `volume` `list`; `snapshot` `delete` takes the id or the name. Restore takes a reference in `snapshot_id`; create takes one in `source`.

A desk goes `idle` after 30 minutes without use, and its workspaces stop. A start, a create in the desk, or a connect wakes it. What the user stopped stays stopped. After a wake, the next tool answer reports each workspace restart and stop that happened while idle.

## Tools

The tools act on one desk. Most tools are one per resource: `action` picks the verb. Every code, run, package and image tool takes `workspace`, the id of a `ready` workspace. `references/tools.md` lists every tool with its actions and arguments.

| Group | Tools | Actions |
|---|---|---|
| Desk | `desk` | `desk`: `list`, `create`, `connect`, `start`, `stop`, `delete`, `ttl` |
| Workspaces | `workspace`, `workspace_vars`, `worktree` | `workspace`: `list`, `get`, `create`, `restore`, `start`, `stop`, `restart`, `delete`, `wait`, `ttl`, `snapshot`; `workspace_vars`: `get`, `set`; `worktree`: `add`, `drop` |
| Code | `read`, `write`, `edit`, `glob`, `grep` | none |
| Run | `exec`, `process`, `watch` | `process`: `list`, `output`, `wait`, `write`, `close_stdin`, `kill`; `watch`: `start`, `poll`, `stop` |
| Packages | `packages` | `packages`: `list`, `add`, `remove`, `update` |
| Images | `container_build`, `container_push` | none |
| Environments | `env`, `service` | `env`: `list`, `get`, `create`, `start`, `stop`, `delete`, `wait`, `ttl`, `snapshot`, `restore`; `service`: `add`, `update`, `remove`, `logs` |
| Intercepts | `intercept` | none |
| Volumes | `volume`, `snapshot` | `volume`: `list`, `get`, `delete`; `snapshot`: `delete` |
| Account | `quota`, `regions`, `devices`, `requests_list`, `request_get`, `request_create` | none |
| Capsules | `capsule` | `capsule`: `create`, `get`, `list`, `wait`, `logs`, `delete` |
| Pipelines | `pipeline`, `run`, `webhook_rotate` | `pipeline`: `list`, `get`, `save`, `delete`; `run`: `start`, `list`, `get`, `wait`, `logs`, `cancel` |
| Secrets and connectors | `secret_set`, `secret_list`, `secret_delete`, `connector_list` | none |
| Web | `web_fetch`, `web_search` | none |

A call without `desk` is refused with ``pass `desk` (id or name); `desk` `list` shows yours``: call `desk` `list`, ask the user which if it is not clear, and pass that `desk` on every call.

## Reads, lifecycle and deletes

These need no scenario.

- **What do I have:** the three orient calls, plus `env` with `action: "list"`.
- **Status:** `workspace` or `env` with `action: "get"` or `"wait"`. Intercepts in force: `env` `get`, `services[].interceptedBy`.
- **Logs of a service:** `service` with `action: "logs"`, `name`, and `tail`, `since`, `previous` (after a crash). It names the workspace when an intercept holds the service.
- **Start and stop:** `workspace` and `env` with `action: "start"` or `"stop"`. A stop of something the user did not name needs a name first. Before restarting a stopped `workspace` or `env`, read `stopped_reason`, `stopped_at` and `hint` from `get`: an `idle` stop starts again on use, an explicit stop stays stopped. A `snapshot` answers ready only when restorable, else `promoted`; a restore or create from one not ready yet answers 409 `not ready yet`: retry after a few seconds. `desk` `stop` also stops the bench, which serves your own tools: say so first and make it your last call.
- **Delete:** safety rule 1, then the `delete` action of `workspace`, `env`, `volume` or `snapshot`.
- **Quota:** `quota` shows the ceilings and the use. A raise is `request_create` (`kind`: `quota`, `access`, `region` or `other`, with `reason`), only when the user asks.

## Safety rules

1. **Destructive actions.** The `delete` action of any tool, `service` `remove`, `worktree` `drop`, `env` `restore` (it overwrites the target environment in place and creates nothing; to make a new one use `env` `create` with `source` a snapshot), any delete of a capsule, pipeline (or a version) or secret, `run` `cancel`, `desk` `stop`, and a stop of something the user did not name need a request that names the targets. List them by name. If the user did not name them in this turn, ask in one line first. A host confirmation counts as the confirmation.
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
| "what do I have", "status of X", "logs of db", "delete X", "stop my desk" | this skill alone | Reads, lifecycle and deletes need no scenario |
| A change, then "and check it" | develop, then verify | Every develop scenario ends with "to check the result, use `kloudlite-verify`" |

## Setup and recovery

Act on the symptom you see.

| Symptom | What to do |
|---|---|
| No Kloudlite tool at all (no `desk` or `workspace` under any prefix) | Do not guess and do not call an API. Tell the user the five steps below. Never run the installer or the login yourself unless told. |
| A tool answers ``not logged in — run `kloudlite login` `` | Tell the user that command, then to restart the client. |
| ``pass `desk` (id or name)`` | Call `desk` `list`, pass `desk` on every call. |
| `403 your access to TEAM is paused` | A team admin must restore access. Stop. |

The five steps:

1. Install `kloudlite` (macOS, Linux; WSL on Windows): `curl -fsSL https://dev.kloudlite.io/install.sh | sh`
2. Sign in (opens the browser): `kloudlite login`
3. Connect the agent. Claude Code with the plugin (tools and skills; needs no `kloudlite` binary): `/plugin marketplace add kloudlite/harness`, then `/plugin install kloudlite@kloudlite`; the first tool call opens the browser sign-in, and the consent page picks the teams; the agent lists or creates the desk. Another MCP client: `claude mcp add kl -- kloudlite mcp`, or the JSON `{"mcpServers": {"kl": {"command": "kloudlite", "args": ["mcp"]}}}`; for another team or desk, `["mcp", "TEAM", "--desk", "DESK"]`. A client that cannot start a program uses the remote URL `https://dev.kloudlite.io/mcp` with OAuth.
4. Make a desk: `desk` `create` (with `environment` to connect one), or open one once with `kloudlite -s NAME`. Every call then names it in `desk`.
5. Restart the client. It then lists the server `kl`.

After setup, `desk` with `action: "list"` must show the desk the user expects. Pass `desk` with its name (and `team` for a team desk) on each call.
