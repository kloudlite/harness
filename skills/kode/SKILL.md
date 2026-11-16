---
name: kode
description: Gives the Kode definitions, the invariants, the cost of each action, the two agent types (Coordinator and Worker), the topologies, the tool groups and the setup steps. Load first when the Kode tools are present (`desk`, `workspace`) and the task is to run, test, build or change code; when a request names a workspace (or a sandbox), environment, desk, intercept, capsule, volume, snapshot, pipeline, secret, variable or connector; when work is split between agents or handed off; for status, logs, stop, start, delete and quota questions ("what do I have", "logs of db", "delete the review workspace"); and when a tool answers "not logged in", "403 ... paused", or the server lists only the `desk` tool. Not for work that touches no Kode object, and not for code that must run on the user's own computer.
---

# Kode

Kode (Kernel for Orchestrated Development and Execution) is the infrastructure that an agent owns for development and execution. You are not a process in one folder. You make isolated machines, compose services, send real traffic to your code, save state and remove all of it. Compute is the cheapest thing you have. Idle compute, stored data that nobody reads and used quota are the expensive things.

This is the one Kode skill: the definitions, the rules and the way to choose. It gives no fixed steps for a task; you compose them. The `references/` folder holds the depth: `tools.md` (every tool and argument), `permissions.md` (who may call each action), `worker-templates.md` (the briefs and the hand-off report), `use-cases.md` (14 worked cases and how to compose a new one), `pipelines.md` (the definition format), `services.md` (common services with ports and mounts), `errors.md` and `setup.md`. When the Kode tools are present, code runs in a workspace, not on the user's computer, whatever the request says.

## Glossary

One word, one meaning. All work runs in the context of one team: a person's own team or a shared team. A team is not a component.

1. **Session.** Your conversation and its context. It runs outside Kode and drives it with tools. One session can control many workspaces. A session is not a workspace: the workspace holds code, the session holds history.
2. **Workspace.** An isolated machine in the cloud with its own kernel and a home (`/home/kl`) kept while stopped: source in `~/workspace`, installed software, caches, configuration. Code is edited and run here. Its package list (nixpkgs names with their pins) is part of each snapshot, so a clone starts ready. A workspace is one container with one home and is itself the working tree: a second branch is a second workspace, cloned. Standalone, or managed by a desk.
3. **Environment.** A set of named services that run together, each from a container image, reachable by name and port (`db:5432`). One disk holds the data of mounted folders. It is defined as data, or cloned from an environment or a snapshot.
4. **Desk.** One piece of work: the workspaces and capsules it uses and the one environment they reach, or none. Private to its creator; teammates use their own desks on the same environment.
5. **Intercept.** Sends all traffic of one environment service to a workspace of the desk; the service pauses; callers keep the same name and port. Environment-wide. It ends when the workspace stops.
6. **Process.** A detached command in a workspace, such as a dev server or a watcher. You keep working while it runs, and an intercept sends traffic to it. It lives only while the workspace runs.
7. **Capsule.** A disposable isolated container that runs one command and ends when it exits (default 300 s, at most 24 h). In a desk it reaches the environment. Files are gone at the end. It is never where an agent works; that is a workspace.
8. **Volume and snapshot.** A snapshot is a read-only copy of a workspace or environment disk at one moment, with its definition: the package list, or the services and their configuration. A volume is the saved storage of one workspace or environment: its disk and the chain of snapshots. A named volume numbers its snapshots `name@N`. A clone shares its source's volume and history: its snapshots appear there and take the source's volume name. A reference is `name` (newest), `name@N`, or a snapshot id.
9. **Pipeline.** A versioned JSON definition of jobs in a graph; each job runs its steps in its own capsule; a run starts one version by hand, on a schedule, from a webhook, or after another pipeline.
10. **Secrets and variables.** A variable is `NAME=value` in the `env` of a workspace, service, capsule or job. A secret is a named value of an owner; a variable refers to it as the whole value `${{ secrets.NAME }}`. No one reads a value back.
11. **Connector.** A link from an owner to a code host (GitHub, GitLab) or a container registry: read-only clone over HTTPS; image push and private pull. Connected in the web console.
12. **Memory.** The current structure of a project, kept by the `memory` tool for a cold start: its environments, named volumes, desks and their purpose, how to run and test it, the team's conventions, and your own open work. One document for one project, owned by the team; only a Coordinator writes it, and it says what is, never what happened.
13. **TTL and quota.** A TTL (`ttl_secs`, 10 minutes to 30 days) deletes a workspace, environment or desk that stays unused past it. Quota is the owner's ceiling on workspaces, environments, snapshots, capsules, disk, cpu and memory; the `quota` tool reads it.

