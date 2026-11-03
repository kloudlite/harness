---
name: kloudlite-verify
description: Use when the user wants to check or test code on Kloudlite without changing a workspace - "run the integration tests against the environment", "check that the API answers", "run this script once in a sandbox", "review PR 42 against a copy of staging", "what did that sandbox print", "clean up my sandboxes". Not for editing code or running a dev server in a workspace (use kloudlite-develop), not for pipelines that run on a schedule or trigger (use kloudlite-automate). Read the kloudlite skill first.
---

# Verify on Kloudlite

## When to use

- The user wants one command or a test suite to run once, isolated, against the services of the session's environment.
- The user wants the output, the exit code or the record of a sandbox.
- The user wants a pull request branch tested against a copy of an environment.
- The user wants old sandboxes cleaned up.

Do not use this skill for:

- Work that edits code or keeps a process running: use `kloudlite-develop`.
- Tests that must run again on a schedule, a webhook or after another pipeline: use `kloudlite-automate`.

## Components used

The `kloudlite` skill defines each one.

- Sandbox: runs the command once and ends.
- Session: joins the sandbox to the environment.
- Environment: holds the services that the command calls, or a copy of them.
- Workspace: the source of the files that the sandbox starts from.
- Volume: a snapshot can be the source instead of a workspace.

No tool creates a sandbox. Use the `kloudlite` command on the user's computer (see "Tools" in the `kloudlite` skill). Put `--json` before `--` to get output that you parse.

## Scenarios

### 1. One-off check against the environment

**Trigger:** "Check that the api service answers its health route."

**Steps:**

1. `session_current` {}. Note the session name. The session must have an environment.
2. `env_get` {"env": "env-…"}. Read the service name and its port.
3. Create the sandbox in the session:

   ```sh
   kloudlite sessions create-sandbox --json --session SESSION --package curl --timeout-s 120 -- sh -c 'curl -fsS http://api:8080/healthz'
   ```

   Note the sandbox `id` (`sbx-…`).
4. `kloudlite sandboxes wait SBX --timeout-s 180`. It exits with the code of the command.
5. `kloudlite sandboxes logs SBX`. Read the output.

**Done when:** the sandbox is `terminated` with `reason` `Exited`, and `exit_code` is 0. Tell the user the result and the relevant output lines.

**If it fails:**

- A service name does not resolve: the session has no environment, or the environment is stopped. Check with `session_current` and `env_get`.
- `reason` `Timeout`: the command ran past `--timeout-s` (default 300). Run it again with a larger value.
- `reason` `Failed`: read `message` in `kloudlite sandboxes get SBX --json`.

### 2. Integration tests from a workspace

**Trigger:** "Run the integration tests against the real services."

**Steps:**

1. `workspace_list` {}. Find the workspace that holds the code. The sandbox copies its live files, so changes that are not committed are tested too.
2. `packages_list` {"workspace": "ws-…"}. Give the same packages to the sandbox.
3. Create the sandbox:

   ```sh
   kloudlite sessions create-sandbox --json --session SESSION --from-workspace api --package nodejs@22 --cpu 2 --memory-gb 4 --timeout-s 1800 --env DATABASE_URL=postgres://postgres@db:5432/postgres -- sh -c 'cd ~/workspace && npm ci && npm run test:integration'
   ```

4. `kloudlite sandboxes logs SBX --follow`. It prints until the command ends.
5. `kloudlite sandboxes get SBX --json`. Read `exit_code`.

**Done when:** `exit_code` is 0, or you told the user which tests failed, with their lines from the output.

**If it fails:**

- `from_workspace and from_snapshot are exclusive`: give only one source.
- A test needs a secret: give it as `--env NAME='${{ secrets.NAME }}'`, never as a value.
- `409` with a limit: a running sandbox counts against the quota. Obey "Limits" in the `kloudlite` skill.

### 3. Read the output and the record of a sandbox

