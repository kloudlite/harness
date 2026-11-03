# Tools

One tool per resource. `action` picks the verb; the arguments below are the union over the actions, and a call that omits one an action needs is refused with that action's schema. `workspace` is a `ws-` id or a name of a `ready` workspace, `env` an `env-` id or a name. Create, start, restore and `run` start take `wait: true` and `timeout` (seconds, default 300, at most 900): they answer when the object has settled, with `timedOut: true` at the limit. The `wait` actions do the same on an existing object.

## Session

| Tool | Arguments | Answers |
|---|---|---|
| `session` | `action`, `team?`, `name?`, `environment?`, `ttl_secs?`, `session?`, `wait?`, `timeout?`, `clear?` | `current`: the session, its team, its environment. `use`: picks the session among yours (laptop door and remote server; not the harness) and connects `environment` (null disconnects). `pick` (laptop door, which also takes `id` and `new_environment`): picks by `id` when several exist. `create`, `start`, `stop`, `delete`, `list`, `ttl` (`ttl_secs` 600..2592000, or `clear`) |

## Workspaces

| Tool | Arguments | Answers |
|---|---|---|
| `workspace` | `action`, `workspace?`, `name?`, `quota_gb?`, `image?`, `packages?`, `team?`, `source?`, `task?`, `snapshot_id?`, `ttl_secs?`, `clear?`, `message?`, `volume?`, `wait?`, `timeout?` | `list`, `get` (state, packages, volume, `restart_required`), `create` (a managed workspace in a session; with `source` a standalone copy), `restore` (from `snapshot_id`), `start`, `stop`, `restart` (to read new variables), `delete`, `wait`, `ttl`, `snapshot` (`volume` names the volume on its first push) |
| `workspace_vars` | `action`, `workspace`, `variables?`, `replace?`, `restart_on_change?` | `get`: the stored variables; a secret shows as its reference. `set`: merges; `replace: true` replaces the set; a secret is the whole value `${{ secrets.NAME }}` |
| `worktree` | `action`, `workspace`, `name` | `add`, `drop`: a second branch checkout inside one workspace |

## Code, run, packages, images

| Tool | Arguments | Answers |
|---|---|---|
| `read` | `workspace`, `paths` | Files with line numbers |
| `write` | `workspace`, `path`, `content` | Creates or overwrites one file |
| `edit` | `workspace`, `files` | Exact text replacements, all or none |
| `glob`, `grep` | `workspace`, pattern | Matching files, matching lines |
| `exec` | `workspace`, `cmd`, `cwd?`, `env?`, `soft_ms?`, `detach?`, `head?`, `tail?`, `quiet?` | Output and exit code; past `soft_ms` (25 s) `promoted: true` and a process `id`; with `detach`, a process id |
| `process` | `action`, `workspace`, `id?`, `max_wait_ms?`, `since?`, `since_err?` | `list`, `output` (from an offset), `write`, `close_stdin`, `kill`; `wait` waits for the exit (20 s at most per call), answers `state`, `exit_code`, the new output and `next`/`next_err`; repeat while `timed_out` |
| `watch` | `action`, `workspace` | `start`, `poll`, `stop`: a file or command watch |
| `packages` | `action`, `workspace`, `packages?` | `list`, `add`, `remove`, `update`: entries `attr` or `attr@version` |
| `container_build` | `workspace`, `tags` | Builds and pushes to the registry connector |
| `container_push` | `workspace`, `src`, `dst` | Copies an image to more names |
| `builder_status` | `team?` | Why a build waits |

## Environments

