---
name: kloudlite-develop
description: Gives the steps to set up a project on Kloudlite, run code against real services, intercept a service, work on several components or branches at once, and keep state. Use when the user says "set up this repo", "give me a workspace with Postgres", "I need Postgres and Redis", "run my API against the real database", "intercept api", "send real traffic to my code", "debug this with real traffic", "add a feature across api, worker and web", "fix the bug", "try two approaches", "reproduce it without breaking staging", "bump Postgres to 16", "set DATABASE_URL on api", "rotate the DB password", "checkpoint before the refactor", "reset the data", "build and push the image", "stop everything"; or when the Kloudlite tools are present and the task edits code or keeps a process running. Not for a one-time test or check (use kloudlite-verify), not for repeating or triggered work (use kloudlite-automate), not for status, logs or deletes (the kloudlite skill alone). Read the kloudlite skill first.
---

# Develop on Kloudlite

Read the `kloudlite` skill first. It holds the definitions, the shapes and the safety rules; this skill does not repeat them.

Every scenario ends with its cleanup. To check a result, use `kloudlite-verify`. Example app: `web`, `api`, `worker`, `db` (Postgres), `cache` (Redis).

## Scenarios

### 1. Workspace for a repository

**Trigger:** "set up this repo", "give me a workspace for acme/api".
**Shape:** 1.
**Steps:**
1. Orient (`session_current`, `workspace_list`). Reuse a workspace that holds the repo.
2. Read the repo's `package.json`, `go.mod` or `pyproject.toml` for packages. If there is no workspace yet, `workspace_create` {"name": "api", "quota_gb": 20, "packages": ["git", "nodejs@22"]}.
3. `workspace_get` until `ready`.
4. `exec` {"workspace": "ws-…", "cmd": "git clone https://github.com/acme/api .", "quiet": true}. The directory must be empty; else clone into a folder and give `cwd` later.
5. `read` {"workspace": "ws-…", "paths": ["AGENTS.md"]}. Add packages it names with `packages_add`.

**Done when:** the workspace is `ready` and the code is in `~/workspace`.
**If it fails:** `no git connector of OWNER covers HOST/REPO`: the user connects the host in the web console; only `github.com` and the configured GitLab answer. `422` for a package: pick a listed version. `409` with a limit: the `kloudlite` skill, rule 13.
**Then:** scenario 2 if the code needs services.

### 2. Environment from the repository

**Trigger:** "stand up the app's dependencies", "I need Postgres and Redis".
**Shape:** 2.
**Steps:**
1. `env_list`. Reuse an environment that already runs the app.
2. Read `docker-compose.yml`, `.env.example` and the README. List each service, its image, ports and variables. Take mounts from `references/services.md` of the `kloudlite` skill; every service that writes data gets one.
3. A password is a secret. `secret_set` {"owner": "acme", "name": "DB_PASSWORD", "value": "…"} with a value the user gives or approves, never printed, and `owner` the team: an environment reads only the team's secrets.
4. `env_create` {"name": "shop-dev", "quota_gb": 10, "services": [{"name": "db", "image": "postgres:16", "ports": [5432], "env": {"POSTGRES_PASSWORD": "${{ secrets.DB_PASSWORD }}"}, "mounts": [{"folder": "pg-data", "path": "/var/lib/postgresql/data"}]}, {"name": "cache", "image": "redis:7", "ports": [6379]}]}.
5. `env_wait` {"env": "env-…"}.

**Done when:** `env_wait` shows every service ready.
**If it fails:** a service `failing`: read its `message` and `service_logs`, fix with `service_update`, wait again. `422` on a name: errors reference.
**Then:** scenario 3.

### 3. Session that joins them

**Trigger:** "connect my workspace to staging".
**Shape:** 2.
**Steps:**
1. `session_current`. If the session has the environment, go to step 3.
2. `session_connect` {"environment": "env-…"}. To make a session for this work: `session_create` {"name": "orders", "environment": "env-…"}, then `session_use` {"name": "orders"} to drive it. In the harness (no `session_use`; see Hosts in the `kloudlite` skill) you cannot drive another session: tell the user to open it, or use `session_connect` on the current one after the user agrees.
3. A workspace joins only by being created in the session: `workspace_create` with the session picked. A standalone workspace stays out; clone the repo into a new managed one.
4. `exec` {"workspace": "ws-…", "cmd": "getent hosts db"}.

