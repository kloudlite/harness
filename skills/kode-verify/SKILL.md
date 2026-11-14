---
name: kode-verify
description: Gives the steps to check code once on Kode: quick checks in a workspace, clean runs in a capsule against the desk's environment, one-off scripts, reading what a capsule printed, reviewing a pull request in a real environment, testing two changes together, and cleaning up capsules. Use when the user says "run the unit tests", "check it works", "try it", "run the integration tests against staging", "run this once in a throwaway sandbox", "run this migration once and show me the output", "what did that capsule print", "did it pass", "review PR 42 against a copy of staging", "test my api change with Priya's web change", "clean up my capsules", or "why did the capsule fail". Not for editing code or keeping a server running (use kode-develop), not for tests that repeat nightly, on a push or after a build (use kode-automate), not for why a pipeline run failed (use kode-automate). Read the kode skill first.
---

# Verify on Kode

Read the `kode` skill first. It holds the definitions and the safety rules. Verify means: once, now, isolated, a result to read. Example app: `web`, `api`, `worker`, `db`, `cache`.

A check in a workspace uses the workspace's files and changes nothing. A capsule is for a run that must be clean or must not touch a workspace.

## Scenarios

### 1. Quick check in the workspace

**Trigger:** "run the unit tests", "check it works".
**Steps:**
1. Orient. Find the workspace that holds the code (`workspace` action `list`); it must be `ready`.
2. `exec` {"workspace": "ws-…", "cmd": "npm test", "cwd": "api", "tail": 60, "quiet": true}. The call waits and answers the exit code.
3. If the tests need a service (`db`), the workspace must be managed in a desk with the environment (`kode-develop`, scenario 3), or use scenario 2.

**Done when:** the exit code is 0, or you told the user which tests failed with the lines that show it.
**If it fails:** a command still running past `soft_ms` answers `promoted: true` with a process `id` and `poll_after_ms`: after that many ms call `process` action `wait` with that `id` (and `since`/`since_err` = `next`/`next_err`) until `state` is `exited`; `exit_code` is the result. A name that does not resolve: the workspace is not in the desk. The loop applies when a `promoted` answer arrives; a client that waits on MCP tasks waits on its own and never sees one.
**Then:** scenario 2 for a clean run.

### 2. Clean run in a capsule against the environment