**"Sandbox" is not a Kode object.** It is the general idea, not a resource. When the user asks for a sandbox, give a workspace, unless they ask for one command or a throwaway run, which is a capsule.

Three facts decide every topology choice:

1. **Managed vs standalone.** A workspace created in a desk is managed: it reaches the environment, and the desk starts, stops and deletes it. A standalone workspace never joins a desk. `workspace` with `action: "create"` and a `source` makes a copy that joins the desk the tool acts for, so it is managed; `action: "restore"` from a desk joins the desk the same way, while a restore or clone made from the laptop CLI (`workspaces clone`, `workspaces restore`, `devices workspaces clone`) is standalone. To clone into a desk from the laptop, use `kode desks clone-workspace WORKSPACE --to NAME` (a device workspace also needs `--snapshot ID`).
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

## Invariants

1. **Packages.** Never `apt-get`, never pipe `curl` into a shell, never install system-wide. Use the `packages` tool (nixpkgs) first. Only what nixpkgs lacks goes into the home folder, where it persists; Python libraries go in with pip.
2. **Three end states.** Each resource that you create ends as one of: **stopped** (unfinished work that you will return to), **snapshotted, then deleted** (a result to use again) or **deleted** (throwaway). There is no fourth state. Unfinished work is stopped, never deleted.
3. **Persist, then discard.** Push to git, take a snapshot or write a report file. Then delete, as soon as the work is done.
4. **Ownership.** You have full freedom over what you created in this desk: start, stop, snapshot, clone and delete it without a question to the user. What you did not create (a team environment, a named base volume, a saved pipeline, the objects of another desk, what the user had) is for the Coordinator only. Ask the person only for what cannot be undone: `env` `restore` in place, the delete of a shared environment or of a named volume, and an intercept on an environment that other people use.
5. **Legible.** Each object that outlives your session has a name that a person can read, and a `task` or `message` that says why it exists. Keep a small declared set (base workspaces, named volumes, environments to use again), not a store that nobody can read.
6. **Secrets.** Never print, echo, log or repeat a secret value. Pass it to `secret_set`, never in a command line or a chat message. Refer to it by name.
7. **Refusals.** When a call fails or is refused, a quota refusal included, report the error as it is. Do not go around it through another desk, workspace or tool. A Worker stops and reports to the Coordinator.
8. **Status first.** Call `status` at the start of each turn. It lists the processes that crashed, the restarts and what runs in the desk. Never assume that a background process still runs.

## Three budgets

- **Context.** The tokens of your session. A hand-off to another agent costs a full explanation; one long session costs compaction and drift. Delegate only work that is independent, parallel and verifiable, and hand it off as a written artifact (a file or a branch), never as chat context. Continue unfinished work in the same session.
- **Infrastructure.** Quota slots and running compute. Defaults for a person: 5 workspaces, 2 environments, 5 capsules, 20 snapshots, 100 GB of disk; read `quota` before a fan-out. Idle stops are automatic (a desk and its workspaces after 30 minutes without use, its environment 5 minutes later when no other awake desk uses it), so manage slots and storage, not uptime.
- **Storage.** Each clone and each snapshot is copy-on-write: free at birth, it grows as it diverges. A stopped workspace still counts its disk. A snapshot is kept 30 days by default. Delete what you will not use again.