**Done when:** `db` resolves from the workspace.
**If it fails:** no resolve: the workspace is standalone, or the session has no environment (`session_current`), or the environment is stopped (`env_start`).
**Then:** scenario 4.

### 4. Run a component against real services

**Trigger:** "run my API against the real database".
**Shape:** 2.
**Steps:**
1. `env_get`. Read each service's name and port.
2. `exec` {"workspace": "ws-…", "cmd": "npm run dev", "env": {"DATABASE_URL": "postgres://postgres@db:5432/postgres"}, "detach": true}. Note the process `id`. Never put a secret value in `env` (scenario 11).
3. `process_output` {"workspace": "ws-…", "id": "…"} from the `since` offset of the last answer.
4. When done: `process_kill`.

**Done when:** the output shows the process connected to `db`.
**If it fails:** a name that does not resolve: scenario 3. The process exits: read its output, fix, start again. At most 32 processes.

### 5. Intercept one service

**Trigger:** "intercept api", "send real traffic to my code".
**Shape:** 2.
**Steps:**
1. Start the code (scenario 4). Check it listens: `exec` {"workspace": "ws-…", "cmd": "ss -ltn | grep :3000"}.
2. `env_get`. Read the ports of `api`, for example 8080.
3. `intercept` {"env": "env-…", "service": "api", "workspace": "ws-…", "ports": [{"service": 8080, "workspace": 3000}]}. Leave out `ports` when the numbers match.
4. `env_get` until `api` shows `interceptedBy` and `proxy` `ready`.
5. Work. Then `release` {"env": "env-…", "service": "api"}.

**Done when:** `env_get` shows the intercept in force and a request to `api:8080` reaches the process. The intercept is released at the end.
**If it fails:** refused with a holder's name: tell the user who holds it; one workspace per service. `proxy` `failed`: the service keeps its traffic; check the port with `process_output`, `release`, intercept again. A service with no ports, or port 7788, is refused. Traffic returns when the workspace stops or is silent for 30 s; the intercept stays and takes hold again.
**Then:** scenario 7 to debug.

### 6. Change several components together

**Trigger:** "add shipped-order emails across api, worker and web".
**Shape:** 3.
**Steps:**
1. Scenarios 2 and 3 once: one environment with `web`, `api`, `worker`, `db`, `cache`, one session.
2. A managed workspace per component (scenario 1 for each, in the session).
3. Start each process (scenario 4) and intercept its own service (scenario 5).
4. Change the contract first (api), then its callers. `env_get`: every service shows its intercept.
5. At the end `release` each service, one by one.

**Done when:** a request through `web` reaches `api` and `worker` in their workspaces. Every intercept is released.
**If it fails:** as scenario 5. Two components in one workspace is fine when one process serves both.
**Then:** `kloudlite-verify` scenario 6 to test the changes together.

### 7. Debug a failing request with real traffic

**Trigger:** "debug this with real traffic", "requests to api fail".
**Shape:** 2.
**Steps:**
1. `service_logs` {"env": "env-…", "service": "api", "tail": 200}; add "previous": true after a crash.
2. `grep` the code path in the workspace.
3. Add logging with `edit`. Start the code (scenario 4), intercept (scenario 5).
4. `process_output`: read the real requests.
5. Fix, check, `release`.

**Done when:** the real requests succeed through the intercept and you told the user the cause.
**If it fails:** `service_logs` names the workspace when an intercept holds the service: read the process output instead.

### 8. Parallel work