**Trigger:** "run the integration tests against staging".
**Steps:**
1. `desk` action `list`: the desk needs an environment (`desk` `connect` sets one). `env` action `get`: service names and ports.
2. A capsule starts empty, so it gets the code with `git clone` through the connector (`connector_list` must show a code host). It tests what is pushed: the branch must be on the remote. For uncommitted work, add `"from_workspace": "ws-…"` to `capsule` action `create` (the capsule starts as that workspace's current files, so no clone is needed), or use scenario 1.
3. `capsule` {"action": "create", "command": "git clone --branch main https://github.com/acme/api api && cd api && npm ci && npm run test:integration", "packages": ["git", "nodejs@22"], "variables": {"DATABASE_URL": "postgres://postgres@db:5432/postgres"}, "lifetime_s": 1800}. It runs in the desk, so it reaches `db`. Note the id `cap-…`. A secret is `"${{ secrets.NAME }}"` as the whole value of a variable, never a value.
4. `capsule` {"action": "wait", "capsule": "cap-…", "timeout_ms": 900000}. On `timed_out: true`, wait again.
5. `capsule` {"action": "logs", "capsule": "cap-…"}, then `capsule` action `get`: read `exit_code`.

**Done when:** `phase` is `terminated`, `reason` is `Exited`, and `exit_code` is 0, or you told the user what failed.
**If it fails:** `reason` `Timeout`: raise `lifetime_s`. `reason` `Failed`: read `message`. `no git connector of OWNER covers HOST/REPO`: the user connects the host in the web console. `409` with a limit: running capsules count against the quota (rule 13 of the `kode` skill).
**Cleanup:** the capsule ends with its command; the record stays 90 days.

### 3. One-off script

**Trigger:** "run this migration once and show me the output".
**Steps:**
1. Read the script. A destructive migration needs the user's yes first, by name.
2. `capsule` {"action": "create", "command": "psql \"$DATABASE_URL\" -c 'select count(*) from orders'", "packages": ["postgresql"], "variables": {"DATABASE_URL": "postgres://postgres@db:5432/postgres", "PGPASSWORD": "${{ secrets.DB_PASSWORD }}"}, "lifetime_s": 300}. A secret is the whole value of a variable, so the password goes in `PGPASSWORD`, not in the URL. For a script file, clone it as in scenario 2, or put it in the command.
3. `capsule` actions `wait`, `logs`, `get` as in scenario 2.

**Done when:** you showed the user the output and the exit code.
**If it fails:** a migration that half-ran is not undone by a retry: read the output, tell the user, do not run it again without a yes.

### 4. Read a capsule's record

**Trigger:** "what did that capsule print", "did it pass".
**Steps:**
1. `capsule` {"action": "list", "limit": 10}: find it by time or command (`q`, `state` narrow it).
2. `capsule` action `get`: `phase`, `reason`, `exit_code`, `message`, the times.
3. `capsule` action `logs`: an ended capsule keeps its last 256 KiB. Secret values show as `***` in the output.

**Done when:** you told the user the result and, for a failure, the cause.
**If it fails:** an older record than 90 days is gone.

### 5. Review a pull request in a real environment

**Trigger:** "review PR 42 against a copy of staging".
**Shape:** 4.
**Steps:**
1. `env` {"action": "create", "source": "env-staging…", "name": "shop-pr-42", "wait": true}.
2. `desk` {"action": "create", "name": "review-42", "environment": "env-copy…"} then pass `desk: "review-42"` on every call that works in it. In the harness (no `desk` argument) `workspace` action `create` always lands in its own desk, which may be on staging: do not create the review workspace there. Tell the user to open `review-42`, and stop.
3. A review workspace in that desk: `workspace` {"action": "create", "name": "api-pr-42", …}; clone the repo; `exec` {"cmd": "git fetch origin pull/42/head:pr-42 && git switch pr-42"} (GitLab: `merge-requests/42/head`).
4. Run the tests (scenario 1) or `capsule` action `create` in the review desk (scenario 2, with `git fetch origin pull/42/head:pr-42 && git switch pr-42` after the clone). For a behaviour check, `intercept` the changed service from the review workspace, drive requests, then `intercept` action `stop`.
5. Tell the user the result. Delete what you made, after the user says yes: `workspace` action `delete`, `desk` {"action": "delete", "desk": "review-42"}, `env` action `delete` of the copy. The user's own workspace and desk stay as they were.

**Done when:** the user has the branch's result against the copy and the copy is deleted or kept by the user's choice.
**If it fails:** `no git connector of OWNER covers HOST/REPO`: the web console. The copy does not come up: `message` of the failing service in `env` action `get`.

### 6. Integration test across two changes

**Trigger:** "test my api change with Priya's web change".
**Shape:** 3.
**Steps:**
1. Both changes run in the same environment. Your desk intercepts `api` from your workspace. Priya's desk intercepts `web` from hers. Check with `env` action `get` that `services[].interceptedBy` shows both (the top-level `intercepts` list is only what was asked for). Never take her service: one workspace per service.
2. Drive a request through `web` to `api`: `exec` {"cmd": "curl -fsS http://web:3000/orders"} in your workspace, or `capsule` action `create` in the desk.
3. Read both processes' output. Stop yours when done (`intercept` action `stop`); she stops hers.

**Done when:** the request crossed both changes and you told the user the result.
**If it fails:** the intercept is refused with her desk's name: ask her to stop it, or copy the environment (`env` action `create`). An intercept is environment-wide: warn the user that every caller, hers included, reaches your workspace.

### 7. Clean up

**Trigger:** "clean up my capsules".
**Steps:**
1. `capsule` action `list` (all). Show which run and which ended.
2. Ask which to remove, by id.
3. A running standalone one: `capsule` action `delete`. An ended one: `capsule` action `delete` (removes its record).

**Done when:** the named capsules are ended or deleted.
**If it fails:** `409 SBX is managed by desk NAME; use the desk`: it ends with its command, its limit, or the desk. Wait, or delete the desk only if the user asks.

## Rules

- Obey the safety rules of the `kode` skill.
- Give `lifetime_s` always. A capsule that never ends holds quota to its limit.
- Create capsules in the desk when the command needs services. A standalone one reaches no environment.
- Give tools with `packages`. Never run a server in a capsule to stand in for a service.
- A capsule cannot intercept. To receive a service's traffic, use a workspace (`kode-develop`).
- Delete a copy of an environment or a review desk only when the user says so.
