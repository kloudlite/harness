---
name: kloudlite-develop
description: Use when the user wants to set up or work on a project on Kloudlite - "set up this repo on Kloudlite", "give me a workspace with Postgres", "run my API against the real database", "intercept the api service", "debug this with real traffic", "work on two features at once", "reproduce this bug on a copy", "checkpoint my workspace", "reset the environment data", "stop my session", "rotate the database password". Not for one-off checks or test runs in a sandbox (use kloudlite-verify), not for pipelines (use kloudlite-automate). Read the kloudlite skill first.
---

# Develop on Kloudlite

## When to use

- The user sets up a project: a workspace with the code and tools, an environment with the services, a session that joins them.
- The user changes code and runs it against the real services of an environment, with or without an intercept.
- The user works in parallel, reproduces a bug on a copy, saves or restores state, or does housekeeping on a session or a secret.

Do not use this skill for:

- A test or a one-off command in a sandbox: use `kloudlite-verify`.
- A pipeline definition, run or log: use `kloudlite-automate`.

## Components used

The `kloudlite` skill defines each one.

- Session: joins the workspaces to the environment.
- Workspace: holds the code, the packages and the running process.
- Environment: holds the services.
- Intercept: sends a service's traffic to a workspace.
- Volume: holds the snapshots that save and restore state.
- Secrets and variables: give values to services and workspaces.
- Connector: gives `git clone` of the repository.

## Scenarios

### 1. Set up a project

**Trigger:** "Set up github.com/acme/api on Kloudlite with Postgres."

**Steps:**

1. `session_current` {}. Note the session and its environment. If it has an environment with the services, go to step 6.
2. If a service needs a password, ask the user to store it as a secret. Give the command for the user to run, so that the value never passes through you. For a team environment, the service reads only the team's secrets:

   ```sh
   printf %s "$PASSWORD" | kloudlite secrets set DB_PASSWORD --owner TEAM --scope team
   ```

   For the user's own team, leave out `--owner` and `--scope`.
3. `env_create` {"name": "api-dev", "quota_gb": 10, "services": [{"name": "db", "image": "postgres:16", "ports": [5432], "env": {"POSTGRES_PASSWORD": "${{ secrets.DB_PASSWORD }}"}, "mounts": [{"folder": "pg-data", "path": "/var/lib/postgresql/data"}]}]}. Obey "Service data" in the `kloudlite` skill for each service.
4. `env_wait` {"env": "env-…"}. Continue when every service is ready.
5. `session_connect` {"environment": "env-…"}.
6. `workspace_create` {"name": "api", "quota_gb": 20, "packages": ["git", "nodejs@22"]}. In a session, the workspace is managed and reaches the environment.
7. `workspace_get` {"workspace": "ws-…"}. Poll until `state` is `ready`.
8. `exec` {"workspace": "ws-…", "cmd": "git clone https://github.com/acme/api .", "quiet": true}. The working directory must be empty; else clone into a folder and give `cwd` in later calls.
9. `read` {"workspace": "ws-…", "path": "AGENTS.md"}. If it has a Setup section, add its packages with `packages_add` {"workspace": "ws-…", "packages": ["…"]}.
10. `exec` {"workspace": "ws-…", "cmd": "getent hosts db"}. The service name resolves.

**Done when:** the workspace is `ready`, the code is in `~/workspace`, and `db` resolves from the workspace.

**If it fails:**

- `git clone` asks for a password or fails with `no git connector of OWNER covers HOST/REPO`: no connector covers the repository. Run `kloudlite connectors list --owner TEAM` to show the user the connectors. The user connects GitHub or GitLab in the web console. Only `github.com` and the configured GitLab host are answered.
- `422` for a package: the answer lists the versions in the cache. Pick one of them.
- `env_wait` shows a service `failing: true`: read its `message`, fix the service with `service_update`, and wait again.
- `409` with a limit: obey "Limits" in the `kloudlite` skill.

### 2. Run code against the real services

**Trigger:** "Run the API against the database."

**Steps:**

1. `env_get` {"env": "env-…"}. Read each service name and port.
2. `exec` {"workspace": "ws-…", "cmd": "npm run dev", "env": {"DATABASE_URL": "postgres://postgres@db:5432/postgres"}, "detach": true}. Note the process `id`. Never put a secret value in `env`: give the workspace a `${{ secrets.NAME }}` variable with `kloudlite workspaces set-env` instead.
3. `process_output` {"workspace": "ws-…", "id": "…"}. Read from the `since` offset that the last answer gave.

**Done when:** the output shows the process connected to the service.

**If it fails:** a name that does not resolve means the workspace is not in the session or the session has no environment. Check with `session_current`.

