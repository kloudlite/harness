---
name: kode-automate
description: Gives the steps to write, save, version, start, schedule and debug pipelines on Kode. Use when work must run without a person at a terminal, repeat, or follow another event: "make a pipeline that runs the tests", "run it now", "run this every night at 02:00 IST", "start it from a GitHub push", "release after the tests pass", "let me choose the branch", "lint and test in parallel, then build", "test on node 20 and 22", "the job needs the npm token", "run the e2e tests against a fresh copy of staging", "build the image in CI", "pass the dataset to the next job", "why did run 12 fail", "let GitHub Actions start this pipeline", "cancel the run", "roll back to v3". Covers definitions, versions, triggers, needs and if, matrix, secrets, git, registry pushes, volumes, runs, logs. Not for a one-time check or test run (use kode-verify), not for editing code or running a server (use kode-develop), not for why a capsule failed (use kode-verify). Read the kode skill first.
---

# Automate with pipelines

Read the `kode` skill first. It holds the definitions and the safety rules. Automate means: repeats without a person. Example app: `web`, `api`, `worker`, `db`, `cache`.

`references/definition.md` holds the key tables and the `needs`/`if` truth table. The rules below are enough to write most definitions. Every pipeline tool takes `owner`: the user's handle, or the team slug for a team. When the host has files, keep each definition in the user's repo (`pipelines/ci.json`), and send its text to `pipeline` action `save`.

## Definition rules

- camelCase JSON. Every object refuses an unknown key: `need`, `timeout` or `uses` is an error that names the key. A save reports every problem at once.
- Pipeline keys: `name` (required, `[a-z0-9-]`, at most 63 characters), `environment`, `triggers`, `inputs`, `jobs` (required). Job keys: `needs`, `if`, `packages`, `image`, `fromSnapshot`, `saveTo`, `environment`, `matrix`, `timeoutMinutes` (default 60, 1 to 1440), `permissions`, `env`, `secrets`, `steps` (required). Step keys: `name`, `run` (required), `env`, `cwd`.
- Each `run` runs with `sh -e -c`: the first failing command fails the step, and the first failing step stops the job. A step has no `if`.
- `packages` and `image` are exclusive. With neither, the job gets the base image with `git`. With `packages`, list `git` when a step clones.
- `${{ inputs.X }}`, `${{ matrix.X }}`, `${{ needs.JOB.result }}`, `${{ event }}`, `${{ run.number }}` interpolate. A `${{ secrets.NAME }}` must be the whole value of an `env` entry.
- `webhook.body.*` is readable only in `env` and `if`. Read it into `env`; use `"$NAME"` in `run`.
- Limits: 50 jobs, 100 steps per job, 64 KiB, 50 pipelines per owner, 100 versions.
- A job with no `if` runs only when every job in `needs` succeeded. Jobs with no `needs` run in parallel, up to 8 at a time. A failed job fails the run. A job beyond quota waits up to 30 minutes before it fails.

## Scenarios

### 1. Write and save a pipeline

**Trigger:** "make a pipeline that runs the tests".
**Steps:**
1. Orient. `connector_list` {"owner": "acme"} to see that a git connector covers the repo (scenario 11). `pipeline` {"action": "list", "owner": "acme"} for a pipeline that already does the job.
2. Write the definition:
   ```json
   {"name": "api-ci", "jobs": {"test": {"packages": ["git", "nodejs@22"], "permissions": {"git": "read"}, "timeoutMinutes": 30,
     "steps": [{"run": "git clone https://github.com/acme/api api"},
               {"name": "install", "run": "npm ci", "cwd": "api"},
               {"name": "test", "run": "npm test", "cwd": "api"}]}}}
   ```
3. `pipeline` {"action": "save", "owner": "acme", "definition": {…}}.
4. `pipeline` {"action": "get", "owner": "acme", "pipeline": "api-ci"}: version 1.

