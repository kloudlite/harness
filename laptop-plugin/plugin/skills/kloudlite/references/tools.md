# Tools

One tool per resource. `action` picks the verb; the arguments below are the union over the actions, and a call that omits one an action needs is refused with that action's schema. `workspace` is a `ws-` id or a name of a `ready` workspace, `env` an `env-` id or a name. Create, start, restore and `run` start take `wait: true` and `soft_ms` (default 25000, at most 600000): they answer when the object has settled, or with `{promoted: true, id, kind}` at `soft_ms`; call the `wait` action of the tool named by `kind` (`session`: `get`). A `wait` action takes `timeout_ms` (default 25000, at most 900000) and answers with `timed_out: true` at the limit: call it again. `exec` and `container_build` hand off the same way with kind `process`: loop `process` `wait` with `since` and `since_err` set to the last `next` and `next_err`. A `process` `wait` on an id that ended or never existed answers `state: "gone"`.

## Session

| Tool | Arguments | Answers |
|---|---|---|
| `session` | `action`, `team?`, `name?`, `environment?`, `ttl_secs?`, `session?`, `wait?`, `soft_ms?`, `clear?` | `current`: the session, its team, its environment. `use`: picks the session among yours (laptop door and remote server; not the harness) and connects `environment` (null disconnects). `pick` (laptop door, which also takes `id` and `new_environment`): picks by `id` when several exist. `create`, `start`, `stop`, `delete`, `list`, `ttl` (`ttl_secs` 600..2592000, or `clear`). `queue` (read, owner only): the messages waiting for the session's agents as `{pending, oldest_age_secs, failed}`; `failed` counts those that were dead-lettered after three failed slices |

## Workspaces

| Tool | Arguments | Answers |
|---|---|---|
| `workspace` | `action`, `workspace?`, `name?`, `quota_gb?`, `image?`, `packages?`, `team?`, `source?`, `task?`, `snapshot_id?`, `ttl_secs?`, `clear?`, `message?`, `volume?`, `wait?`, `soft_ms?`, `timeout_ms?` | `list`, `get` (state, `restarts`, `packages_missing`, packages, volume, `restart_required`), `create` (a managed workspace in a session; with `source` a standalone copy), `restore` (from `snapshot_id`), `start`, `stop` (answers the stopped state; `wait: true` waits for stopped, not ready), `restart` (to read new variables; answers the object with `restart`, the new entry of `restarts`, once `restart_required` clears, or `null` and a `hint` at `soft_ms`), `delete`, `wait`, `ttl`, `snapshot` (`volume` names the volume on its first push) |
| `workspace_vars` | `action`, `workspace`, `variables?`, `replace?`, `restart_on_change?` | `get`: the stored variables; a secret shows as its reference. `set`: merges; `replace: true` replaces the set; a secret is the whole value `${{ secrets.NAME }}` |
| `worktree` | `action`, `workspace`, `name`, `soft_ms?` | `add` (waits until the tree is cut; pass `tree: "<name>"` to `exec`, `read` and `write`, since its path is not visible from the main tree), `drop`: a second branch checkout inside one workspace |

## Code, run, packages, images

| Tool | Arguments | Answers |
|---|---|---|
| `read` | `workspace`, `paths` | Files with line numbers |
| `write` | `workspace`, `path`, `content` | Creates or overwrites one file |
| `edit` | `workspace`, `files` | Exact text replacements, all or none |
| `glob`, `grep` | `workspace`, pattern | Matching files, matching lines |
| `exec` | `workspace`, `cmd`, `cwd?`, `env?`, `soft_ms?`, `detach?`, `head?`, `tail?`, `quiet?`, `notify?` | Output and exit code; past `soft_ms` (25 s; the call answers within it) `promoted: true`, `kind: "process"` and a process `id`; with `detach`, a process id |
| `process` | `action`, `workspace`, `id?`, `timeout_ms?`, `since?`, `since_err?` | `list`, `output` (from an offset), `write`, `close_stdin`, `kill`; `wait` waits for the exit (20 s at most per call), answers `state`, `exit_code`, the new output and `next`/`next_err`; repeat while `timed_out`; an id that ended or never existed answers `state: "gone"`; one that a workspace restart killed answers `state: "killed_by_restart"` with `restarted_at`; an exited process is never restarted; a detached one killed by a workspace stop is relaunched (same `id`, output opening `[restarted <time>: <reason>]`) unless `exec` passed `relaunch: false`. Any tool answer can carry a second content item `notices: [...]` (crashed or killed processes, workspace restarts and state changes, environment state changes); the first item is the answer or the error alone |
| `watch` | `action`, `workspace` | `start`, `poll`, `stop`: a file or command watch |
| `packages` | `action`, `workspace`, `packages?` | `list` (also `missing`: entries with no binary), `add`, `remove`, `update`: entries `attr` or `attr@version` |
| `container_build` | `workspace`, `tags`, `soft_ms?` | Builds and pushes to the registry connector; past `soft_ms` it hands off like `exec`, kind `process`; fails with `no_registry` or `unknown_registry` and the connected `registries` |
| `container_push` | `workspace`, `src`, `dst` | Copies an image to more names |
| `builder_status` | `team?` | Why a build waits: `auto_start`, `idle_since`, `reason` |