## What to do, and what it costs

| You want to | Do | It costs |
|---|---|---|
| Run one command cleanly | `capsule` `create` with `from_workspace` or `from_snapshot` | 1 capsule slot for its lifetime; nothing after |
| Test this exact state, uncommitted work included | `capsule` `create` with `from_workspace` | 1 capsule slot; the workspace is not touched |
| Keep a server up while you work | `exec` with `detach: true`; check it with `status` each turn | Nothing more; it ends with the workspace |
| Be sure of cleanup | `workspace` or `env` `create`, then `ttl` in the same turn; `desk` `create` takes `ttl_secs` | Nothing; the platform deletes it when unused |
| Decide whether to work in parallel | `quota` first | One call |
| Edit and run code against real services | A workspace in a desk that is connected to the environment | 1 workspace slot; storage grows with the home |
| Test a change with real traffic, without a deploy | `intercept` `start` to your workspace | Each desk on that environment sees it: say so first, stop it when done |
| Try N approaches at one time | N clones of one base (`workspace` `create` with `source`), or N capsules; one session coordinates | N slots while they run; delete the losers, keep the winner |
| Break data or services freely | `env` `create` with `source`, then `desk` `connect` to the copy | A full environment slot (2 by default); delete the copy after |
| Keep a ready toolchain | `workspace` `snapshot` with a `volume` name and a `message`; later `workspace` `restore` | 1 snapshot slot and the storage of the difference |
| Pause unfinished work | `workspace` `stop`, or `desk` `stop` | Storage only |
| Repeat work without a person | `pipeline` `save`, with a schedule or a webhook (`references/pipelines.md`) | The capsules of each job of each run |
| Hand work to another agent | Commit, or write `REPORT.md` in the workspace, then stop it | The context to read the report; no live context is shared |

## Agent types and topologies

An agent is a session. There are two types. Which one you are is decided by capability, not by host: if you hold a tool that starts another agent, you are a Coordinator and may delegate; if you hold none, read "When you cannot delegate" below. `references/permissions.md` gives each tool action for each type.

- **Coordinator.** Talks to the user, owns the plan and the three budgets, picks the topology, starts and stops Workers. Creates and deletes workspaces, environments and desks. It is the only agent that makes a declared, shared artifact (a named base volume, a team environment, a saved pipeline with a trigger). After it delegates, it does not edit or run code: it reads the Worker's artifact first (report, diff, test output), opens one file only to check one claim, and when it wants a command run, it asks a Worker or a capsule for the exit code and the end of the log.
- **Worker.** One session with the resources that it created or that the brief names. Full freedom inside that scope, nothing outside it. It ends with persist, then stop or delete, and leaves `REPORT.md` (`references/worker-templates.md`). A Worker can start sub-Workers with four limits: only in a clone of its own workspace; the same scope, never wider; the report comes back as an artifact; one level deep. A new environment or a new desk comes from the Coordinator.

Topologies. **Solo:** one session, one workspace; the default. **Conductor:** one session drives many workspaces or capsules that need no memory of each other (parallel experiments, a test matrix). **Delegation:** the Coordinator gives each Worker its own workspace and a brief; the work is independent, parallel and verifiable, and the hand-off is an artifact. **Pipeline:** the work repeats or follows an event; make a proven Worker workflow a saved pipeline.

You make the plan and you execute it: say the topology in one line, then build it. When no use case fits, compose from the primitives: a snapshot is a commit of a whole machine or a whole system, an intercept is a swap of one service for live code, a capsule is a function call with a file system. Ask what becomes possible when these cost almost nothing, and leave only what a person can read.

## When you cannot delegate

A session with no tool that starts another agent is the Coordinator and does the Worker's work itself. It holds both columns of `references/permissions.md`; the human gate for what cannot be undone stays.

