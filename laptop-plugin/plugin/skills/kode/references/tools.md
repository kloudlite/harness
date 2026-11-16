# Tools

One tool per resource. `action` picks the verb; the arguments below are the union over the actions, and a call that omits one an action needs is refused with that action's schema. `workspace` is a `ws-` id or a name of a `ready` workspace, `env` an `env-` id or a name. Create, start, restore and `run` start take `wait: true` and `soft_ms` (default 25000, 5000 on a remote door; at most 600000): they answer when the object has settled, or with `{promoted: true, id, kind}` at `soft_ms`; call the `wait` action of the tool named by `kind` (`desk`: `get`). A `wait` action takes `timeout_ms` (default 25000, at most 900000) and answers with `timed_out: true` at the limit: call it again. `exec` and `container_build` hand off the same way with kind `process`: loop `process` `wait` with `since` and `since_err` set to the last `next` and `next_err`. A `process` `wait` on an id that ended or never existed answers `state: "gone"`. The loop applies when a `promoted` answer arrives; a client that waits on MCP tasks waits on its own and never sees one.

## Ids and states

| Object | Id starts with | States |
|---|---|---|
| Workspace | `ws-` | `creating`, `ready`, `stopped`, `error`, `deleted` |
| Environment | `env-` | `creating`, `running`, `stopped`, `error`, `deleted` |
| Desk | `desk-` | `running`, `starting`, `idle`, `stopped` |
| Capsule | `cap-` | `phase`: `pending`, `starting`, `running`, `terminated`; with `reason` `Exited`, `exit_code` is the result |

Get ids from the `list` actions of `workspace` and `env`, or from `desk` `list`. Tools take the id or the name. A volume reference is `name@<branch>` (`shop-base@base`), `name@N` (a storage commit), `name@latest` (the newest commit), `name` (its `base` branch, else its newest commit), or a snapshot id; a branch reference checks the branch out, the others are detached; workspace `restore` takes one in `snapshot_id`, env `create` in `source`, a capsule in `from_snapshot`. A desk goes `idle` after 30 minutes without use, and its workspaces stop; a start, a create in the desk or a connect wakes it, and the next tool answer reports each workspace restart and stop that happened while idle. What the user stopped stays stopped.

## Desk

| Tool | Arguments | Answers |
|---|---|---|
| `desk` | `action`, `team?`, `name?`, `environment?`, `ttl_secs?`, `desk?`, `wait?`, `soft_ms?`, `clear?` | `list`: your desks, each with id, name, team, environment. `create` takes `environment` to connect one and moves nothing. `connect` takes `desk` and `environment` (id or name; `null` disconnects). Every other tool's call acts in the desk its `desk` argument names. `start`, `stop`, `delete`, `ttl` (`ttl_secs` 600..2592000, or `clear`) |

## Workspaces

