# Tools

Every tool, with its arguments. `workspace` is a `ws-` id of a `ready` workspace, `env` an `env-` id. Lifecycle tools return at once; poll the matching `*_get` tool. Polling: back off 2 s, 4 s, 8 s, 15 s. The `*_wait` tools poll for you (`timeout` seconds, default 300, at most 900).

## Session

| Tool | Arguments | Answers |
|---|---|---|
| `session_current` | none | The session, its team, its environment |
| `session_use` | `team?`, `name?`, `environment?`, `new_environment?` | Picks the session among your sessions in a connected team (laptop door and remote server; not the harness); can connect or create an environment |
| `session_pick` | `id` | Picks the session when several exist (the only tool until then) |
| `session_connect` | `environment` | Connects the session to an environment; releases its intercepts on the old one |
| `session_disconnect` | none | Disconnects from the environment |
| `session_create` | `name`, `team?`, `environment?`, `ttl_secs?` | A new session; `session_use` drives it |
| `session_stop`, `session_start`, `session_delete` | `session` (id, name or `team/name`) | Lifecycle of a session |
| `session_ttl` | `session`, `ttl_secs?` (600..2592000), `clear?` | Sets or removes the unused-time limit; one of the two is required |

## Workspaces

| Tool | Arguments | Answers |
|---|---|---|
| `workspace_list` | `team?` | Workspaces with ids and states |
| `workspace_get` | `workspace` | State, packages, volume, `restart_required` |
| `workspace_create` | `name`, `quota_gb`, `image?`, `packages?`, `team?` | A workspace; managed when a session is picked |
| `workspace_clone` | `workspace`, `name`, `task?` | A standalone copy |
| `workspace_restore` | `name`, `snapshot_id`, `team?`, `image?`, `packages?`, `quota_gb?` | A standalone workspace from a snapshot |
| `workspace_start`, `workspace_stop` | `workspace` | Lifecycle |
| `workspace_delete` | `workspace` | Deletes for good |
| `workspace_snapshot` | `workspace`, `message?`, `volume?` | A snapshot; `volume` names the volume on its first push |
| `worktree_add`, `worktree_drop` | `workspace`, `name` | A second branch checkout inside one workspace |
| `workspace_env_get` | `workspace` | The stored env `{env, restartOnEnvChange}`; a secret shows as its reference |
| `workspace_env_set` | `workspace`, `variables`, `replace?`, `restart_on_change?` | Merges into the env; `replace: true` replaces the whole set; a secret is the whole value `${{ secrets.NAME }}` |
| `workspace_restart` | `workspace` | Restarts to read new variables |
| `workspace_ttl` | `workspace`, `ttl_secs?`, `clear?` | Unused-time limit; one of the two is required |

## Code, run, packages, images

| Tool | Arguments | Answers |
|---|---|---|
| `read` | `workspace`, `paths` | Files with line numbers |
| `write` | `workspace`, `path`, `content` | Creates or overwrites one file |
| `edit` | `workspace`, `files` | Exact text replacements, all or none |
| `patch` | `workspace`, a unified diff | Applies the diff |
| `glob`, `grep` | `workspace`, pattern | Matching files, matching lines |
| `exec` | `workspace`, `cmd`, `cwd?`, `env?`, `detach?`, `head?`, `tail?`, `quiet?` | Output and exit code; with `detach`, a process id |
| `process_list`, `process_output`, `process_write`, `process_kill` | `workspace`, process `id` | Detached processes; output from an offset |
| `watch`, `watch_poll`, `watch_stop` | `workspace` | File or command watch |
| `packages_list`, `packages_add`, `packages_remove`, `packages_update` | `workspace`, `packages` | Package entries `attr` or `attr@version` |
| `container_build` | `workspace`, `tags` | Builds and pushes to the registry connector |
| `container_push` | `workspace`, `src`, `dst` | Copies an image to more names |
| `builder_status` | `team?` | Why a build waits |

## Environments