1. **Topologies.** Solo, Conductor and Pipeline work as written. Delegation is out: do not plan work for Workers that cannot exist, and do not wait for a report that nobody will write.
2. **Parallel work.** Capsules, detached processes and pipelines still run in parallel. One context thinks, so keep the plan short and finish one thing before the next.
3. **Context.** Nobody else absorbs noise. Push a long or noisy run into a capsule or a detached process, and take back only the exit code and the end of the log, as a Coordinator would.
4. **Hand-off to yourself.** Write the brief before the work and `REPORT.md` at the end anyway. They carry the work across compaction and into a later session: the next session starts by reading them.

## Device workspaces

A device workspace runs on the person's own Mac, in an operating system sandbox, and its folder is an ordinary folder there. `workspace` with `action: "create"` and `device` (an id `dev-…` from the `devices` tool) makes one in the desk. Without `device` the workspace is a cloud one, whatever else the call says.

1. The device must be online and active in the team that owns the desk. If it is offline or active elsewhere, the create is refused with a sentence that says which; the person runs `kode start` or `kode devices connect TEAM`.
2. A device workspace has no ssh. Its tools (`read`, `write`, `exec`) reach it through the gateway. `exec` runs in the sandbox: it writes only the workspace folder, and the network reaches every host except the Kode API and any the person denied (an `allow` list from the person narrows it to that list). It never reaches the Mac itself: loopback, the Mac's other local services and the names `kode` writes into `/etc/hosts` are refused, by address or by name.
3. `workspace` `snapshot` takes a copy-on-write snapshot on the Mac (the workspace restarts while it is made). `create` with `source` and `snapshot` (a `dsnap-…` id) clones it, and the copy joins the desk. `restore` with a `dsnap-…` id as `snapshot_id` makes a new workspace the same way.
4. A device workspace reaches the desk's environment only through `KD_ENV_{SERVICE}_{PORT}` (and `KD_ENV_{SERVICE}` for a service's first port), set to `127.0.0.1:{port}`. Read them with `exec` `env | grep ^KD_ENV` and connect to that address, for any protocol. Names such as `db`, `db.main` or `notes.mac-test` do not resolve in the sandbox, and the proxy refuses them with `403 not in the allowlist`; do not try them, and do not try another workspace's name either. A service added after the workspace started gets its variable after `workspace` `restart`. The forward uses the workspace's own desk, whichever desk the laptop is on. A workspace reaches only the services of its own desk, never another desk's, and never another workspace's forward.
5. `devices` lists the machines with `online`, `enabled` and `account`: pick one that is online and whose `account` is the desk's team. An agent cannot start the Mac's service or connect a device to a team; hand the person the command. A name is unique within its account, and these names are reserved in every account: `ws`, `env`, `api`, `admin`, `system`, `kd`, `bld-…`, and anything that looks like an id.
6. `exec` in a device workspace writes only inside its folder and its own `TMPDIR` (a tool that ignores `TMPDIR` and writes the per-user temp or cache dir is refused) and reads only its folder plus the system tool folders (`/Library/Developer`, `/opt/homebrew`, `/usr/local`) unless `create` names extra access in `access` (for example `["xcode", "user-temp"]` for an iOS build). The person defines the names on their Mac (`kode devices access list` shows them); an undefined name keeps the workspace from starting with `AccessUndefined` and a sentence naming the command that defines it. Hand that command to the person. Built-in names: `xcode` (Xcode and its build output), `user-temp` (the per-user temp and cache folders), `android` (the SDK) and `pty` (a pseudo-terminal, which `xcodebuild test` needs). Simulator tests need `["xcode", "user-temp", "pty"]`, and the simulator must be booted BEFORE the workspace starts, because its test socket is granted at start. A name the Mac refuses (`AccessRefused`, for example a keychain or home folder) is final: do not look for a way around it. Signing and running on a device are not supported; build for the simulator. Package caches need no access, since `~` is the workspace folder. A binary file you want to see or give the person: `read` an image, or `download` for a console link the person opens signed in (and a resource link an MCP client reads); `transfer` moves a file between your workspaces.

