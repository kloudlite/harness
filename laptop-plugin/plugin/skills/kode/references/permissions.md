# Permissions

Who may call each tool action. **C** is the coordinator, **W** is a worker (the `kode` skill, "Agent types and topologies"). One session that works alone holds both roles.

- **Own:** for the coordinator, what it created in this desk; for a worker, the workspaces its task lists and what it starts on them (processes, capsules, intercepts).
- **Shared:** a team environment, a named volume and its branches, a saved pipeline, or an object that another desk uses.

The runtime enforces the worker column for a worker with a brief: each **No** is refused (`{tool} {action} is the coordinator's; ask it with report need`), and so is a **Listed** action on a workspace off its list. **Own** and **When the task says so** are practice, which the runtime cannot judge. The column keeps what many sessions start from in one pair of hands.

The one rule behind every row: a worker may do anything its task needs on its listed workspaces, and leaves the lifecycle of workspaces and environments to the coordinator. The coordinator may do anything inside the owner's quota, and asks a person only for what cannot be undone: `env` `restore` in place, the delete of a shared environment or of a volume, and an intercept on an environment that other people use.

## Reads (each agent, at any time)

| Tool | Actions | Rule |
|---|---|---|
| `status` | none | Call it at the start of each turn |
| `quota` | none | Read it before each fan-out |
| `desk` | `list` | |
| `workspace`, `env` | `list`, `get`, `wait` | |
| `capsule`, `run` | `list`, `get`, `wait`, `logs` | |
| `volume`, `pipeline` | `list`, `get` | |
| `memory` | `read`, `list` | Read it first in a new session: it names the volumes and the branch to start from |
| `service` | `logs` | |
| `workspace_vars` | `get` | A secret shows as its reference, never as its value |
| `packages` | `list` | |
| `secret_list`, `connector_list`, `devices`, `regions`, `requests_list`, `request_get` | none | Names only; never a secret value |

## Desks

| Action | C | W | Rule |
|---|---|---|---|
| `create` | Yes | No | One desk for one piece of work; give `ttl_secs` |
| `connect` | Yes | No | It changes what each workspace of the desk reaches |
| `start`, `stop`, `ttl` | Yes | No | A stop keeps each home; a start brings them back. It is a pause inside a session |
| `delete` | Yes | No | It deletes each managed workspace of the desk |

## Workspaces

| Action | C | W | Rule |
|---|---|---|---|
| `create` (empty, or a clone with `source`) | Yes | No | Give a name that a person can read, a `task` that says why and `ttl_secs`. An empty workspace is for the first session of a project |
| `restore` | Yes | No | It makes a new workspace from `name@base`, or from the branch that `open-work` names, and checks it out; `name` is required; call `ttl` in the same turn |
| `start`, `stop`, `ttl` | Yes | No | A stop is a pause inside a session. Before the session ends, push, then delete: a plain `delete` takes no snapshot; `save: true` only when the environment changed |
| `snapshot` | Yes | Listed, only when asked, with `branch` set to the branch that the task names (never `base`); without `volume`, `labels` and `description` | The `message` (required) says what changed and whether it is good. Naming a new volume, its `labels` and moving `base` are the coordinator's. A Worker in a clone under a plan file does not snapshot: the clone is detached, and its commit would sit on the base volume with no branch |
| `delete` | Yes | No | Push or report first. A code change alone is no reason for a volume commit: code reaches the next session through git (pushed to origin, unfinished work on a git branch; the next workspace pulls it). It takes no snapshot by default; `save: true` (from the clean merged default branch with a passing build) only when the environment changed; it refuses, naming the difference, when packages, image or variables changed since the base: `save: true` or `skip_snapshot: true`. No workspace stays between sessions |
| `restart` | Yes | Listed | To read new variables |
| `exec`, `process` | On a workspace no worker holds | Listed | The coordinator asks a worker or a capsule for the exit code and the end of the log |
| `read`, `glob`, `grep`, `watch` | Yes | Listed | The coordinator reads the artifact first (report, diff, test output), then one file for one claim. It does not browse the tree |
| `write`, `edit` | On a workspace no worker holds | Listed | A change of code is the worker's work |
| `transfer`, `download` | Yes | Listed | |
| `workspace_vars` `set` | Yes | Listed | A secret by reference only |
| `packages` `add`, `remove`, `update` | Yes | Listed | nixpkgs first; the home folder only for what nixpkgs lacks |

## Capsules

| Action | C | W | Rule |
|---|---|---|---|
| `create` | Yes | Yes | From a listed workspace's files or from a snapshot; give `lifetime_s` |
| `delete` | Yes | Own | It ends a running capsule |

## Environments and services

| Action | C | W | Rule |
|---|---|---|---|
| `env` `create` (services as data, or a clone with `source`) | Yes | No | A clone is a full environment slot; call `ttl` in the same turn |
| `env` `start`, `stop`, `ttl`, `snapshot` | Yes | No | A snapshot holds the services, their configuration and the data |
| `env` `restore` in place | Yes, after a yes from the person | No | It overwrites the current data |
| `env` `delete` | Yes | No | The data stays only in snapshots: snapshot first when the data has value |
| `service` `add`, `update`, `remove` | Yes | When the task says so | A service that writes data gets a mount in the call that creates it |
| `intercept` `start`, `stop` | Yes | When the task grants it; a shared environment only when the task names the service | Say it first on a shared environment; one workspace per service; stop it when done |

## Volumes and snapshots

| Action | C | W | Rule |
|---|---|---|---|
| `snapshot` `delete` | Yes | No | Only a commit that no branch points at and nothing needs. Refused for a branch head and for the commit a live workspace was built from. Never the last commit: the volume goes with it |
| `volume` `describe` | Yes | No | It sets the `description` and the `labels` of a named volume. A given value replaces the stored one |
| `volume` `branch`, `delete_branch` | Yes | No | `branch` creates a lane or moves one: forward along its own lane, or back to its own earlier commit in a restore in place after the tail is kept on an `archived-YYYY-MM-DD` branch (convention 9); never onto another lane's commit. `base` goes only onto a state where a build or a test passed. `delete_branch` retires a lane, the owner's call |
| `volume` `rename` | Yes, after a yes from the person | No | Every reference that spells the old name stops resolving. Update `memory` and the notes and scripts that name it in the same session |
| `volume` `delete` | Yes, after a yes from the person | No | It removes each snapshot of a detached volume for good. Never a way to end a session: a volume stays |
| `memory` `write` | Yes | No | It names only what lasts: volumes (name, contents, labels, the branch to start from), repositories, how to run, conventions, open work with its branch. Never a workspace, a desk or a running environment |

## Pipelines and runs

| Action | C | W | Rule |
|---|---|---|---|
| `pipeline` `save` | Yes | With the pipeline authoring task | A saved pipeline is a declared artifact; the coordinator reads it before it gets a schedule or a webhook |
| `pipeline` `delete`, `webhook_rotate` | Yes | No | The old webhook URL stops at once |
| `run` `start`, `cancel` | Yes | Its own pipelines | |

## Secrets, images and requests

| Action | C | W | Rule |
|---|---|---|---|
| `secret_set` | Yes | Inside its task | Never repeat the value |
| `secret_delete` | Yes | No | Refused while a reader names it |
| `container_build`, `container_push` | Yes | When the task says so | An image in a registry is a declared artifact |
| `request_create` | Yes | No | A Worker that meets a limit reports to the coordinator |