**Trigger:** "try two approaches", "work on two features at once".
**Shape:** 3 or 4.
**Steps:**
1. Against the services: a second managed workspace in the session, which clones the repo, or `worktree_add` {"workspace": "ws-…", "name": "export"} in the same managed workspace; run each tree's process on its own port.
2. Only one tree's process can hold the intercept of a service. Intercept one, `release`, intercept the other.
3. Without services: `workspace_clone` {"workspace": "ws-…", "name": "api-try", "task": "approach B"}. A clone is standalone and does not reach the environment.
4. Commit each part on its own branch: `exec` `git switch -c export && git commit …`. Merge in the original workspace with `git fetch` and `git merge`.
5. Tear down: `worktree_drop` and `workspace_delete` for what you made, never one that holds unmerged work.

**Done when:** each part is on its branch and merged, and the extra trees and clones are gone.
**If it fails:** the clone cannot reach `db`: use a second managed workspace.

### 9. Reproduce a bug on a copy

**Trigger:** "reproduce it without breaking staging".
**Shape:** 4.
**Steps:**
1. `env_clone` {"env": "env-staging…", "name": "shop-repro"}; add `snapshot_id` to copy a snapshot. `env_wait`.
2. Tell the user the next step moves the whole session to the copy and releases the session's intercepts on staging.
3. `session_connect` {"environment": "env-copy…"}. Reproduce and fix (scenarios 4, 5, 7).
4. `session_connect` back to staging.
5. `env_delete` {"env": "env-copy…"} after the user says yes.

**Done when:** the bug is fixed on the copy, the session is on staging, the copy is deleted or kept by the user's choice.
**If it fails:** `409` with a limit: the copy counts against the quota.

### 10. Change a service

**Trigger:** "bump Postgres to 16", "open port 8081 on api".
**Steps:**
1. `env_get`. Copy the service as it is.
2. `service_update` {"env": "env-…", "service": {the whole service with the change}}. It replaces by name, so keep `env` and `mounts`. A new data directory needs its mount in the same call.
3. `env_wait`. On `failing`, `service_logs` and fix.

**Done when:** every service is ready.
**If it fails:** a major database upgrade can refuse an old data directory: read `service_logs`, tell the user; do not delete the data.

### 11. Variables and secrets

**Trigger:** "set DATABASE_URL on api", "give the worker the SMTP password".
**Steps:**
1. A plain value: `service_update` with it in `env` (a service), or `workspace_env_set` {"workspace": "ws-…", "variables": {…}} for a workspace. It merges into the current set; `workspace_env_get` reads the set (references, never a secret value). Add `"replace": true` only to remove a variable, and send the whole set.
2. A secret: `secret_set` (scenario 2, step 3), then the whole value `"${{ secrets.SMTP_PASSWORD }}"` in `env`. A service reads the team's secrets; a workspace sees the member's own first, then the team's.
3. A new variable marks the reader `restart_required`; nothing restarts by itself (scenario 12).

**Done when:** `env_get` or `workspace_env_get` shows the variable name. No value was printed.
**If it fails:** `422` on a missing secret: set it first. `409` deleting a referenced secret names the readers.

### 12. Rotate a secret

**Trigger:** "rotate the DB password".
**Steps:**
1. `secret_set` {"owner": "acme", "name": "DB_PASSWORD", "value": "…"} with the new value, never printed.
2. `env_get` and `workspace_get`: list every reader showing `restart_required`.
3. Tell the user which they are and that a restart stops their processes.
4. Only for the ones the user picks: `service_restart` {"env": "env-…", "service": "api"} or `workspace_restart` {"workspace": "ws-…"}.

**Done when:** the user chose, and each restarted reader no longer shows `restart_required`.
**If it fails:** a database keeps its old password in its data. Changing it there is a step of the database; tell the user.

### 13. Checkpoint and restore a workspace

**Trigger:** "checkpoint before the refactor", "go back to this morning".
**Steps:**
1. Only on request. `workspace_get`: read `volume`.
2. `workspace_snapshot` {"workspace": "ws-…", "volume": "api-base", "message": "before the refactor"}. Give `volume` only on the first snapshot.
3. `volume_history` {"volume": "<id from volume_list>"}: note `api-base@3`.
4. Restore: `workspace_restore` {"name": "api-restored", "snapshot_id": "api-base@3"}; add `team` for a team volume. `workspace_get` until `ready`.
5. Say the result is standalone: it does not reach the environment. A managed one needs a new workspace in the session and a copy of the files.