## Hosts

Read your row.

| Host | Tools | Local commands | Local files | Who works |
|---|---|---|---|---|
| Claude Code with the plugin (remote server) | `mcp__plugin_kode_kd__*`, without `web_fetch`, `web_search` and `scratch_*` | yes | yes | the one agent |
| MCP client with `kode mcp` | server `kd`, all scopes in one list | only with a shell tool | only with file tools | the one agent |
| Remote connector (claude.ai, ChatGPT) | `/mcp` over OAuth | no | no | the one agent |
| Kode runtime (shared) | split by role: main, workspace, subagent | no | no | the role skills |

A call acts in the desk named by its `desk` argument (id or name, on the laptop door and the remote server, the plugin and a remote connector); a door refuses a call without it. `team` names which of the teams you connected. Only the harness drives one fixed desk, which it supplies itself: its agents pass no `desk`, and `workspace` with `action: "create"` always lands in that desk. In the harness, a task that needs another desk is for the user to open.

In the Kode runtime the main desk is the Coordinator, a workspace desk is a Worker and a subagent desk is its sub-Worker; the role skills give their tools.

Use a tool, not a command. Two things have no tool: connecting a provider (the web console) and `kode env`, the tunnel to the laptop. For those, give the user the exact command, or run it only on a host with a shell.

## How to work

1. **Orient first.** Call `status`, then `memory` with `action: "read"` (the project as it is, and your open work), `desk` with `action: "list"`, `workspace` with `action: "list"` (the owner's workspaces; `thisDesk` marks this desk's), then `env` with `action: "get"` of the desk's environment, before any create. Say in one line what exists.
2. **Scope is this desk.** The tools reach everything of the owner; a task is about this desk's workspaces and environment unless the person names another object. Outside the desk, act only on an explicit name or id.
3. **Reuse for the same job; clone for isolation.** A workspace that holds the repo, an environment that runs the app, a desk on it: use them. Create what is missing, and clone when the work must not disturb the original. Name each object in the answer.
4. **Derive the set-up from the repository.** Read `docker-compose.yml`, `.env.example`, `README`, `Procfile`, `package.json`, `go.mod`, `pyproject.toml`, `Cargo.toml`: they give services, ports, variables and packages. Ask the user only what the repo does not say (which registry, which environment to share).
5. **Names.** Workspace: the repo or component (`api`, `web`). Environment: the app and purpose (`shop-dev`, `shop-pr-42`). Desk: the piece of work (`orders`, `review-42`). Lowercase, hyphens, unique per owner.
6. **Wait with `wait: true`.** Create, start, restore and `run` start take `wait: true` and answer when the object has settled, or at `soft_ms` (default 5000 on a remote door, which also cuts any wait at 20 s; 25000 in the harness) with `{promoted: true, id, kind, poll_after_ms}`: call the `wait` action of the `kind` tool (`desk`: `get`) after `poll_after_ms`. `exec` and `container_build` promote with `kind: "process"`: loop `process` `wait` with `since`/`since_err` from `next`/`next_err`. A `wait` action takes `timeout_ms` and answers `timed_out: true` at the limit: call it again. A `failing` service needs its `message` and a fix, not more waiting. The loop applies when a `promoted` answer arrives; a client that waits on MCP tasks waits on its own and never sees one.
7. **Packages are tools; services belong in the environment.** No database, queue or broker in a workspace. `references/services.md` gives image, ports and mounts.
8. **Service data.** A service that writes data gets a mount in the same call that creates it. A service without `mounts` loses its data on each restart, and data written before a mount is lost. Example: `{"name": "db", "image": "postgres:16", "ports": [5432], "mounts": [{"folder": "pg-data", "path": "/var/lib/postgresql/data"}]}`. A service that keeps all its data in another service needs none: say so.
9. **Processes.** Run a dev server detached (`exec` with `detach: true`). Read it with `process` and `action: "output"`. Confirm it listens on its port before an intercept. `process` with `action: "kill"` stops it when done. At most 32 processes. A plain `exec` still running past `soft_ms` is promoted: it answers `promoted: true`, an `id` and `poll_after_ms`; after that call `process` with `action: "wait"` and that `id` until `state` is `exited`. `exec` takes `notify`: `never`, `on_failure` (default) or `always`. Call `status` once at the start of each turn: it lists the notices a client did not show, and the running processes. `status` also lists the desk's workspaces with their running processes. A process that crashes, a workspace restart, stop or error and a change of the environment's state arrive as a `notices:` second content item after the answer of a later tool call, a crash with its last stderr lines, so do not poll for them. Only a detached or promoted `exec` reports; `kill` silences it. An exited process is never restarted; a detached one killed by a workspace stop is relaunched, output opening `[restarted <time>: <reason>]`, unless the exec passed `relaunch: false`; each `restarts` entry names `reason` and `by`, and `workspace` `restart` answers the new entry as `restart`; `by: agent` marks a restart you asked for and `relaunch` the processes a restart brought back. `process` states: `running`, `exited`, `gone`, `killed_by_restart` (the workspace restarted; run it again).
10. **Intercept etiquette.** In an environment of your own, intercept freely. In a shared environment, say which service you take before you take it, one workspace per service, and stop it when done. Copy the environment for data changes, risky migrations and experiments (shape 4).
11. **Quota and errors.** A `409` that names a limit does not pass on a retry: free something of your own, or report it. A raise is `request_create` with a `reason`, from the Coordinator, and the answer to the user says that it was asked. A pipeline job refused only by the `capsules`, `cpu` or `memoryGb` quota waits up to 30 minutes (`waiting for quota: …`) instead of failing. `references/errors.md` gives the action for each error.
12. **Answer shape.** Result first; then the objects created, removed and kept, each kept one with its state and its reason; then the next step. Never a dump of tool output.
13. **Argument errors.** A call with an argument the action does not take is refused with `unknown argument` and the list the action takes. Read the list, fix the call, and call once more. Do not retry the same call, and do not drop the argument and carry on: the object you get would not be the one you asked for.
14. **Do not search for a shell on the person's machine.** You have no ssh to a device workspace and no shell on the person's Mac. Work in the workspace with `exec`, `read`, `write`, `edit` and the other tools; they are all it exposes. Anything that needs the Mac itself (`kode login`, `start`, `devices …`) is a command to hand to the person, exactly written.