**Done when:** the pipeline exists with version 1.
**If it fails:** `422` lists every problem with job and step: fix all, save again. `secret NAME does not exist`: scenario 10.
**Then:** scenario 3.

### 2. Change it as a new version; go back

**Trigger:** "add a lint job", "roll back to v3".
**Steps:**
1. `pipeline` {"action": "get", "owner": "acme", "pipeline": "api-ci"}: start from the newest version.
2. Add the job and `"needs": ["lint"]` on `test`. `pipeline` action `save`. An equal definition saves nothing.
3. Roll back: `pipeline` action `get` with `version` 3, then `pipeline` action `save` that definition. It becomes the next number; versions are never rewritten.

**Done when:** `pipeline` action `get` shows the new number.
**If it fails:** `409 pipeline changed; retry`: read the newest version again, apply, save. 100 versions: `409`; `pipeline` action `delete` an old one (not the latest), only when the user asks.

### 3. Start by hand and follow

**Trigger:** "run it now".
**Steps:**
1. `run` {"action": "start", "owner": "acme", "pipeline": "api-ci", "inputs": {"branch": "main"}}; `version` for an older one; `key` makes a retry answer the first run. Note the run id.
2. `run` {"action": "wait", "owner": "acme", "pipeline": "api-ci", "run": "…", "timeout_ms": 900000}. On `timed_out: true`, wait again.
3. `run` {"action": "logs", "owner": "acme", "pipeline": "api-ci", "run": "…", "job": 0}. `job` is the index of the job in the run; while `complete` is false, call again with `offset` set to `next`.

**Done when:** the run is `success`, or you reported the failure (scenario 15).
**If it fails:** `422` at start: the version cannot run (a missing input or deleted secret); nothing is recorded. Fix, start again.

### 4. Schedule

**Trigger:** "every night at 02:00 IST".
**Steps:**
1. Convert to UTC. 02:00 IST is 20:30 UTC the day before: `"triggers": {"schedule": ["30 20 * * *"]}`. Five fields: minute, hour, day of month, month, weekday. No `@daily`, no names, no seconds.
2. Every input needs a `default`: nobody gives a value to a trigger.
3. `pipeline` action `save`. Tell the user the next tick in their time.

**Done when:** the new version is saved; its runs show `event` `schedule`.
**If it fails:** a tick missed while the platform is down is dropped, not replayed.

### 5. Webhook

**Trigger:** "start it from a GitHub push".
**Steps:**
1. `"triggers": {"webhook": true}`. Read body fields through `env`: `"env": {"DOC_ID": "${{ webhook.body.id }}"}`, then `"run": "reindex \"$DOC_ID\""`.
2. `pipeline` action `save`. The answer shows the URL once: tell the user to store it in the calling system, and never repeat it.
3. A leaked URL: `webhook_rotate` {"owner": "acme", "pipeline": "api-ci"}; the old URL stops at once and the answer shows the new one once.
4. A `push` event is not a trigger here: the URL starts a run, and the job clones the code.

**Done when:** a `POST` with a JSON body starts a run with `event` `webhook`.
**If it fails:** `webhook.body` in `run`, `cwd` or `image` is refused at save. 30 calls a minute, body at most 256 KiB.

### 6. After another pipeline

**Trigger:** "release after the tests pass".
**Steps:**
1. In `release`: `"triggers": {"after": {"pipeline": "api-ci", "result": "success"}}`. `result` is `success`, `failure` or `cancelled`; absent means any end.
2. The target must exist, same owner. `pipeline` action `save`.

**Done when:** a successful `api-ci` run starts a `release` run with `event` `pipeline`.
**If it fails:** a pipeline cannot follow itself; a chain stops at depth 5, and the ended run's `triggered` names the refusal.

### 7. Inputs

