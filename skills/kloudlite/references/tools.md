# Tools

One tool per resource. `action` picks the verb; the arguments below are the union over the actions, and a call that omits one an action needs is refused with that action's schema. `workspace` is a `ws-` id or a name of a `ready` workspace, `env` an `env-` id or a name. Create, start, restore and `run` start take `wait: true` and `soft_ms` (default 25000, 5000 on a remote door; at most 600000): they answer when the object has settled, or with `{promoted: true, id, kind}` at `soft_ms`; call the `wait` action of the tool named by `kind` (`desk`: `get`). A `wait` action takes `timeout_ms` (default 25000, at most 900000) and answers with `timed_out: true` at the limit: call it again. `exec` and `container_build` hand off the same way with kind `process`: loop `process` `wait` with `since` and `since_err` set to the last `next` and `next_err`. A `process` `wait` on an id that ended or never existed answers `state: "gone"`. The loop applies when a `promoted` answer arrives; a client that waits on MCP tasks waits on its own and never sees one.

## Desk

| Tool | Arguments | Answers |
|---|---|---|
| `desk` | `action`, `team?`, `name?`, `environment?`, `ttl_secs?`, `desk?`, `wait?`, `soft_ms?`, `clear?` | `list`: your desks, each with id, name, team, environment. `create` takes `environment` to connect one and moves nothing. `connect` takes `desk` and `environment` (id or name; `null` disconnects). Every other tool's call acts in the desk its `desk` argument names. `start`, `stop`, `delete`, `ttl` (`ttl_secs` 600..2592000, or `clear`). `queue` (read, owner only): the messages waiting for the desk's agents as `{pending, oldest_age_secs, failed}`; `failed` counts those that were dead-lettered after three failed slices |

## Workspaces