## Pick the shape

| Shape | Use when | Build |
|---|---|---|
| 1. One standalone workspace | A library, CLI, script, or a fix that needs no running service | `workspace` `create` with packages from the repo; clone through the connector |
| 2. One managed workspace, desk, environment | One component that needs real services | `env` `create` with the services (or reuse); a desk on it; `workspace` `create` in the desk |
| 3. One managed workspace per component, one desk | A change across `web`, `api` and `worker` | One environment with every service; one desk; a workspace per component; each intercepts its own service |
| 4. Copies | Data changes that can break things, experiments, a second branch, PR review in a shared environment | `env` `create` with `source` for the environment; `workspace` `create` with `source` for a copy in the desk, one per branch or approach |

The example app: a shop with `web`, `api`, `worker`, `db` (Postgres) and `cache` (Redis). Ask in order. Does the work need a running service? No: shape 1. How many components change? One: shape 2; several: shape 3. Would it disturb a shared environment, or try several options? Yes: shape 4. Is it a one-time check? Use a capsule, not a workspace. Only a managed workspace reaches the environment, and a clone made in the desk is managed: "two features at once against the services" is two managed workspaces in the desk, the second a clone of the first.

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

The tools act on one desk. Most tools are one per resource: `action` picks the verb. Every code, run, package and image tool takes `workspace`, the id of a `ready` workspace. `references/tools.md` lists every tool with its actions and arguments; `references/permissions.md` says who may call each action.