| Tool | Arguments | Answers |
|---|---|---|
| `env_list` | `team?` | Environments |
| `env_get` | `env` | Services, state, `interceptedBy`, `proxy`, `restart_required`, `volume` |
| `env_wait` | `env`, `timeout?` | Waits until settled; `timedOut: true` at the limit |
| `env_create` | `name`, `services?`, `snapshot_id?`, `quota_gb?`, `team?` | An environment; a service is `{name, image, ports, env, mounts, command}` |
| `env_clone` | `env`, `name`, `snapshot_id?`, `services?`, `quota_gb?` | A copy of the live state or of a snapshot |
| `env_start`, `env_stop`, `env_delete` | `env` | Lifecycle |
| `env_snapshot` | `env`, `message?`, `volume?` | A snapshot |
| `env_restore` | `env`, `snapshot_id`, `discard?` | In-place restore; `409 lost` lists services that lose data |
| `service_add`, `service_update` | `env`, `service` | Adds one service; replaces one by name |
| `service_remove` | `env`, `name` | Removes one service |
| `service_logs` | `env`, `service`, `tail?` (2000 max), `since?` (seconds), `previous?` | Recent logs |
| `service_restart` | `env`, `service` | Restarts one service to read new variables |
| `env_ttl` | `env`, `ttl_secs?`, `clear?` | Unused-time limit; one of the two is required |

## Intercepts and volumes

| Tool | Arguments | Answers |
|---|---|---|
| `intercept` | `env`, `service`, `workspace`, `ports?` `[{service, workspace}]` | Sends the service's traffic to the workspace |
| `release` | `env`, `service` | Gives the service back |
| `volume_list` | `kind?`, `owner?` | Volumes with ids and names |
| `volume_history`, `volume_refs` | `volume` (the id) | Snapshots; branch tips |
| `volume_delete` | `volume` | Deletes a detached volume |
| `snapshot_delete` | `volume`, `snapshot` | Deletes one snapshot |

## Sandboxes

| Tool | Arguments | Answers |
|---|---|---|
| `sandbox_create` | `command` (string or argv), `image?`, `packages?`, `variables?`, `timeout_s?` (10..86400, default 300), `team?`, `from_workspace?`, `from_snapshot?` | A sandbox in the session; its id `sbx-`. It starts empty: clone code in the command |
| `sandbox_get` | `sandbox` | `phase`, `reason`, `exit_code`, `message` |
| `sandbox_wait` | `sandbox`, `timeout?` (max 900) | Waits for `terminated`; `timedOut: true` at the limit |
| `sandbox_logs` | `sandbox`, `tail?` (default 200, max 2000), `head?` | Output; an ended sandbox keeps its last 256 KiB |
| `sandbox_list` | `team?`, `state?`, `q?`, `limit?` | Sandboxes and phases |
| `sandbox_terminate`, `sandbox_delete` | `sandbox` | Ends a running sandbox; removes the record of an ended one |

## Pipelines and runs

| Tool | Arguments | Answers |
|---|---|---|
| `pipeline_list` | `owner` | Pipelines with latest version and triggers |
| `pipeline_get` | `owner`, `pipeline`, `version?` | One definition |
| `pipeline_save` | `owner`, `definition` | A new version; a definition equal to the newest saves nothing |
| `pipeline_versions` | `owner`, `pipeline` | Version numbers |
| `pipeline_version_delete` | `owner`, `pipeline`, `version` | Deletes one old version; `409` for the latest or one a live run reads |
| `pipeline_delete` | `owner`, `pipeline` | Deletes the pipeline; finished runs stay; `409` while a run is live |
| `webhook_rotate` | `owner`, `pipeline` | A new webhook URL, shown once |
| `run_start` | `owner`, `pipeline`, `inputs?`, `version?`, `key?` | A run id; the same `key` answers the first run |
| `run_list` | `owner`, `pipeline?`, `state?`, `limit?` | Runs |
| `run_get` | `owner`, `pipeline`, `run` | State, jobs, `failedStep`, `exitCode` |
| `run_wait` | `owner`, `pipeline`, `run`, `timeout?` (max 900) | Waits for the end |
| `run_logs` | `owner`, `pipeline`, `run`, `job?` (index), `offset?`, `tail?`, `head?` | A page of the job log (without `offset`, only its last 200 lines unless `tail`/`head`); repeat with `offset` = `next` while `complete` is false |
| `run_cancel` | `owner`, `pipeline`, `run` | Cancels a run |

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