| Tool | Arguments | Answers |
|---|---|---|
| `workspace` | `action`, `workspace?`, `name?`, `image?`, `packages?`, `team?`, `source?`, `task?`, `device?`, `snapshot?`, `access?`, `snapshot_id?`, `ttl_secs?`, `clear?`, `message?`, `volume?`, `wait?`, `soft_ms?`, `timeout_ms?` | `list`, `get` (state, `stopped_reason`, `stopped_at`, `hint` of a stopped one, `restarts`, `packages_missing`, packages, volume, `restart_required`), `create` (`packages` are top-level nixpkgs names such as `python3` or `nodejs_22`, optional `@version`, never nested paths like `python3Packages.x`: install Python libraries with pip; a managed workspace in a desk; with `device` a device workspace on the person's own machine, which must be online and active in this team; with `source` a copy that joins the desk, and for a device workspace `snapshot` names the snapshot to clone), `restore` (from `snapshot_id`), `start`, `stop` (answers the stopped state; `wait: true` waits for stopped, not ready), `restart` (to read new variables; answers the object with `restart`, the new entry of `restarts`, once `restart_required` clears, or `null` and a `hint` at `soft_ms`), `delete`, `wait`, `ttl`, `snapshot` (`volume` names the volume on its first push; answers ready only when restorable, else `promoted`; a restore or create from one not ready yet is 409 `not ready yet`: retry in a few seconds) |
| `workspace_vars` | `action`, `workspace`, `variables?`, `replace?`, `restart_on_change?` | `get`: the stored variables; a secret shows as its reference. `set`: merges; `replace: true` replaces the set; a secret is the whole value `${{ secrets.NAME }}` |
| `worktree` | `action`, `workspace`, `name`, `soft_ms?` | `add` (waits until the tree is cut; pass `tree: "<name>"` to `exec`, `read` and `write`, since its path is not visible from the main tree), `drop`: a second branch checkout inside one workspace |

## Code, run, packages, images

| Tool | Arguments | Answers |
|---|---|---|
| `read` | `workspace`, `paths` | Files with line numbers; a PNG, JPEG, GIF or WebP comes back as an image you see (5 MB at most; a bigger PNG or JPEG is downscaled to fit) |
| `write` | `workspace`, `path`, `content?`, `content_b64?` | Creates or overwrites one file: `content` text, or `content_b64` base64 for a small binary file (10 MiB). To copy a file between workspaces use `transfer` |
| `download` | `workspace`, `path`, `tree?` | `{url, expires_in_secs, size, name}`: a 15-minute link that downloads one file (200 MB at most) in the person's browser, no login. Give the person the `url` |
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
| `env` | `action`, `env?`, `name?`, `services?`, `team?`, `region?`, `source?`, `ttl_secs?`, `clear?`, `message?`, `volume?`, `discard?`, `wait?`, `soft_ms?`, `timeout_ms?` | `list`, `get` (services, state, `stopped_reason`, `stopped_at`, `hint`, `interceptedBy`, `proxy`, `restart_required`, `volume`), `create` (a service is `{name, image, ports, env, mounts, command}`; with `source`: an environment copies it, a snapshot id restores it), `start`, `stop` (answers the stopped state; `wait: true` waits for stopped, not ready), `delete`, `wait` (`timed_out: true` at the limit), `ttl`, `snapshot` (a clone shares its source's volume and history: its snapshots appear there and take the source's volume name), `restore` (overwrites THIS environment in place and creates nothing; for a new one `create` with `source` a snapshot; `source` is the snapshot id; `409 lost` lists services or folders the snapshot does not have, `discard` accepts it; every other service's data is rewound without a 409, so ask the person first) |
| `service` | `action`, `env`, `service?`, `name?`, `restart?`, `tail?`, `since?`, `previous?`, `wait?`, `soft_ms?` | `add` and `update` (`update` merges into the live service by name: fields given replace those fields, absent ones keep their values, `env` merges by key and `{X: null}` removes X; `restart: true` restarts it to read new variables) take `service`; `remove` and `logs` take `name`; `logs` takes `tail` (2000 max), `since` (seconds), `previous` |

## Intercepts and volumes

| Tool | Arguments | Answers |
|---|---|---|
| `intercept` | `action`, `env`, `service`, `workspace?`, `ports?` `[{service, workspace}]`, `wait?`, `soft_ms?` | `start` sends the service's traffic to the workspace (kind `env` when promoted); `stop` gives the service back |
| `volume` | `action`, `volume?`, `kind?`, `owner?` | `list`, `get` (snapshots, `refs` with the newest push under `latest`, and `working`: where each current workspace or environment stands on the volume, with `working_copies` on each snapshot; takes the volume id or the name a snapshot gave it), `delete` (a detached volume) `list` without `owner` holds your personal volumes and every team's; `owner` keeps one scope (a handle: personal only; a team: the team's, your workspaces in it included) |
| `snapshot` | `action`, `volume`, `snapshot` | `delete` one snapshot (`volume` is the name or id) |

## Capsules

| Tool | Arguments | Answers |
|---|---|---|
| `capsule` | `action`, `capsule?`, `command?`, `image?`, `packages?`, `variables?`, `lifetime_s?`, `team?`, `from_workspace?`, `from_snapshot?`, `state?`, `q?`, `limit?`, `tail?`, `head?`, `wait?`, `soft_ms?`, `timeout_ms?` | `create` (`command` string or argv; `lifetime_s` 10..86400, default 300; id `cap-`; starts empty: clone code in the command), `get` (`phase`, `reason`, `exit_code`, `message`), `list`, `wait` (for `terminated`), `logs` (`tail` default 200, max 2000; an ended capsule keeps its last 256 KiB), `delete` (ends a running capsule, then removes the record) |

## Pipelines and runs

| Tool | Arguments | Answers |
|---|---|---|
| `pipeline` | `action`, `owner?`, `pipeline?`, `version?`, `definition?` | `list`, `get` (one definition; without `version`, the pipeline with its versions), `save` (a new version; a definition equal to the newest saves nothing), `delete` (the pipeline; finished runs stay; `409` while any run, finished or live, still reads that version; finished runs are kept 90 days; run numbers continue while runs of that pipeline name exist; with `version`, one old version, `409` for the latest or one a live run reads) |
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
| `status` | `all?` | `notices` not yet shown (`all` lists the last 50, delivered ones included, kept across bench restarts in `~/.kl/notices.json`), `workspaces` (the desk's) and `environment` with their states, running `processes` of those workspaces and any a tool touched. Call it once at the start of each turn |
| `web_fetch`, `web_search` | `url`; `query` | Page text; results |
| `codemode` | `code`, `timeout_ms?` | The value the script returns, else what it printed. `code` is the body of an async JavaScript function; `tools.<name>(args)` calls any other tool you hold and returns a promise of that tool's answer, in the same shape as a direct call (a blocked call or bad arguments reject with an `Error`). Limits: 60 s and 64 MiB by default, `timeout_ms` raises the time to 600000 ms at most; no `fetch`, no filesystem, no timers beyond `setTimeout`; `console.log` is captured |