| Group | Tools | Actions |
|---|---|---|
| Desk | `desk` | `desk`: `list`, `create`, `connect`, `start`, `stop`, `delete`, `ttl` |
| Workspaces | `workspace`, `workspace_vars` | `workspace`: `list`, `get`, `create`, `restore`, `start`, `stop`, `restart`, `delete`, `wait`, `ttl`, `snapshot`; `workspace_vars`: `get`, `set` |
| Code | `read`, `write`, `edit`, `glob`, `grep`, `download`, `transfer` | none |
| Run | `exec`, `process`, `watch` | `process`: `list`, `output`, `wait`, `write`, `close_stdin`, `kill`; `watch`: `start`, `poll`, `stop` |
| Packages | `packages` | `packages`: `list`, `add`, `remove`, `update` |
| Images | `container_build`, `container_push` | none |
| Environments | `env`, `service` | `env`: `list`, `get`, `create`, `start`, `stop`, `delete`, `wait`, `ttl`, `snapshot`, `restore`; `service`: `add`, `update`, `remove`, `logs` |
| Intercepts | `intercept` | none |
| Volumes | `volume`, `snapshot` | `volume`: `list`, `get`, `delete`; `snapshot`: `delete` |
| Account | `quota`, `regions`, `devices`, `requests_list`, `request_get`, `request_create` | none |
| Memory | `memory` | `memory`: `read`, `write`, `list` |
| Capsules | `capsule` | `capsule`: `create`, `get`, `list`, `wait`, `logs`, `delete` |
| Pipelines | `pipeline`, `run`, `webhook_rotate` | `pipeline`: `list`, `get`, `save`, `delete`; `run`: `start`, `list`, `get`, `wait`, `logs`, `cancel` |
| Secrets and connectors | `secret_set`, `secret_list`, `secret_delete`, `connector_list` | none |
| Web | `web_fetch`, `web_search` | none |

A call without `desk` is refused with ``pass `desk` (id or name); `desk` `list` shows yours``: call `desk` `list`, ask the user which if it is not clear, and pass that `desk` on every call.

## Reads, lifecycle and deletes

- **What do I have:** the orient calls, plus `env` with `action: "list"`.
- **Status:** `workspace` or `env` with `action: "get"` or `"wait"`. Intercepts in force: `env` `get`, `services[].interceptedBy`.
- **Logs of a service:** `service` with `action: "logs"`, `name`, and `tail`, `since`, `previous` (after a crash). It names the workspace when an intercept holds the service.
- **Start and stop:** `workspace` and `env` with `action: "start"` or `"stop"`. Before restarting a stopped `workspace` or `env`, read `stopped_reason`, `stopped_at` and `hint` from `get`: an `idle` stop starts again on use, an explicit stop stays stopped. A `snapshot` answers ready only when restorable, else `promoted`; a restore or create from one not ready yet answers 409 `not ready yet`: retry after a few seconds. `desk` `stop` also stops the bench, which serves your own tools: say so first and make it your last call.
- **Delete:** invariant 4 decides. What you created: persist it if it has value, then the `delete` action of `workspace`, `env`, `capsule`, `volume` or `snapshot`, and say what you removed. What you did not create: list the targets by name and call only when the user named them, or after a yes. A refusal is final.
- **Quota:** `quota` shows the ceilings and the use. Read it before each fan-out.

## Setup and recovery

Act on the symptom you see.

| Symptom | What to do |
|---|---|
| No Kode tool at all (no `desk` or `workspace` under any prefix) | Do not guess and do not call an API. Tell the user the five steps of `references/setup.md`. Never run the installer or the login yourself unless told. |
| A tool answers ``not logged in — run `kode login` `` | Tell the user that command, then to restart the client. |
| ``pass `desk` (id or name)`` | Call `desk` `list`, pass `desk` on every call. |
| `403 your access to TEAM is paused` | A team admin must restore access. Stop. |