| Tool | Arguments | Answers |
|---|---|---|
| `workspace` | `action`, `workspace?`, `name?`, `image?`, `packages?`, `team?`, `source?`, `task?`, `device?`, `snapshot?`, `access?`, `snapshot_id?`, `ttl_secs?`, `clear?`, `message?`, `volume?`, `description?`, `labels?`, `branch?`, `wait?`, `soft_ms?`, `timeout_ms?` | `list`, `get` (state, `stopped_reason`, `stopped_at`, `hint` of a stopped one, `restarts`, `packages_missing`, packages, volume, `restart_required`), `create` (`packages` are top-level nixpkgs names such as `python3` or `nodejs_22`, optional `@version`, never nested paths like `python3Packages.x`: Python libraries go in through `uv` (`packages` `add` `uv`, then `uv venv .venv && uv pip install <lib>`); a managed workspace in a desk; with `device` a device workspace on the person's own machine, which must be online and active in this team; with `source` a copy that joins the desk, and for a device workspace `snapshot` names the snapshot to clone; `ttl_secs` sets the TTL in the same call), `restore` (a new workspace from `snapshot_id`, a volume reference such as `shop-base@base`, which checks out `base`; `name` is required; it takes no `task` and no `ttl_secs`: restore, then `ttl` in the same turn), `start`, `stop` (answers the stopped state; `wait: true` waits for stopped, not ready), `restart` (to read new variables; answers the object with `restart`, the new entry of `restarts`, once `restart_required` clears, or `null` and a `hint` at `soft_ms`), `delete`, `wait`, `ttl`, `snapshot` (`volume` names the volume on its first push: always pass it then, or the volume takes the workspace's name; a clone or a restore saves into its source's volume, so drop `volume` there; `description` says what the volume holds and what it is for; `labels` are up to 8 words for finding the volume, such as the project name; a later value of either replaces the stored one; the snapshot is a storage commit that advances the checked-out branch; `branch` puts it on that branch instead, created or moved there, and checks it out (`branch: "wip-auth"`); the answer has `branch` (the branch now at this commit, or null) and `detached` when the checked-out branch had moved since; the first commit of a volume makes `base`; `message` says what changed; it takes no `wait` and answers when the commit is ready) |
| `workspace_vars` | `action`, `workspace`, `variables?`, `replace?`, `restart_on_change?` | `get`: the stored variables; a secret shows as its reference. `set`: merges; `replace: true` replaces the set; a secret is the whole value `${{ secrets.NAME }}` |

## Code, run, packages, images

| Tool | Arguments | Answers |
|---|---|---|
| `read` | `workspace`, `paths` | Files with line numbers; a PNG, JPEG, GIF or WebP comes back as an image you see (5 MB at most; a bigger PNG or JPEG is downscaled to fit) |
| `write` | `workspace`, `path`, `content?`, `content_b64?` | Creates or overwrites one file: `content` text, or `content_b64` base64 for a small binary file (10 MiB). To copy a file between workspaces use `transfer` |
| `download` | `workspace`, `path` | `{url, uri, name, size, mime}` and a `resource_link`: `url` opens one file (200 MB at most) in the Kode console once the person is signed in, and carries no credential; an MCP client reads `uri` with `resources/read` (7.5 MB at most). Give the person the `url` |
| `transfer` | `from`, `to`, `overwrite?` | Copies one file (200 MB at most, any bytes) from `{workspace, path}` to `{workspace, path}`, both yours, possibly the same workspace; the bytes go between the tool servers, never through you. An existing destination is refused unless `overwrite`. Answers `{from, to, bytes}` |
| `edit` | `workspace`, `files` | Exact text replacements, all or none |
| `glob`, `grep` | `workspace`, pattern | Matching files, matching lines |
| `exec` | `workspace`, `cmd`, `cwd?`, `env?`, `soft_ms?`, `detach?`, `head?`, `tail?`, `quiet?`, `notify?` | Output and exit code; past `soft_ms` (a remote door: default 5 s, wait cut at 20 s) `promoted: true`, `kind: "process"`, a process `id` and `poll_after_ms`: call `process` `wait` after it; with `detach`, a process id |
| `process` | `action`, `workspace`, `id?`, `timeout_ms?`, `since?`, `since_err?` | `list`, `output` (from an offset), `write`, `close_stdin`, `kill`; `wait` waits for the exit (20 s at most per call), answers `state`, `exit_code`, the new output and `next`/`next_err`; repeat while `timed_out`; an id that ended or never existed answers `state: "gone"`; one that a workspace restart killed answers `state: "killed_by_restart"` with `restarted_at`; an exited process is never restarted; a detached one killed by a workspace stop is relaunched (same `id`, output opening `[restarted <time>: <reason>]`) unless `exec` passed `relaunch: false`. Any tool answer can carry a second content item `notices: [...]` (crashed or killed processes, workspace restarts and state changes, environment state changes); the first item is the answer or the error alone |
| `watch` | `action`, `workspace` | `start`, `poll`, `stop`: a file or command watch |
| `packages` | `action`, `workspace`, `packages?` | `list` (also `missing`: entries with no binary), `add`, `remove`, `update`: entries `attr` or `attr@version` |
| `container_build` | `workspace`, `tags`, `soft_ms?` | Builds and pushes to the registry connector; past `soft_ms` (remote default 5 s) it hands off like `exec`, kind `process` with `poll_after_ms`; fails with `no_registry` or `unknown_registry` and the connected `registries` |
| `container_push` | `workspace`, `src`, `dst` | Copies an image to more names |

## Environments

| Tool | Arguments | Answers |
|---|---|---|
| `env` | `action`, `env?`, `name?`, `services?`, `team?`, `region?`, `source?`, `ttl_secs?`, `clear?`, `message?`, `volume?`, `description?`, `labels?`, `branch?`, `discard?`, `wait?`, `soft_ms?`, `timeout_ms?` | `list`, `get` (services, state, `stopped_reason`, `stopped_at`, `hint`, `interceptedBy`, `proxy`, `restart_required`, `volume`), `create` (a service is `{name, image, ports, env, mounts, command}`; with `source`: an environment of that name or id is copied live; otherwise a volume reference such as `shop-env@base` or a snapshot id restores it; `ttl_secs` sets the TTL in the same call), `start`, `stop` (answers the stopped state; `wait: true` waits for stopped, not ready), `delete`, `wait` (`timed_out: true` at the limit), `ttl`, `snapshot` (`volume`, `description`, `labels` and `branch` as for a workspace's; a clone shares its source's volume and history: its snapshots appear there and take the source's volume name), `restore` (overwrites THIS environment in place and creates nothing; for a new one `create` with `source` a snapshot; `source` is the snapshot id; `409 lost` lists services or folders the snapshot does not have, `discard` accepts it; every other service's data is rewound without a 409, so ask the person first) |
| `service` | `action`, `env`, `service?`, `name?`, `restart?`, `tail?`, `since?`, `previous?`, `wait?`, `soft_ms?` | `add` and `update` (`update` merges into the live service by name: fields given replace those fields, absent ones keep their values, `env` merges by key and `{X: null}` removes X; `restart: true` restarts it to read new variables) take `service`; `remove` and `logs` take `name`; `logs` takes `tail` (2000 max), `since` (seconds), `previous` |

## Intercepts and volumes

| Tool | Arguments | Answers |
|---|---|---|
| `intercept` | `action`, `env`, `service`, `workspace?`, `ports?` `[{service, workspace}]`, `wait?`, `soft_ms?` | `start` sends the service's traffic to the workspace (kind `env` when promoted); `stop` gives the service back |
| `volume` | `action`, `volume?`, `kind?`, `owner?`, `label?`, `description?`, `labels?`, `branch?`, `version?`, `snapshot?` | `list` (`label` keeps only the volumes that carry it; each named row has `description`, `labels` and `branches`, a map of each branch to its commit number; `deleted: true` means no live working copy, the volume and its commits are intact), `get` (`description`, `labels` and `branches` of a named volume, its storage commits with the branches on each, `refs` with the newest push under `latest`, and `working`: where each current workspace or environment stands on the volume, with `working_copies` on each snapshot; takes the volume id or the name a snapshot gave it), `describe` (sets `description` and `labels` of the volume named `volume`, the given name; a given field replaces, `description: ""` and `labels: []` clear, one of the two is required; `owner` defaults to the desk's team; answers the volume), `branch` (creates `branch` at one commit of the volume named `volume`, or moves it there, like `git branch -f`: give `version` (the commit number) or `snapshot`; a branch head does not expire and cannot be deleted; `name@<branch>` then works wherever `name@N` does; not a number, not `latest`, at most 16 on a volume), `delete_branch` (removes `branch`; the commit that it left expires 30 days later), `delete` (a detached volume with every snapshot, for good; never to end a session). `list` without `owner` holds your personal volumes and every team's; `owner` keeps one scope (a handle: personal only; a team: the team's, your workspaces in it included) |
| `snapshot` | `action`, `volume`, `snapshot` | `delete` one snapshot (`volume` is the name or id); `409` for a commit that is the head of a branch (move or delete the branch first) and for the one a live workspace or environment was built from or last pushed. The volume goes with its last snapshot |

## Capsules

| Tool | Arguments | Answers |
|---|---|---|
| `capsule` | `action`, `capsule?`, `command?`, `image?`, `packages?`, `variables?`, `lifetime_s?`, `team?`, `from_workspace?`, `from_snapshot?`, `state?`, `q?`, `limit?`, `tail?`, `head?`, `wait?`, `soft_ms?`, `timeout_ms?` | `create` (`command` string or argv; `lifetime_s` 10..86400, default 300; id `cap-`; starts empty: clone code in the command, or start from `from_workspace` or `from_snapshot`, a volume reference such as `shop-base@base`), `get` (`phase`, `reason`, `exit_code`, `message`), `list`, `wait` (for `terminated`), `logs` (`tail` default 200, max 2000; an ended capsule keeps its last 256 KiB), `delete` (ends a running capsule, then removes the record) |

## Pipelines and runs

| Tool | Arguments | Answers |
|---|---|---|
| `pipeline` | `action`, `owner?`, `pipeline?`, `version?`, `definition?` | `list`, `get` (one definition; without `version`, the pipeline with its versions), `save` (a new version; a definition equal to the newest saves nothing), `delete` (the pipeline: `409` while a run is queued or running; finished runs stay 90 days, and run numbers continue while runs of that pipeline name exist; with `version`, one old version: `409` for the latest and for one that any kept run, finished included, recorded) |
| `webhook_rotate` | `owner?`, `pipeline` | A new webhook URL, shown once |
| `run` | `action`, `owner?`, `pipeline?`, `run?`, `inputs?`, `version?`, `key?`, `state?`, `limit?`, `job?`, `offset?`, `tail?`, `head?`, `wait?`, `soft_ms?`, `timeout_ms?` | `start` (a run id; the same `key` answers the first run), `list`, `get` (state, jobs, `failedStep`, `exitCode`), `wait` (the end), `logs` (a page of the job log; without `offset` only its last 200 lines unless `tail`/`head`; repeat with `offset` = `next` while `complete` is false), `cancel` |

## Secrets and connectors

| Tool | Arguments | Answers |
|---|---|---|
| `secret_set` | `owner?`, `name`, `value`, `mine?` | Stores the value; the result never carries it. The agent can set, list and delete secrets; a value is never read back |
| `secret_list` | `owner?`, `mine?` | Names and dates, never values |
| `secret_delete` | `owner?`, `name`, `mine?` | Deletes; `409` names the readers |
| `connector_list` | `owner?` | Code hosts and registries connected |

## Account and web

| Tool | Arguments | Answers |
|---|---|---|
| `quota` | `owner?` | Ceilings and use |
| `regions` | none | Regions |
| `devices` | none | The person's machines: `id` (`dev-…`, the `device` of `workspace` create), name, os, `online`, `enabled`, `account`, and the workspaces each reports. Read only |
| `requests_list`, `request_get`, `request_create` | `owner?`, `id`, `kind`, `reason` | Requests to an admin |
| `status` | `all?` | `notices` not yet shown (`all` lists the last 50, delivered ones included, kept in `~/.kd/notices.json` across restarts of the bench, the process that serves your tools in the harness), `workspaces` (the desk's) and `environment` with their states, running `processes` of those workspaces and any a tool touched. Call it once at the start of each turn |
| `task` | `action`, `id?`, `title?`, `state?`, `note?`, `summary?`, `verified?`, `priority?`, `depends_on?`, `workspace?` | Your task board, which the person follows: `list`, `add` (needs `title`), `update` (the task `id`; `state` is `queued`, `running`, `blocked`, `done` or `failed`). Set a task `running` before you start it and `done`, with `verified` (the check that passed and its result), as soon as its check passes. Not every host serves it |
| `memory` | `action`, `owner?`, `project?`, `section?`, `scope?`, `content?`, `edits?`, `if_version?`, `delete?` | Project memory: the current structure of a project (sections `environments`, `volumes`, `run`, `conventions` of the team; `open-work` yours), written for a cold start. `read` (a section, or all merged with your `open-work`), `write` (a patch: `edits` of find and replace with `if_version` from your read; `content` only for a new section with `if_version` 0; `delete` removes one; a `409` answers the current text: merge, write again), `list`. Markdown, at most 16 KiB a section. It says what is, never what happened. Every tool answer carries `memory: {rev, changed}`; `changed: true` means that another session wrote it: read it again. Only a Coordinator writes |
| `web_fetch`, `web_search` | `url`; `query` | Page text; results |
| `codemode` | `code`, `timeout_ms?` | The value the script returns, else what it printed. `code` is the body of an async JavaScript function; `tools.<name>(args)` calls any other tool you hold and returns a promise of that tool's answer, in the same shape as a direct call (a blocked call or bad arguments reject with an `Error`). Limits: 60 s and 64 MiB by default, `timeout_ms` raises the time to 600000 ms at most; no `fetch`, no filesystem, no timers beyond `setTimeout`; `console.log` is captured |