| Tool | Arguments | Answers |
|---|---|---|
| `env` | `action`, `env?`, `name?`, `services?`, `snapshot_id?`, `quota_gb?`, `team?`, `region?`, `source?`, `ttl_secs?`, `clear?`, `message?`, `volume?`, `discard?`, `wait?`, `timeout?` | `list`, `get` (services, state, `interceptedBy`, `proxy`, `restart_required`, `volume`), `create` (a service is `{name, image, ports, env, mounts, command}`; with `source` a copy of the live state or a snapshot), `start`, `stop`, `delete`, `wait` (`timedOut: true` at the limit), `ttl`, `snapshot`, `restore` (in place; `409 lost` lists services that lose data, `discard` accepts it) |
| `service` | `action`, `env`, `service?`, `name?`, `restart?`, `tail?`, `since?`, `previous?`, `wait?`, `timeout?` | `add` and `update` (replaces by name; `restart: true` restarts it to read new variables) take `service`; `remove` and `logs` take `name`; `logs` takes `tail` (2000 max), `since` (seconds), `previous` |

## Intercepts and volumes

| Tool | Arguments | Answers |
|---|---|---|
| `intercept` | `env`, `service`, `workspace`, `ports?` `[{service, workspace}]`, `wait?`, `timeout?` | Sends the service's traffic to the workspace |
| `release` | `env`, `service` | Gives the service back |
| `volume` | `action`, `volume?`, `kind?`, `owner?` | `list`, `get` (snapshots and branch tips; takes the volume id), `delete` (a detached volume) |
| `snapshot` | `action`, `volume`, `snapshot` | `delete` one snapshot |

## Sandboxes

| Tool | Arguments | Answers |
|---|---|---|
| `sandbox` | `action`, `sandbox?`, `command?`, `image?`, `packages?`, `variables?`, `timeout_s?`, `team?`, `from_workspace?`, `from_snapshot?`, `state?`, `q?`, `limit?`, `tail?`, `head?`, `wait?`, `timeout?` | `create` (`command` string or argv; `timeout_s` 10..86400, default 300; id `sbx-`; starts empty: clone code in the command), `get` (`phase`, `reason`, `exit_code`, `message`), `list`, `wait` (for `terminated`), `logs` (`tail` default 200, max 2000; an ended sandbox keeps its last 256 KiB), `delete` (ends a running sandbox, then removes the record) |

## Pipelines and runs

| Tool | Arguments | Answers |
|---|---|---|
| `pipeline` | `action`, `owner`, `pipeline?`, `version?`, `definition?` | `list`, `get` (one definition; without `version`, the pipeline with its versions), `save` (a new version; a definition equal to the newest saves nothing), `delete` (the pipeline; finished runs stay; `409` while a run is live; with `version`, one old version, `409` for the latest or one a live run reads) |
| `webhook_rotate` | `owner`, `pipeline` | A new webhook URL, shown once |
| `run` | `action`, `owner`, `pipeline?`, `run?`, `inputs?`, `version?`, `key?`, `state?`, `limit?`, `job?`, `offset?`, `tail?`, `head?`, `wait?`, `timeout?` | `start` (a run id; the same `key` answers the first run), `list`, `get` (state, jobs, `failedStep`, `exitCode`), `wait` (the end), `logs` (a page of the job log; without `offset` only its last 200 lines unless `tail`/`head`; repeat with `offset` = `next` while `complete` is false), `cancel` |

## Secrets and connectors

| Tool | Arguments | Answers |
|---|---|---|
| `secret_set` | `owner`, `name`, `value`, `mine?` | Stores the value; the result never carries it |
| `secret_list` | `owner`, `mine?` | Names and dates, never values |
| `secret_delete` | `owner`, `name`, `mine?` | Deletes; `409` names the readers |
| `connector_list` | `owner?` | Code hosts and registries connected |

## Account and web

| Tool | Arguments | Answers |
|---|---|---|
| `quota` | `owner?` | Ceilings and use |
| `regions` | none | Regions |
| `requests_list`, `request_get`, `request_create` | `owner?`, `id`, `kind`, `reason` | Requests to an admin |
| `web_fetch`, `web_search` | `url`; `query` | Page text; results |