**Trigger:** "let me choose the branch".
**Steps:**
1. `"inputs": {"branch": {"default": "main"}}`; `options` limits the values; `required` refuses a start without one.
2. Use `${{ inputs.branch }}` in `env`, `image`, `packages`, `environment`, `fromSnapshot`, `if` and steps.
3. `run` {"action": "start", "inputs": {"branch": "feature-x"}}. Every value is text.

**Done when:** a run with `feature-x` shows it in the job.
**If it fails:** a run can give only declared inputs; `inputs.nope` is an error at save.

### 8. Order and conditions

**Trigger:** "lint and test in parallel, then build".
**Steps:**
1. `lint` and `test` with no `needs` run together; `build` has `"needs": ["lint", "test"]`.
2. A job runs only if every needed job succeeded. For cleanup after a failure: `"if": "always()"`. For a failure notice: `"if": "failure()"` (true when a needed job failed). After a cancel the platform starts no more jobs and evaluates no `if`, so no cleanup job runs on a cancel (`references/definition.md`, truth table).
3. A job whose needs did not succeed is `skipped`. A failed job fails the run.

**Done when:** a run shows the jobs in the expected order and states.
**If it fails:** the truth table in `references/definition.md`. A step has no `if`: split it into a job.

### 9. Matrix

**Trigger:** "test on node 20 and 22".
**Steps:**
1. `"matrix": {"node": ["20", "22"]}` and `"packages": ["git", "nodejs@${{ matrix.node }}"]`.
2. At most 64 combinations. Instances are named `test (20)`. `needs.test.result` is one result for all: `failure` if any failed.
3. `saveTo` is not allowed with `matrix`.

**Done when:** a run shows one job instance per value.
**If it fails:** an empty axis or a repeated value is an error at save.

### 10. Secrets in a job

**Trigger:** "the job needs the npm token".
**Steps:**
1. `secret_list` {"owner": "acme"}. A job reads only the pipeline owner's secrets (the team for a team).
2. A missing name: the user gives the value. `secret_set` {"owner": "acme", "name": "NPM_TOKEN", "value": "…"}, value never printed. The owner is the team, so the job can read it.
3. In the job: `"secrets": ["NPM_TOKEN"]`, or `"env": {"TOKEN": "${{ secrets.NPM_TOKEN }}"}`. Never in `run`.
4. `pipeline` action `save`.

**Done when:** the save passes and the logs show `***`.
**If it fails:** a value under 4 bytes is not masked: ask for a longer one. Deleting a referenced secret is a `409` naming the pipeline.

### 11. Clone code

**Trigger:** "check out the repo in the job".
**Steps:**
1. `connector_list`: a connector of the pipeline owner must cover the repo.
2. `"permissions": {"git": "read"}` and a step `git clone https://github.com/acme/web web`. HTTPS only. Pin a commit in the script (`git checkout SHA`) if needed.

**Done when:** the clone step succeeds.
**If it fails:** `job KEY did not ask for permissions.git: read`: add it. `no git connector of OWNER covers HOST/REPO`: the web console. With GitHub, `git: read` reads every repo the app is installed on, a webhook run included: tell the user. Another host needs a token secret in the URL.

### 12. Jobs against an environment

**Trigger:** "run the e2e tests against a fresh copy of staging".
**Steps:**
1. `"environment": {"clone": "staging"}` on the pipeline or the job; `"environment": "staging"` uses the shared one as it is. A job's value beats the run's, which beats the pipeline's.
2. One copy per run per distinct target, deleted when the run ends. Jobs with the same target share it.
3. A run cannot change the environment: to run against another one, save a version that names it.

**Done when:** the job reaches `db` by name.
**If it fails:** the copy counts against the quota while it exists. `cloning NAME: …` in `detail`: check the environment's services.

### 13. Build and push an image