**Done when:** the snapshot is `ready` in the history, or the restored workspace is `ready` with the files.
**If it fails:** `422` asking for `volume`: ask the user for a name. `409` name taken: ask for another.

### 14. Reset environment data

**Trigger:** "reset the data to last night's snapshot".
**Steps:**
1. `env_get`: read `volume`. `volume_history`: find the snapshot the user names. Take one first only if the user asks: `env_snapshot`.
2. Name the environment and the snapshot; data written since is lost. Wait for a yes.
3. `env_restore` {"env": "env-…", "snapshot_id": "…"}.
4. On `409` with `lost`: list the services; only after a yes, repeat with "discard": [each name in `lost`].
5. `env_wait`.

**Done when:** the environment runs with the snapshot's data.
**If it fails:** `422` for `discard` naming a service that loses nothing: give exactly the names in `lost`.

### 15. Named volume for hand-off

**Trigger:** "save this dataset as v2".
**Steps:**
1. `workspace_snapshot` {"workspace": "ws-…", "volume": "dataset", "message": "v2"}. The first snapshot names the volume; later ones number `dataset@N`.
2. `volume_refs` {"volume": "<id>"}: the versions.
3. Another workspace starts from `dataset@2` (`workspace_restore` with `snapshot_id`); a sandbox with `sandbox_create` {"from_snapshot": "dataset@2", …}.

**Done when:** `volume_refs` lists the version.
**If it fails:** `409 volume dataset already exists`: another volume has the name.

### 16. Publish an image

**Trigger:** "build and push the api image".
**Steps:**
1. Only on request. `container_build` {"workspace": "ws-…", "tags": ["api:1.4.0"]}. The context is the working directory.
2. More names: `container_push` {"workspace": "ws-…", "src": "api:1.4.0", "dst": ["api:latest"]}.

**Done when:** the answer names the pushed image.
**If it fails:** `no registry is configured`: the user connects a registry in the web console. `builder_status` says why a build waits.

### 17. Stop for the day

**Trigger:** "stop everything for today", "stop for the day". "Stop my session" alone is the `kloudlite` skill's lifecycle row.
**Steps:**
1. `env_get`: `release` each intercept you made, one by one. A stopped workspace keeps its intercept wish and it takes hold again on the next start, so release first.
2. `process_list` per workspace; `process_kill` what you started. Report what is left to the user.
3. `workspace_stop` {"workspace": "ws-…"} for each workspace of the session, one by one.
4. `env_stop` only when the user asks; a stopped session already lets an unused environment go idle.
5. Last, and only when the user wants the session itself stopped: tell the user that `session_stop` also stops the bench, so your tools end with it; then `session_stop` {"session": "orders"} as the final act. Do nothing after it.

**Done when:** `workspace_get` shows each workspace `stopped` and `env_get` shows no intercept of yours. After step 5 you cannot check; say what you did before you called it.
**If it fails:** an idle session stops by itself after 30 minutes. A refused `workspace_stop` (a process you cannot kill): tell the user.

### 18. Reach the environment from the laptop

**Trigger:** "I want to run psql from my terminal".
**Steps:**
1. The user runs `kloudlite env` (the tunnel to the session's environment); you do not. Give the command and the service name and port from `env_get`, for example `psql -h db -p 5432`.
2. On a host with a shell, you may run it for the user.

**Done when:** the user connects.
**If it fails:** the tunnel needs the environment daemon: `kloudlite doctor`.

## Rules

- Obey the safety rules of the `kloudlite` skill.
- Use the session's environment. Copy it only for scenario 9, or when the user asks.
- Run servers as environment services; run only the user's own code in a workspace.
- Release every intercept you made. Delete what you created for the task; keep what the user had.
- Never handle a secret value in output. A restart after a new variable is the user's choice.
