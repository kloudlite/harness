# Permissions

Who may call each tool action. **C** is the Coordinator, **W** is a Worker (the `kode` skill, "Agent types and topologies"). One session that works alone holds both roles.

- **Own:** a resource that this session created, or that its brief names, in this desk.
- **Shared:** a team environment, a named base volume, a saved pipeline, or an object that another desk uses.

The one rule behind every row: a Worker may do anything to what it made, and nothing to what it did not. A Coordinator may do anything inside the owner's quota, and asks a person only for what cannot be undone: `env` `restore` in place, the delete of a shared environment or of a named volume, and an intercept on an environment that other people use.

## Reads (each agent, at any time)

| Tool | Actions | Rule |
|---|---|---|
| `status` | none | Call it at the start of each turn |
| `quota` | none | Read it before each fan-out |
| `desk` | `list` | |
| `workspace`, `env` | `list`, `get`, `wait` | |
| `capsule`, `run` | `list`, `get`, `wait`, `logs` | |
| `volume`, `pipeline` | `list`, `get` | |
| `service` | `logs` | |
| `workspace_vars` | `get` | A secret shows as its reference, never as its value |
| `packages` | `list` | |
| `secret_list`, `connector_list`, `devices`, `regions`, `requests_list`, `request_get` | none | Names only; never a secret value |

## Desks

| Action | C | W | Rule |
|---|---|---|---|
| `create` | Yes | No | One desk for one piece of work; give `ttl_secs` |
| `connect` | Yes | No | It changes what each workspace of the desk reaches |
| `start`, `stop`, `ttl` | Yes | Own desk only | A stop keeps each home; a start brings them back |
| `delete` | Yes | No | It deletes each managed workspace of the desk |

## Workspaces

| Action | C | W | Rule |
|---|---|---|---|
| `create` (empty, or a clone with `source`) | Yes | A clone of its own only | Give a name that a person can read and a `task` that says why; call `ttl` in the same turn |
| `restore` | Yes | Yes | It makes a new workspace; the source is not changed |
| `start`, `stop`, `restart`, `ttl` | Yes | Own | Stop unfinished work; never delete it |
| `snapshot` | Yes | Own | The `message` says why. A new named base volume is a declared artifact: the Coordinator names it |
| `delete` | Yes | Own | Persist first: push, snapshot or report |
| `exec`, `process` | Not after it delegates | Own | The Coordinator asks a Worker or a capsule for the exit code and the end of the log |
| `read`, `glob`, `grep`, `watch` | Yes | Own | The Coordinator reads the artifact first (report, diff, test output), then one file for one claim. It does not browse the tree |
| `write`, `edit` | Not after it delegates | Own | A change of code is the Worker's work |
| `transfer`, `download` | Yes | Own | |
| `workspace_vars` `set` | Yes | Own | A secret by reference only |
| `packages` `add`, `remove`, `update` | Yes | Own | nixpkgs first; the home folder only for what nixpkgs lacks |
| `worktree` | No | No | Not used: a second branch is a clone of the workspace |

## Capsules

| Action | C | W | Rule |
|---|---|---|---|
| `create` | Yes | Yes | From its own workspace's files or from a snapshot; give `lifetime_s` |
| `delete` | Yes | Own | It ends a running capsule |

## Environments and services

| Action | C | W | Rule |
|---|---|---|---|
| `env` `create` (services as data, or a clone with `source`) | Yes | No | A clone is a full environment slot; call `ttl` in the same turn |
| `env` `start`, `stop`, `ttl`, `snapshot` | Yes | Own | A snapshot holds the services, their configuration and the data |
| `env` `restore` in place | Yes, after a yes from the person | No | It overwrites the current data |
| `env` `delete` | Yes | Own, never shared | The data stays only in snapshots |
| `service` `add`, `update`, `remove` | Yes | In its own environment only | A service that writes data gets a mount in the call that creates it |
| `intercept` `start`, `stop` | Yes | Its own environment freely; a shared one only when the brief names the service | Say it first on a shared environment; one workspace per service; stop it when done |

## Volumes and snapshots

| Action | C | W | Rule |
|---|---|---|---|
| `snapshot` `delete` | Yes | Own | Refused for the base of a running workspace |
| `volume` `delete` | Yes | No | It removes each snapshot of a detached volume for good |

## Pipelines and runs

| Action | C | W | Rule |
|---|---|---|---|
| `pipeline` `save` | Yes | With the pipeline authoring brief | A saved pipeline is a declared artifact; the Coordinator reads it before it gets a schedule or a webhook |
| `pipeline` `delete`, `webhook_rotate` | Yes | No | The old webhook URL stops at once |
| `run` `start`, `cancel` | Yes | Its own pipelines | |

## Secrets, images and requests

| Action | C | W | Rule |
|---|---|---|---|
| `secret_set` | Yes | Inside its brief | Never repeat the value |
| `secret_delete` | Yes | No | Refused while a reader names it |
| `container_build`, `container_push` | Yes | When the brief says so | An image in a registry is a declared artifact |
| `request_create` | Yes | No | A Worker that meets a limit reports to the Coordinator |