**Trigger:** "What did my last sandbox print?"

**Steps:**

1. `kloudlite sandboxes list --json --limit 10`. Find the sandbox by its time or command.
2. `kloudlite sandboxes get SBX --json`. Read `phase`, `reason`, `exit_code`, `message` and the times.
3. `kloudlite sandboxes logs SBX`. The output of an ended sandbox is its last 256 KiB.

**Done when:** you told the user the result and the cause of a failure.

**If it fails:** the record stays for 90 days. An older sandbox has no record.

### 4. Review a pull request against a copy of the environment

**Trigger:** "Test PR 42 against a copy of staging."

**Steps:**

1. `env_list` {}. Find the id of `staging`.
2. `env_clone` {"env": "env-staging…", "name": "staging-pr-42"}.
3. `env_wait` {"env": "env-copy…"}.
4. Make a session for the review, so the user's own session is not changed:

   ```sh
   kloudlite sessions create TEAM/review-pr-42 --json --environment staging-pr-42
   ```

   Leave out `TEAM/` for the user's own team.
5. Fetch the branch in the workspace that holds the repository: `exec` {"workspace": "ws-…", "cmd": "git fetch origin pull/42/head:pr-42 && git switch pr-42"}. For GitLab, the ref is `merge-requests/42/head`.
6. Run the tests in the review session:

   ```sh
   kloudlite sessions create-sandbox --json --session TEAM/review-pr-42 --from-workspace api --package nodejs@22 --timeout-s 1800 -- sh -c 'cd ~/workspace && npm ci && npm test'
   ```

7. `kloudlite sandboxes wait SBX`, then `kloudlite sandboxes logs SBX`.
8. Switch the workspace back: `exec` {"workspace": "ws-…", "cmd": "git switch -"}.
9. Tell the user the result. Ask if the session `review-pr-42` and the environment `staging-pr-42` can be deleted. Only after a yes: `kloudlite sessions delete TEAM/review-pr-42`, then `env_delete` {"env": "env-copy…"}.

**Done when:** the user has the test result of the branch against the copy, and the copy is deleted or kept by the user's choice.

**If it fails:**

- `git fetch` fails with `no git connector of OWNER covers HOST/REPO`: the user connects the code host in the web console.
- Step 5 is refused because the workspace has changes that are not committed: do not stash or discard them. Tell the user, or use a clone of the workspace (`workspace_clone`) for the branch.
- The copy does not come up: read the `message` of the failing service in `env_get`.

### 5. Clean up sandboxes

**Trigger:** "Clean up my sandboxes."

**Steps:**

1. `kloudlite sandboxes list --json --all`. List the sandboxes and their `phase`.
2. Tell the user which sandboxes run and which ended. Ask which to remove, by id.
3. For a running standalone sandbox the user names: `kloudlite sandboxes terminate SBX`.
4. For an ended standalone sandbox the user names: `kloudlite sandboxes delete SBX`. This removes its record.

**Done when:** the sandboxes the user named are ended or their records are deleted.

**If it fails:** `409` with `SBX is managed by session NAME; use the session`: a sandbox of a session ends with its command, its time limit, or the session. Wait for it, or delete the session only if the user asks.

## Rules

- Obey the safety rules of the `kloudlite` skill.
- Use a sandbox for a run that must not change a workspace. Use a workspace for work that must be kept.
- Create sandboxes in a session when the command needs the services. A standalone sandbox (`kloudlite sandboxes create`) reaches no environment.
- Always give `--timeout-s`. A sandbox that never ends holds quota until its time limit.
- Give tools with `--package`. Never run a server inside a sandbox to stand in for an environment service.
- Never pass a secret value with `--env`. Use `NAME='${{ secrets.NAME }}'`.
- A sandbox cannot intercept a service. To receive a service's traffic, use a workspace (`kloudlite-develop`).
- Delete a copy of an environment or a review session only when the user says so.
