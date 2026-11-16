---
name: kode
description: How to work on the Kode platform through its tools: the definitions, the invariants, the conventions, the cost of each action, the two agent types (Coordinator and Worker), the topologies and the tool groups. Load first when the Kode tools are present (`desk`, `workspace`) and the task is to run, test, build or change code; when a request names a workspace (or a sandbox), environment, desk, intercept, capsule, volume, snapshot, storage commit, branch, pipeline, secret, variable or connector; when work is split between agents or handed off; for status, logs, stop, start, delete and quota questions ("what do I have", "logs of db", "delete the review workspace"); and when a tool answers "not logged in", "403 ... paused", or the server lists only the `desk` tool. Not for work that touches no Kode object.
---

# Kode

Kode (Kernel for Orchestrated Development and Execution) is the infrastructure that an agent owns for development and execution. You are not a process in one folder. You make isolated machines, compose services, send real traffic to your code, save state and remove all of it. Compute is the cheapest thing you have. Idle compute, stored data that nobody reads and used quota are the expensive things.

This is the one Kode skill: the definitions, the rules and the way to choose. It gives no fixed steps for a task; you compose them. The `references/` folder holds the depth: `tools.md` (every tool and argument, ids and states), `permissions.md` (who may call each action), `models.md` (which model class each agent gets), `worker-templates.md` (the briefs and the hand-off report), `use-cases.md` (14 worked cases and how to compose a new one), `planning.md` (the plan file for work that is split), `pipelines.md` (the definition format), `services.md` (common services with ports and mounts), `devices.md` (workspaces on the person's Mac), `errors.md` and `setup.md` (the steps, and a row for each host). When the Kode tools are present, code runs in a workspace, not on the user's computer, whatever the request says.

## Solo quick path

The default: one session, one workspace, nothing delegated.

1. `status`; `memory` `read`; `volume` `list` with the project `label`.
2. `workspace` `restore` from `name@base` (or the `wip-` branch that `open-work` names) with a `name`, then `ttl` in the same turn.
3. Pull, work, test.
4. Push; remove credentials from the home; `workspace` `snapshot`: plain only when the state builds and passes (the checked-out `base` advances), else with `branch: "wip-<topic>"`.
5. `memory` `write`; `workspace` `delete`. The volume stays.

## Glossary

One word, one meaning. All work runs in the context of one team: a person's own team or a shared team. A team is not a component.

1. **Session.** Your conversation and its context. It runs outside Kode and drives it with tools. One session can control many workspaces. A session is not a workspace: the workspace holds code, the session holds history.
2. **Workspace.** An isolated machine in the cloud with its own kernel and a home (`/home/kl`) kept while stopped: source in `~/workspace`, installed software, caches, configuration. Code is edited and run here. Its package list (nixpkgs names with their pins) is part of each snapshot, so a clone starts ready. A workspace is one container with one home and is itself the working tree: a second line of work is a second workspace, cloned. Standalone, or managed by a desk.
3. **Environment.** A set of named services that run together, each from a container image, reachable by name and port (`db:5432`). One disk holds the data of mounted folders. It is defined as data, or cloned from an environment or a snapshot.
4. **Desk.** One piece of work: the workspaces and capsules it uses and the one environment they reach, or none. Private to its creator; teammates use their own desks on the same environment.
5. **Intercept.** Sends all traffic of one environment service to a workspace of the desk; the service pauses; callers keep the same name and port. Environment-wide. A stopped workspace gives the traffic back, but the intercept stays recorded and takes hold again when the workspace returns: only `intercept` `stop` ends it.
6. **Process.** A detached command in a workspace, such as a dev server or a watcher. You keep working while it runs, and an intercept sends traffic to it. It lives only while the workspace runs.
7. **Capsule.** A disposable isolated container that runs one command and ends when it exits (default 300 s, at most 24 h). In a desk it reaches the environment. Files are gone at the end. It is never where an agent works; that is a workspace.
8. **Volume, storage commit, branch and label.** A volume is the saved storage of one workspace or environment, like a git repository. A **storage commit** (short: commit) is a read-only copy of its disk at one moment, with its definition (the package list, or the services and their configuration); `workspace` or `env` `snapshot` makes one, and a named volume numbers them `v1`, `v2` (`name@N`). A **branch** is a movable name on one commit, like a git branch: `shop-base@base`. A workspace or environment made from `name@<branch>` has that branch checked out, and its next snapshot advances it (a fast-forward); one made from a number, from `name@latest` or as a clone is detached and moves no branch. The first commit of a volume makes the branch `base`. A commit that a branch points at does not expire and cannot be deleted; any other expires 30 days after it was made or last restored from, and a volume with no workspace or environment goes, with its name, when its last commit does. `labels` and a `description` are words on the volume for finding it. A clone or a restore shares its source's volume: its snapshots are commits of that volume, and another `volume` name is refused. A reference is `name@<branch>`, `name@N`, `name@latest`, `name` (its `base` branch, else its newest commit) or a snapshot id.
9. **Pipeline.** A versioned JSON definition of jobs in a graph; each job runs its steps in its own capsule; a run starts one version by hand, on a schedule, from a webhook, or after another pipeline.
10. **Secrets and variables.** A variable is `NAME=value` in the `env` of a workspace, service, capsule or job. A secret is a named value of an owner; a variable refers to it as the whole value `${{ secrets.NAME }}`. No one reads a value back.
11. **Connector.** A link from an owner to a code host (GitHub, GitLab) or a container registry: clone over HTTPS, push to github.com with the person's linked GitHub account, image push and private pull. Connected in the web console.
12. **Memory.** The current structure of a project, kept by the `memory` tool for a cold start, in five sections: `environments`, `volumes`, `run`, `conventions` (the team's) and `open-work` (yours). It names only what lasts: never a workspace, a desk or a running environment. A project is its owner, a team or a person's own account: a team with several repositories shares one memory, with a heading for each repository inside a section. It says what is, never what happened.
13. **TTL and quota.** A TTL (`ttl_secs`, 10 minutes to 30 days) deletes a workspace, environment or desk that stays unused past it; `create` takes it in the same call; `restore` takes none: restore, then `ttl` in the same turn. Quota is the owner's ceiling on workspaces, environments, snapshots, capsules, disk, cpu and memory; the `quota` tool reads it.

**"Sandbox" is not a Kode object.** It is the general idea, not a resource. When the user asks for a sandbox, give a workspace, unless they ask for one command or a throwaway run, which is a capsule.

**If you know git.** The storage of a workspace or environment works like a repository of whole machines.

| git | Kode |
|---|---|
| repository | volume |
| commit, branch, topics | storage commit (`vN`), branch (`name@base`, `name@wip-auth`), `labels` |
| `git checkout base` | `workspace` `restore` from `name@base` (an environment: `env` `create` with `source`) |
| commit on the checked-out branch / `git switch -c wip-auth` + commit | `snapshot` (the branch advances) / `snapshot` with `branch: "wip-auth"` |
| `git branch -f base v7` / `git branch -d wip-auth` | `volume` `branch` / `volume` `delete_branch` |
| detached HEAD | made from `name@N`, `name@latest`, or as a clone: no branch moves |

Three facts decide every topology choice:

1. **Managed vs standalone.** A workspace created in a desk is managed: it reaches the environment, and the desk starts, stops and deletes it. A standalone workspace never joins a desk. `workspace` with `action: "create"` and a `source` makes a copy that joins the desk the tool acts for, so it is managed; `action: "restore"` from a desk joins the desk the same way, while a restore or clone made from the laptop CLI (`workspaces clone`, `workspaces restore`, `devices workspaces clone`) is standalone. To clone into a desk from the laptop, use `kode desks clone-workspace WORKSPACE --to NAME` (a device workspace also needs `--snapshot ID`).
2. **A capsule ends.** It is for one command; nothing in it survives. A capsule in a desk is a managed member and reaches the environment.
3. **An intercept is environment-wide.** Every caller of the service, every teammate's desk included, reaches the workspace. One workspace per service.

```
team ─┬─ desk ── joins ──> workspaces, capsules ──> environment (0 or 1)
      │                         intercept: service ──> workspace of the desk
      ├─ environment ── services (image, ports, env, mounts)
      ├─ volume ── commits name@N, branches name@base <── workspace, environment, job (saveTo, fromSnapshot)
      ├─ pipeline ── versions ── runs ── jobs (one capsule each)
      ├─ secrets ──> env of a workspace, service, capsule or job
      └─ connectors ──> git clone and push; image push and pull
```

## Invariants

1. **Packages.** Never `apt-get`, never pipe `curl` into a shell, never install system-wide. Use the `packages` tool (nixpkgs) first. Only what nixpkgs lacks goes into the home folder, where it persists. Python libraries: `packages` `add` `uv`, then `uv venv .venv && uv pip install <lib>`, run with `.venv/bin/python` (there is no `pip` beside `python3`).
2. **Two end states.** Each resource that you create ends as one of: **snapshotted, then deleted** or **deleted**. The session's main workspace (the one restored from the project volume) always ends snapshotted, then deleted, even when all code went to git: the snapshot carries the pulled code, the packages and the caches. Clones, capsules and copies of an environment are throwaway: deleted. Stopped is a pause inside a session, never an end.
3. **Snapshot-first sessions.** A session starts from a snapshot and ends with one, and nothing that runs or is stopped stays between sessions. Start with `workspace` `restore` from `name@base` or the branch that `open-work` names (an environment: `env` `create` with `source`): that checks the branch out. Never start from a commit number unless you mean to work detached. End with a snapshot, the memory updated, and every workspace and environment that you created deleted. Conventions 15 and 16 give the order. The first session of a project has nothing to restore: use case 13.
4. **A volume stays.** Work adds commits to the volume that it came from. It never makes a second volume from a snapshot and never deletes a volume to end a session: a commit stores only the blocks that changed, a second volume stores a full copy. Only a workspace or environment that was created empty names a new volume. A commit stays while a branch points at it, so keep `base` on a good commit: a volume whose commits all expire is gone.
5. **Ownership.** You have full freedom over what you created in this desk: start, stop, snapshot, clone and delete it without a question to the user. What you did not create (a team environment, a named volume, a saved pipeline, the objects of another desk, what the user had) is for the Coordinator only. Ask the person only for what cannot be undone: `env` `restore` in place, the delete of a shared environment or of a volume, and an intercept on an environment that other people use.
6. **Legible.** Each object that outlives your session has a name that a person can read, and a `task` or `message` that says why it exists. Each volume has a `description`, `labels` and a `base` branch. Keep a small declared set (named volumes, saved pipelines), not a store that nobody can read.
7. **Secrets.** Never print, echo, log or repeat a secret value. Pass it to `secret_set`, never in a command line or a chat message. Refer to it by name.
8. **Refusals.** When a call fails or is refused, a quota refusal included, report the error as it is. Do not go around it through another desk, workspace or tool. A Worker stops and reports to the Coordinator.
9. **Status first.** Call `status` at the start of each turn. It lists the processes that crashed, the restarts and what runs in the desk. Never assume that a background process still runs.

## Conventions and discipline

A checklist of practice. Each rule holds in every topology, and the rest of the skill refers to it by number.

1. **Names.** 1 to 40 lowercase letters, digits or `-`, starting with a letter, unique per owner. Workspace: the repository or component (`api`). Clone: `<source>-<stream>` (`api-auth`), with a `task` that says what it is for. Environment: the app and purpose (`shop-dev`, `shop-pr-42`). Desk: the piece of work (`orders`). Pipeline: what it does (`api-ci`). Branch: the stream name of the plan file.
2. **Volume names.** `<project>-base` for a workspace volume, `<project>-env` for an environment volume. Never the name of a live environment: `env` `create` reads `source` as an environment first.
3. **Labels** say what a volume is, so that `volume` `list` with `label` finds it: the project name, and `test` for a fixture. At most 8. A `labels` value replaces the whole set: repeat the ones to keep.
4. **Branches.** `base` is the good state that a session starts from: only commits whose build or test passed go on it, and it moves only when the Coordinator decides a state is the new start. Any other name is allowed (`release-12`); `wip-<topic>` is only the convention for unfinished work. Not a number and not `latest`; at most 16 on a volume.
5. **Who moves `base`.** Practice, not a platform rule: the Coordinator. A Worker works in a clone, which is detached, and never moves a branch; a Worker on a restored workspace snapshots only onto the branch that its brief names.
6. **Snapshot `message`.** What changed since the last commit and whether it is good (`node 22, deps of 2026-11-16, build passes`), or what is left when the work is unfinished.
7. **Volume `description`** (at most 500 characters). What is inside (repositories, toolchain, data) and what to use it for. Give a new one when the contents change.
8. **When to snapshot.** The main workspace at the end of every session, and before a risky step. Not after every edit: git holds the code. After a restore from `name@base` the checked-out branch is `base`, so a plain `snapshot` advances it: do that only for a good state, and pass `branch` to keep `base` where it is. Unfinished work that cannot go to git: `snapshot` with `branch: "wip-<topic>"`, and `open-work` names `name@wip-<topic>` and what is left. The next session restores `name@wip-<topic>`; when the work is good it snapshots, moves `base` to that commit with `volume` `branch`, and deletes the wip branch with `volume` `delete_branch`.
9. **Detached.** When a snapshot answers `detached` (someone else moved the branch since you checked it out), say so, then decide: put your commit on its own branch with `volume` `branch`, or move the branch to it when yours is the one to keep. Never leave a good commit without a branch.
10. **Storage.** A commit stores only the changed blocks and uses one snapshot slot (20 for a person, 80 for a team). A commit that no branch points at expires 30 days after its last use; delete it sooner with `snapshot` `delete` when nothing needs it. A branch head is refused; never delete the last commit.
11. **TTL.** Every workspace, environment and desk gets a TTL: `ttl_secs` in the `create` call; restore, then `ttl` in the same turn. It is a backstop: an environment is not expired while a desk is connected to it, and a workspace or desk only once its desk is idle. You still delete at the end.
12. **Never in a snapshot or the memory.** No credential in the home before a snapshot: no token file, kubeconfig, registry login, `.npmrc` or `.env` with a value. Every member of the team can restore a team volume. The memory names a secret, never its value.
13. **Memory content.** `volumes`: each volume, what is inside, its labels and the branch to start from (`shop-base@base`). `environments`: the volume and branch that an environment starts from, and its services. `run`: the repositories, and the commands to build, run and test. `conventions`: the team's rules. `open-work` (yours): each unfinished item with its branch (`shop-base@wip-auth`) and what is left. The memory names branches, never commit numbers.
14. **Memory hygiene.** Current state, never history, and short (a section holds at most 16 KiB). Only the Coordinator writes: read it first, write it last, patch with `edits` and the `if_version` of your read, and on a `409` merge and write again. Each tool answer carries `memory: {rev, changed}`; when `changed` is true another session wrote it: read it again before you rely on it.
15. **Start of a session, in order.** `status`; `memory` `read`; `volume` `list` with the project `label`; `volume` `get` to see that the branch is there; `quota`; `workspace` `restore` from `name@base` (or the `wip-` branch in `open-work`) with a `name`, then `ttl`; pull. When the memory is empty and no volume carries the label, this is the first session: use case 13.
16. **End of a session, in order.** Stop every intercept. Commit and push. Remove credentials from the home. Snapshot the main workspace: plain when the state is good (`base` advances), with `branch: "wip-<topic>"` when it is not. Check the answer for `detached` (convention 9). `memory` `write`. Delete each workspace and each environment that you created. Say what was removed and what was kept. Nothing stays, running or stopped.
17. **Claims.** A claim that something works carries the command, its exit code and the end of its log. "Not verified" is an allowed answer.
18. **Hand-offs are files:** `REPORT.md`, a branch, a plan file. Never chat context.
19. **Before you spend.** Read `quota` before a fan-out. Write one plan file with the contracts before parallel work starts (`references/planning.md`). What needs a yes from the person is in invariant 5; do the rest of your own without a question.

## Three budgets

- **Context.** The tokens of your session. A hand-off to another agent costs a full explanation; one long session costs compaction and drift. Delegate only work that is independent, parallel and verifiable. Continue unfinished work in the same session; a later session starts from the volume and the memory.
- **Infrastructure.** Quota slots and running compute. Defaults for a person: 5 workspaces, 2 environments, 5 capsules, 20 snapshots, 100 GB of disk. Idle stops are automatic (a desk and its workspaces after 30 minutes without use, its environment 5 minutes later when no other awake desk uses it), so manage slots and storage, not uptime.
- **Storage.** Each clone and each snapshot is copy-on-write: free at birth, it grows as it diverges. A stopped workspace still counts its disk and its slot, so it is a pause, not a place to keep work. Delete what you will not use again (convention 10).

## What to do, and what it costs

| You want to | Do | It costs |
|---|---|---|
| Run one command cleanly | `capsule` `create` with `from_workspace` or `from_snapshot` | 1 capsule slot for its lifetime; nothing after |
| Test this exact state, uncommitted work included | `capsule` `create` with `from_workspace` | 1 capsule slot; the workspace is not touched |
| Keep a server up while you work | `exec` with `detach: true`; check it with `status` each turn | Nothing more; it ends with the workspace |
| Guard against a forgotten resource | `ttl_secs` on `workspace`, `env` or `desk` `create`; restore, then `ttl` in the same turn | Nothing; a backstop only (convention 11) |
| Edit and run code against real services | A workspace in a desk that is connected to the environment | 1 workspace slot; storage grows with the home |
| Test a change with real traffic, without a deploy | `intercept` `start` to your workspace | Each desk on that environment sees it: say so first, stop it when done |
| Try N approaches at one time | N clones of one base (`workspace` `create` with `source`), or N capsules; one session coordinates | N slots while they run; delete the losers, keep the winner |
| Break data or services freely | `env` `create` with `source`, then `desk` `connect` to the copy | A full environment slot (2 by default); delete the copy after |
| Keep a ready toolchain | `workspace` `snapshot` with a `volume` name, a `description`, `labels` and a `message` (the first commit makes `base`), then `delete`; later `workspace` `restore` from `name@base` | 1 snapshot slot and the storage of the difference |
| Point `base` at another commit | `volume` `branch` with `branch: "base"` and the `version` | Nothing; the commit that `base` left starts its 30 days |
| Pause inside a session | `workspace` `stop`, or `desk` `stop` | Storage and the slot; it is not an end state |
| Leave unfinished work for a later session | `workspace` `snapshot` with `branch: "wip-<topic>"` and a `message` that says what is left, `memory` `write` with `name@wip-<topic>` in `open-work`, then `workspace` `delete` | 1 snapshot slot and the storage of the difference |
| Repeat work without a person | `pipeline` `save`, with a schedule or a webhook (`references/pipelines.md`) | The capsules of each job of each run |
| Hand work to another agent | Commit, or write `REPORT.md` and snapshot the workspace, then delete it | The context to read the report; no live context is shared |

## Agent types and topologies

An agent is a session. There are two types. Which one you are is decided by capability, not by host: if you hold a tool that starts another agent, you are a Coordinator and may delegate; if you hold none, read "When you cannot delegate" below. `references/permissions.md` gives each tool action for each type. Each agent also runs on a model class that fits its work: the Coordinator on a strong model, Workers with a clear brief on a standard or light one, and deep design in a separate agent on the most capable model, as `references/models.md` says.

- **Coordinator.** Talks to the user, owns the plan and the three budgets, picks the topology, starts and stops Workers. Creates and deletes workspaces, environments and desks. It is the only agent that makes a declared, shared artifact: a named volume and its `base` branch, a team environment, a saved pipeline with a trigger. After it delegates, it does not edit or run code: it reads the Worker's artifact first (report, diff, test output), opens one file only to check one claim, and when it wants a command run, it asks a Worker or a capsule for the exit code and the end of the log.
- **Worker.** One session with the resources that it created or that the brief names. Full freedom inside that scope, nothing outside it. It ends with persist, then delete: unfinished work goes to git, or to the branch that its brief names, first. It leaves `REPORT.md` (`references/worker-templates.md`). A Worker can start sub-Workers with four limits: only in a clone of its own workspace; the same scope, never wider; the report comes back as an artifact; one level deep. A new environment or a new desk comes from the Coordinator.

Topologies. **Solo:** one session, one workspace; the default. **Conductor:** one session drives many workspaces or capsules that need no memory of each other (parallel experiments, a test matrix). **Delegation:** the Coordinator gives each Worker its own workspace and a brief; the work is independent, parallel and verifiable, and the hand-off is an artifact. **Pipeline:** the work repeats or follows an event; make a proven Worker workflow a saved pipeline.

**Plan centrally, execute in parallel.** When work is split, the Coordinator first writes one plan file with the contracts between the streams: names, fields, arguments, limits, and who owns which files. It puts the file in the base workspace, makes one clone of the base for each Worker, and gives each Worker a brief that names its files and its "done". Workers never negotiate with each other; a gap in the contract goes back to the Coordinator. The Coordinator integrates the results in a fixed order and runs the whole test set once. Then it ends the session as convention 16 says. `references/planning.md` gives the method and a template of the plan file.

You make the plan and you execute it: say the topology in one line, then build it. When no use case fits, compose from the primitives: a snapshot is a commit of a whole machine or a whole system, a branch is a name that follows your commits, an intercept is a swap of one service for live code, a capsule is a function call with a file system. Ask what becomes possible when these cost almost nothing, and leave only what a person can read.

## When you cannot delegate

A session with no tool that starts another agent is the Coordinator and does the Worker's work itself. It holds both columns of `references/permissions.md`; the human gate for what cannot be undone stays.

1. **Topologies.** Solo, Conductor and Pipeline work as written. Delegation is out: do not plan work for Workers that cannot exist, and do not wait for a report that nobody will write.
2. **Parallel work.** Capsules, detached processes and pipelines still run in parallel. One context thinks, so keep the plan short and finish one thing before the next.
3. **Context and hand-off to yourself.** Nobody else absorbs noise: push a long or noisy run into a capsule or a detached process and take back only the exit code and the end of the log. Write the brief before the work and `REPORT.md` at the end anyway: they carry the work across compaction, and inside the snapshot into a later session.

## Device workspaces

A device workspace runs on the person's own Mac, in an operating system sandbox, and its folder is an ordinary folder there. `workspace` with `action: "create"` and `device` (an id `dev-…` from the `devices` tool) makes one in the desk; without `device` the workspace is a cloud one. The device must be online and active in the desk's team; when it is not, hand the person `kode start` or `kode devices connect TEAM`: you have no shell on the Mac and cannot start its service. It reaches the desk's environment only through `KD_ENV_{SERVICE}_{PORT}` (set to `127.0.0.1:{port}`), never by a service name. A device snapshot (`dsnap-…`) lives on that Mac and is not a storage commit: it has no `name@N`, no branch and no label, so invariants 3 and 4 and the memory's volume list are about cloud workspaces. `references/devices.md` gives the sandbox, the access names and the limits; read it before you create one.

## Hosts

`references/setup.md` has a row for each host (Claude Code with the plugin, an MCP client with `kode mcp`, a remote connector, the Kode runtime) with the tools that it serves. A call acts in the desk named by its `desk` argument (id or name); a door refuses a call without it. `team` names which of the teams you connected. Only the harness drives one fixed desk, which it supplies itself: its agents pass no `desk`, `workspace` `create` always lands in that desk, and a task that needs another desk is for the user to open. In the Kode runtime the main desk is the Coordinator, a workspace desk is a Worker and a subagent desk is its sub-Worker; the role skills give their tools. Use a tool, not a command. Two things have no tool: connecting a provider (the web console) and `kode env`, the tunnel to the laptop. For those, give the user the exact command, or run it only on a host with a shell.

## How to work

1. **Orient first.** Follow convention 15, then `desk` `list`, `workspace` `list` (the owner's workspaces; `thisDesk` marks this desk's) and `env` `get` of the desk's environment, before any create. Say in one line what exists.
2. **Scope is this desk.** The tools reach everything of the owner; a task is about this desk's workspaces and environment unless the person names another object. Outside the desk, act only on an explicit name or id.
3. **Reuse for the same job; clone for isolation.** Inside a session, a workspace that holds the repo, an environment that runs the app, a desk on it: use them. Create what is missing, and clone when the work must not disturb the original. Name each object in the answer.
4. **Derive the set-up from the repository.** Read `docker-compose.yml`, `.env.example`, `README`, `Procfile`, `package.json`, `go.mod`, `pyproject.toml`, `Cargo.toml`: they give services, ports, variables and packages. Ask the user only what the repo does not say (which registry, which environment to share).
5. **Wait with `wait: true`.** Create, start, restore and `run` start take `wait: true` and answer when the object has settled, or at `soft_ms` with `{promoted: true, id, kind, poll_after_ms}`: then call the `wait` action of the `kind` tool (`desk`: `get`), and for `kind: "process"` loop `process` `wait`. A `wait` that answers `timed_out: true` is called again. A `failing` service needs its `message` and a fix, not more waiting. `references/tools.md` gives the protocol and the limits.
6. **Packages are tools; services belong in the environment.** No database, queue or broker in a workspace. `references/services.md` gives image, ports and mounts.
7. **Service data.** A service that writes data gets a mount in the same call that creates it. A service without `mounts` loses its data on each restart, and data written before a mount is lost. Example: `{"name": "db", "image": "postgres:16", "ports": [5432], "mounts": [{"folder": "pg-data", "path": "/var/lib/postgresql/data"}]}`. A service that keeps all its data in another service needs none: say so.
8. **Processes.** Run a dev server detached (`exec` with `detach: true`). Read it with `process` `output`. Confirm that it listens on its port before an intercept. `process` `kill` stops it when done. At most 32 processes. A crash, a workspace restart or stop and a change of the environment's state arrive as `notices` after the answer of a later tool call, so do not poll for them. An exited process is never restarted; a detached one killed by a workspace stop is relaunched unless the `exec` passed `relaunch: false`. `references/tools.md` gives the states and the notice protocol.
9. **Intercept etiquette.** In an environment of your own, intercept freely. In a shared environment, say which service you take before you take it, one workspace per service, and stop it when done. Copy the environment for data changes, risky migrations and experiments ("Pick the shape", 4).
10. **Code in and out.** Clone over HTTPS through the owner's connector; never put a token in a URL. A push from a workspace goes to github.com with the person's linked GitHub account and a connector that may write. When a push is refused (`link your GitHub account to push: …`, `connector {name} can only read`), tell the person and leave the work on a `wip-` branch (convention 8). Do not look for another credential.
11. **Task board.** When the `task` tool is present, it is how the person follows the work: `add` a task for each step of the plan, set it `running` before you start it and `done`, with `verified`, when its check passed.
12. **Quota and errors.** A `409` that names a limit does not pass on a retry: free something of your own, or report it. A raise is `request_create` with a `reason`, from the Coordinator, and the answer to the user says that it was asked. A pipeline job refused only by the `capsules`, `cpu` or `memoryGb` quota waits up to 30 minutes (`waiting for quota: …`) instead of failing. `references/errors.md` gives the action for each error.
13. **Answer shape.** Result first; then the objects created, removed and kept, each kept one with its state and its reason; then the next step. Never a dump of tool output.
14. **Argument errors.** A call with an argument the action does not take is refused with `unknown argument` and the list the action takes. Read the list, fix the call, and call once more. Do not retry the same call, and do not drop the argument and carry on: the object you get would not be the one you asked for.

## Pick the shape

| Shape | Use when | Build |
|---|---|---|
| 1. One standalone workspace | A library, CLI, script, or a fix that needs no running service | `workspace` `restore` from the project volume (first session: `create` with packages from the repo); clone through the connector |
| 2. One managed workspace, desk, environment | One component that needs real services | `env` `create` with the services (or reuse); a desk on it; the workspace in the desk |
| 3. One managed workspace per component, one desk | A change across `web`, `api` and `worker` | One environment with every service; one desk; a workspace per component; each intercepts its own service |
| 4. Copies | Data changes that can break things, experiments, a second git branch, PR review in a shared environment | `env` `create` with `source` for the environment; `workspace` `create` with `source` for a copy in the desk, one per git branch or approach |

The example app: a shop with `web`, `api`, `worker`, `db` (Postgres) and `cache` (Redis). Ask in order. Does the work need a running service? No: shape 1. How many components change? One: shape 2; several: shape 3. Would it disturb a shared environment, or try several options? Yes: shape 4. Is it a one-time check? Use a capsule, not a workspace. Only a managed workspace reaches the environment, and a clone made in the desk is managed: "two features at once against the services" is two managed workspaces in the desk, the second a clone of the first.

## Tools

The tools act on one desk. Most tools are one per resource: `action` picks the verb. Every code, run, package and image tool takes `workspace`, the id of a `ready` workspace. `references/tools.md` lists every tool with its actions and arguments, and the ids and states of each object; `references/permissions.md` says who may call each action. Tools take the id or the name; write the name to the user. `volume` `get` takes the id or the name; `branch`, `delete_branch` and `describe` take the name. Workspace `restore` takes a reference in `snapshot_id`. Env `create` takes in `source` an environment (cloned live) or a snapshot reference; an environment of that name wins, which is why a volume never has the name of an environment (convention 2). Workspace `create` `source` is a workspace to clone, never a snapshot.

## Reads, lifecycle and deletes

- **What do I have:** the orient calls, plus `env` with `action: "list"`.
- **Status:** `workspace` or `env` with `action: "get"` or `"wait"`. Intercepts in force: `env` `get`, `services[].interceptedBy`.
- **Logs of a service:** `service` with `action: "logs"`, `name`, and `tail`, `since`, `previous` (after a crash). It names the workspace when an intercept holds the service.
- **Start and stop:** `workspace` and `env` with `action: "start"` or `"stop"`. Before restarting a stopped `workspace` or `env`, read `stopped_reason`, `stopped_at` and `hint` from `get`: an `idle` stop starts again on use (a start, a create in the desk or a connect wakes an idle desk), an explicit stop stays stopped. A stop is a pause inside a session (invariant 2). A `snapshot` takes no `wait`: it answers when the commit is ready. `desk` `stop` also stops the bench (the process that serves your own tools in the harness): say so first and make it your last call.
- **Delete:** invariant 5 decides. What you created: persist it if it has value (push, or a commit on a branch of its volume), then the `delete` action of `workspace`, `env`, `capsule` or `snapshot` (a commit that no branch points at and nothing needs), and say what you removed. A volume is not deleted to end a session (invariant 4). What you did not create: list the targets by name and call only when the user named them, or after a yes. A refusal is final.

## Setup and recovery

Act on the symptom you see.

| Symptom | What to do |
|---|---|
| No Kode tool at all (no `desk` or `workspace` under any prefix) | Do not guess and do not call an API. Tell the user the five steps of `references/setup.md`. Never run the installer or the login yourself unless told. |
| A tool answers ``not logged in — run `kode login` `` | Tell the user that command, then to restart the client. |
| ``pass `desk` (id or name)`` | Call `desk` `list`, pass `desk` on every call. |
| `403 your access to TEAM is paused` | A team admin must restore access. Stop. |