## Environments

| Tool | Arguments | Answers |
|---|---|---|
| `env` | `action`, `env?`, `name?`, `services?`, `quota_gb?`, `team?`, `region?`, `source?`, `ttl_secs?`, `clear?`, `message?`, `volume?`, `discard?`, `wait?`, `soft_ms?`, `timeout_ms?` | `list`, `get` (services, state, `interceptedBy`, `proxy`, `restart_required`, `volume`), `create` (a service is `{name, image, ports, env, mounts, command}`; with `source`: an environment copies it, a snapshot id restores it), `start`, `stop` (answers the stopped state; `wait: true` waits for stopped, not ready), `delete`, `wait` (`timed_out: true` at the limit), `ttl`, `snapshot`, `restore` (in place, `source` is the snapshot id; `409 lost` lists services that lose data, `discard` accepts it) |
| `service` | `action`, `env`, `service?`, `name?`, `restart?`, `tail?`, `since?`, `previous?`, `wait?`, `soft_ms?` | `add` and `update` (`update` merges into the live service by name: fields given replace those fields, absent ones keep their values, `env` merges by key and `{X: null}` removes X; `restart: true` restarts it to read new variables) take `service`; `remove` and `logs` take `name`; `logs` takes `tail` (2000 max), `since` (seconds), `previous` |

## Intercepts and volumes

| Tool | Arguments | Answers |
|---|---|---|
| `intercept` | `action`, `env`, `service`, `workspace?`, `ports?` `[{service, workspace}]`, `wait?`, `soft_ms?` | `start` sends the service's traffic to the workspace (kind `env` when promoted); `stop` gives the service back |
| `volume` | `action`, `volume?`, `kind?`, `owner?` | `list`, `get` (snapshots, `refs` with the newest push under `latest`, and `working`: where each current workspace or environment stands on the volume, with `working_copies` on each snapshot; takes the volume id or the name a snapshot gave it), `delete` (a detached volume) |
| `snapshot` | `action`, `volume`, `snapshot` | `delete` one snapshot |

## Sandboxes

| Tool | Arguments | Answers |
|---|---|---|
| `sandbox` | `action`, `sandbox?`, `command?`, `image?`, `packages?`, `variables?`, `lifetime_s?`, `team?`, `from_workspace?`, `from_snapshot?`, `state?`, `q?`, `limit?`, `tail?`, `head?`, `wait?`, `soft_ms?`, `timeout_ms?` | `create` (`command` string or argv; `lifetime_s` 10..86400, default 300; id `sbx-`; starts empty: clone code in the command), `get` (`phase`, `reason`, `exit_code`, `message`), `list`, `wait` (for `terminated`), `logs` (`tail` default 200, max 2000; an ended sandbox keeps its last 256 KiB), `delete` (ends a running sandbox, then removes the record) |

## Pipelines and runs

| Tool | Arguments | Answers |
|---|---|---|
| `pipeline` | `action`, `owner`, `pipeline?`, `version?`, `definition?` | `list`, `get` (one definition; without `version`, the pipeline with its versions), `save` (a new version; a definition equal to the newest saves nothing), `delete` (the pipeline; finished runs stay; `409` while a run is live; with `version`, one old version, `409` for the latest or one a live run reads) |
| `webhook_rotate` | `owner`, `pipeline` | A new webhook URL, shown once |
| `run` | `action`, `owner`, `pipeline?`, `run?`, `inputs?`, `version?`, `key?`, `state?`, `limit?`, `job?`, `offset?`, `tail?`, `head?`, `wait?`, `soft_ms?`, `timeout_ms?` | `start` (a run id; the same `key` answers the first run), `list`, `get` (state, jobs, `failedStep`, `exitCode`), `wait` (the end), `logs` (a page of the job log; without `offset` only its last 200 lines unless `tail`/`head`; repeat with `offset` = `next` while `complete` is false), `cancel` |

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
| `requests_list`, `request_get`, `request_create` | `owner?`, `id`, `kind`, `reason` | Requests to an admin |
| `status` | `all?` | `notices` not yet shown (`all` lists the last 50, delivered ones included, kept across bench restarts in `~/.kl/notices.json`), `workspaces` (the session's) and `environment` with their states, running `processes` of those workspaces and any a tool touched. Call it once at the start of each turn |
| `web_fetch`, `web_search` | `url`; `query` | Page text; results |
| `codemode` | `code`, `timeout_ms?` | The value the script returns, else what it printed. `code` is the body of an async JavaScript function; `tools.<name>(args)` calls any other tool you hold and returns a promise of that tool's answer, in the same shape as a direct call (a blocked call or bad arguments reject with an `Error`). Limits: 60 s and 64 MiB by default, `timeout_ms` raises the time to 600000 ms at most; no `fetch`, no filesystem, no timers beyond `setTimeout`; `console.log` is captured |