### 3. Intercept one service

**Trigger:** "Send the api service's traffic to my workspace."

**Steps:**

1. Start the code in the workspace on its port (scenario 2). Note the port, for example 3000.
2. `env_get` {"env": "env-…"}. Read the ports of `api`, for example 8080.
3. `intercept` {"env": "env-…", "service": "api", "workspace": "ws-…", "ports": [{"service": 8080, "workspace": 3000}]}. Leave out `ports` when the ports are the same.
4. `env_get` {"env": "env-…"}. Poll until the `api` service shows `interceptedBy` and `proxy` `ready`.
5. When the work is done: `release` {"env": "env-…", "service": "api"}.

**Done when:** `env_get` shows the intercept in force, and a request to `api:8080` from the environment reaches the workspace process.

**If it fails:**

- Refused with the name of a holder: another workspace or session holds the service. Tell the user who holds it.
- `proxy` `failed`: the switch could not be made and the service keeps its traffic. Check that the process listens on the port with `process_output`, then `release` and `intercept` again.
- Traffic goes back to the service when the workspace stops or does not answer for 30 seconds. The intercept stays and takes hold again when the workspace is back.
- The service has no ports, or the port is 7788: the intercept is refused.

### 4. Intercept two services

**Trigger:** "I am changing api and worker together."

**Steps:**

1. Use one workspace for each service (scenario 1, step 6 for each). One workspace can serve both when it runs both processes.
2. Start each process (scenario 2).
3. `intercept` {"env": "env-…", "service": "api", "workspace": "ws-api…"}.
4. `intercept` {"env": "env-…", "service": "worker", "workspace": "ws-worker…"}.
5. `env_get` {"env": "env-…"}. Both services show `interceptedBy`.
6. When done, `release` each service.

**Done when:** both services show the intercept in force, and traffic between them goes through the two workspaces.

**If it fails:** as in scenario 3. One service takes only one workspace.

### 5. Debug with real traffic

**Trigger:** "Requests to api fail in the environment. Find out why."

**Steps:**

1. `service_logs` {"env": "env-…", "service": "api", "tail": 200}. Add `"previous": true` after a crash.
2. Find the code path in the workspace with `grep` {"workspace": "ws-…", "pattern": "…"}.
3. Add logging with `edit`, start the code (scenario 2), and intercept the service (scenario 3).
4. `process_output` {"workspace": "ws-…", "id": "…"}. Read the real requests.
5. Fix the code, check the output again, then `release` the service.

**Done when:** the real requests succeed through the intercept, and the cause is told to the user.

**If it fails:** `service_logs` names the workspace when an intercept holds the service: read the workspace process output instead.

### 6. Parallel work in clones

**Trigger:** "Work on the login fix and the export feature at the same time."

**Steps:**

1. Commit the current work in the workspace: `exec` {"workspace": "ws-…", "cmd": "git add -A && (git diff --cached --quiet || git commit -m 'Save work')"}.
2. `workspace_clone` {"workspace": "ws-…", "name": "api-export", "task": "export feature"}.
3. `workspace_get` {"workspace": "ws-clone…"}. Poll until `ready`.
4. In the clone, make a branch: `exec` {"workspace": "ws-clone…", "cmd": "git switch -c export"}. Do the work there.
5. To bring the work back, push the branch to the repository remote and merge it in the original workspace with `git fetch` and `git merge`. A connector gives read access only: a push needs a write credential of the user in the workspace.

**Done when:** each part is committed on its own branch and merged in the original workspace.

**If it fails:** a clone is a standalone workspace and does not reach the environment. Run the tests that need services in the original workspace, or in a sandbox (`kloudlite-verify`). Do not delete a clone that holds work that is not merged.

### 7. Reproduce a bug on a copy of an environment

**Trigger:** "Reproduce the duplicate-order bug without touching the shared data."

**Steps:**

1. `env_clone` {"env": "env-…", "name": "api-repro"}. Give `snapshot_id` to copy a snapshot instead of the live state.
2. `env_wait` {"env": "env-copy…"}.
3. Tell the user that the next step moves the whole session to the copy and releases the session's intercepts on the shared environment.
4. `session_connect` {"environment": "env-copy…"}.
5. Reproduce and fix the bug (scenarios 2, 3 and 5).
6. `session_connect` {"environment": "env-shared…"}. The session goes back to the shared environment.
7. Ask the user if the copy `api-repro` can be deleted. Only after a yes: `env_delete` {"env": "env-copy…"}.

**Done when:** the bug is reproduced and fixed on the copy, and the session is on the shared environment again.