**Trigger:** "build the image in CI".
**Steps:**
1. `registry` connector needed: `connector_list`.
2. A job with `"image": "docker:27-cli"` (the job image needs `docker`), `"permissions": {"registry": "push"}` and `docker buildx build --push -t "$KL_REGISTRY/api:$KL_RUN_NUMBER" .`. `KL_REGISTRY` is the first registry and its namespace.
3. `needs` the tests. Save, run.

**Done when:** the registry lists the new tag.
**If it fails:** `registry: push needs docker in the job's image`. No registry connector: the web console.

### 14. Data between jobs and runs

**Trigger:** "pass the dataset to the next job", "start from last night's build".
**Steps:**
1. First job: `"saveTo": "dataset"`. On exit 0 its home is saved as the next version of the volume.
2. Next job: `"needs": ["fetch"]`, `"fromSnapshot": "dataset"` (or `dataset@3`). Its home starts as a copy.
3. `volume` action `list` / `volume` action `get` show the versions.

**Done when:** the run shows `saved` on the first job and the second job reads the files.
**If it fails:** two jobs that save to one name need an order in `needs`. `volume dataset has no ready version`: tell the user. A save counts one `snapshots` unit of quota; a failed job saves nothing.

### 15. Debug a failed run

**Trigger:** "why did run 12 fail".
**Steps:**
1. `run` {"action": "list", "owner": "acme", "pipeline": "api-ci", "state": "failure"}: find the run.
2. `run` {"action": "get", "owner": "acme", "pipeline": "api-ci", "run": "…"}: the run `detail`, and per job `state`, `failedStep`, `exitCode`, `detail`.
3. `run` action `logs` per failing job (`job` is its index): steps are marked `▶`, the end `■` with the cause.
4. Tell the user the job, the step and the lines that show the cause, then the fix.

**Done when:** the user knows the cause and the fix.
**If it fails:** a `skipped` job: a needed job did not succeed or its `if` was false. A log past 90 days: `log expired`. `the clone of NAME did not start within 15 minutes`: the copy failed.

### 16. A token for CI

**Trigger:** "let GitHub Actions start this pipeline".
**Steps:**
1. Tokens are made in the web console or the CLI, never by a tool and never by an API token. Give the user the steps: create a token granting `pipeline-runs` with verbs `run` and `read` on `api-ci` only, with an expiry.
2. The caller sends it as a bearer to `POST /v1/pipelines/OWNER/api-ci/runs`. The user stores it as a secret of GitHub Actions.
3. A token cannot read or write secrets or definitions with secret references.

**Done when:** the user has the token and a test call starts a run.
**If it fails:** every refusal is the same generic `401`; check the grant, the owner and the expiry.

### 17. Cancel and clean up

**Trigger:** "cancel the run", "delete the old versions".
**Steps:**
1. Only on a named request. `run` {"action": "cancel", "owner": "acme", "pipeline": "api-ci", "run": "…"}; a running run stops at its next report, so read it again with `run` action `get`.
2. Old versions: `pipeline` action `get`, then `pipeline` {"action": "delete", "owner": "acme", "pipeline": "api-ci", "version": 3} for each one the user names (`409` for the latest, or one any run reads: finished runs are kept 90 days, including those of an earlier pipeline of the same name; run numbers continue from them).
3. The whole pipeline: `pipeline` {"action": "delete", "owner": "acme", "pipeline": "api-ci"} (finished runs stay; `409` while a run is queued or running).

**Done when:** `run` action `get` shows `cancelled`, the named versions are gone from `pipeline` action `get`, or the pipeline is gone.
**If it fails:** `409 this run has already finished`.

## Rules

- Obey the safety rules of the `kode` skill.
- Never put a secret value in a definition. Use `secrets` or a whole-value `${{ secrets.NAME }}`.
- Never put `webhook.body` in `run`, `cwd`, `image` or `packages`.
- Give each job a `timeoutMinutes` that fits its work.
- Delete a pipeline or cancel a run only when the user names it.
- Show the webhook URL once, in the answer to the save.