**If it fails:** `409` with a limit: the copy counts against the quota. Obey "Limits".

### 8. Checkpoint and restore a workspace

**Trigger:** "Save my workspace as it is now." Then later: "Go back to that save."

**Steps:**

1. `workspace_get` {"workspace": "ws-…"}. Read `volume`. `volume_list` {} shows if the volume has a `name`.
2. `workspace_snapshot` {"workspace": "ws-…", "volume": "api-base", "message": "before the refactor"}. Give `volume` only on the first snapshot of the volume.
3. `volume_history` {"volume": "<volume id>"}. Note the new version, for example `api-base@3`.
4. To restore: `workspace_restore` {"name": "api-restored", "snapshot_id": "api-base@3"}. Add `team` for a team volume.
5. `workspace_get` {"workspace": "ws-new…"}. Poll until `ready`.

**Done when:** the snapshot is `ready` in the history, or the restored workspace is `ready` with the saved files.

**If it fails:**

- `422` that asks for `volume`: it is the first snapshot. Ask the user for the name.
- `409` because another volume holds the name: ask the user for another name.
- A restored workspace is standalone and does not reach the environment. Tell the user.

### 9. Reset environment data

**Trigger:** "Put the environment data back to the clean seed."

**Steps:**

1. `env_get` {"env": "env-…"}. Read `volume`.
2. `volume_history` {"volume": "<volume id>"}. Find the snapshot the user names, and note its `id`.
3. Confirm the target with the user by name: the environment and the snapshot. Data written since is lost.
4. `env_restore` {"env": "env-…", "snapshot_id": "<snapshot id>"}.
5. If the answer is `409` with `lost`, tell the user which services lose data. Only after a yes: `env_restore` {"env": "env-…", "snapshot_id": "<snapshot id>", "discard": ["<each service in lost>"]}.
6. `env_wait` {"env": "env-…"}.

**Done when:** the environment runs and its data is the data of the snapshot.

**If it fails:** `422` that `discard` names services that lose nothing: give exactly the names in `lost`. With no clean snapshot, offer to take one after the user resets the data by hand (`env_snapshot` {"env": "env-…", "message": "clean seed"}), only when the user asks.

### 10. Stop a session

**Trigger:** "Stop everything for today."

**Steps:**

1. `session_current` {}. Read the session name.
2. Give the command, or run it when local commands work: `kloudlite sessions stop --session NAME`.
3. To start again later: `kloudlite sessions start --session NAME`.

**Done when:** `kloudlite sessions get NAME --json` shows `stopped`.

**If it fails:** a session also stops by itself after 30 minutes without use. Homes are kept in both cases.

### 11. Rotate a secret

**Trigger:** "Rotate the database password."

**Steps:**

1. Ask the user to set the new value. Give the command, with the value on stdin only:

   ```sh
   printf %s "$NEW_PASSWORD" | kloudlite secrets set DB_PASSWORD --owner TEAM --scope team
   ```

2. `env_get` {"env": "env-…"} and `workspace_get` {"workspace": "ws-…"}. List each service and workspace that shows `restart_required`.
3. Tell the user which ones show it. A restart stops their processes. The user chooses.
4. Only for the ones the user picks: `kloudlite environments restart ENV --service db`, or `kloudlite workspaces restart WS`.

**Done when:** the user picked; each restarted resource no longer shows `restart_required`.

**If it fails:** the database inside the service keeps its old password in its data. Changing it there is a step of the database, not of Kloudlite. Tell the user.

### 12. Publish an image

**Trigger:** "Build and push the api image."

**Steps:**

1. `container_build` {"workspace": "ws-…", "tags": ["api:1.4.0"]}. The build context is the working directory. The image goes to the owner's registry connector.
2. To give it more tags: `container_push` {"workspace": "ws-…", "src": "api:1.4.0", "dst": ["api:latest"]}.

**Done when:** the answer names the pushed image.

**If it fails:** `no registry is configured`: the owner has no registry connector. The user connects one in the web console. `builder_status` {} shows why a build waits.

## Rules

- Obey the safety rules of the `kloudlite` skill.
- In the laptop plugin with kl mode on, the main session does the session, environment and workspace steps itself, and gives every code and run step in a workspace to that workspace's `kl-workspace` agent (see the `orchestrate` skill).
- Use the session's environment. Make a copy only for scenario 7, or when the user asks.
- Run servers as environment services, never as workspace processes. Run only the user's own code in a workspace.
- Do not build an image for each change. Use an intercept while you develop.
- Release every intercept that you started when the work is done.
- Never handle a secret value. The user types it into `kloudlite secrets set`.
- A restart after a new secret or variable is the user's choice. Never restart on your own.
