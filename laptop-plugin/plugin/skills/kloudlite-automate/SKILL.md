---
name: kloudlite-automate
description: Use when the user wants work to run without a person at a terminal on Kloudlite - "make a pipeline that runs the tests", "run this every night at 02:00", "start a build from a webhook", "release after the tests pass", "pass the dataset from one job to the next", "why did run 12 fail", "show the logs of the test job". Covers pipeline definitions, versions, triggers, needs and if, secrets, git, registry pushes, volumes, runs and logs. Not for a one-time check (use kloudlite-verify) or for editing code in a workspace (use kloudlite-develop). Read the kloudlite skill first.
---

# Automate with pipelines

## When to use

- The user wants a pipeline: a definition written, saved, changed, or started by hand, on a schedule, from a webhook, or after another pipeline.
- The user asks why a run failed, or wants its logs.

Do not use this skill for:

- A command that runs one time now: use `kloudlite-verify`.
- Changing and running code interactively: use `kloudlite-develop`.

## Components used

The `kloudlite` skill defines each one.

- Pipeline: the definition, its versions and its runs.
- Sandbox: each job runs in its own sandbox.
- Secrets and variables: job `secrets` and `env`.
- Connector: git read access and registry logins for jobs.
- Volume: `saveTo` and `fromSnapshot` carry a job's home between jobs and runs.
- Environment: the services that jobs reach, shared or copied for the run.

No tool manages pipelines. Use the `kloudlite pipelines` command on the user's computer (see "Tools" in the `kloudlite` skill). Write each definition to a JSON file in the user's project, for example `pipelines/ci.json`, so it lives in code.

## Definition rules

These rules come from the validator. Obey them in every definition.

- camelCase JSON. Every object refuses an unknown key: `need`, `timeout` or `uses` is an error that names the key.
- Pipeline keys: `name` (required, `[a-z0-9-]`, at most 63 characters), `environment`, `triggers`, `inputs`, `jobs` (required, at least one).
- Job keys: `needs`, `if`, `packages`, `image`, `fromSnapshot`, `saveTo`, `environment`, `matrix`, `timeoutMinutes` (default 60, 1 to 1440), `permissions`, `env`, `secrets`, `steps` (required). Job names: `[a-z0-9][a-z0-9-]{0,39}`.
- Step keys: `name`, `run` (required), `env`, `cwd`. A step has no `if`. Each `run` runs with `sh -e -c`, so the first failing command fails the step. The first failing step stops the job.
- `packages` and `image` are exclusive. With neither, the job gets the base image with `git`. With `packages`, list `git` yourself when a step clones.
- `${{ inputs.X }}`, `${{ matrix.X }}`, `${{ needs.JOB.result }}`, `${{ event }}`, `${{ run.number }}` interpolate. A `${{ secrets.NAME }}` value must be the whole value of an `env` entry.
- `webhook.body.*` is readable only in `env` and `if`. Read it into `env` and use `"$NAME"` in `run`.
- Limits: 50 jobs, 100 steps per job, 64 KiB, 50 pipelines per owner, 100 versions.

**Order and conditions.** A job with no `if` runs only when every job in its `needs` succeeded. An `if` that calls no status function adds that rule. `always()` runs after any end except a cancel. `failure()` is true when a needed job failed. `cancelled()` is true while the run is canceled. A job whose needs did not succeed is `skipped`. A failed job makes the run `failure`. Jobs with no `needs` run in parallel, up to 8 at a time.

## Scenarios

### 1. Write and save a pipeline

**Trigger:** "Make a pipeline that runs the tests of acme/api."

**Steps:**

1. Write `pipelines/ci.json`:

   ```json
   {
     "name": "api-ci",
     "jobs": {
       "test": {
         "packages": ["git", "nodejs@22"],
         "permissions": { "git": "read" },
         "timeoutMinutes": 30,
         "steps": [
           { "run": "git clone https://github.com/acme/api api" },
           { "name": "install", "run": "npm ci", "cwd": "api" },
           { "name": "test", "run": "npm test", "cwd": "api" }
         ]
       }
     }
   }
   ```

2. `kloudlite pipelines create --json --file pipelines/ci.json --owner TEAM`. Leave out `--owner` for the user's own team.
3. `kloudlite pipelines versions api-ci --owner TEAM`. Version 1 is listed.

**Done when:** the pipeline exists with version 1.

**If it fails:** a `422` lists every problem with its job and step. Fix all of them and save again. `secret NAME does not exist`: see scenario 6.

### 2. Change a pipeline

**Trigger:** "Add a lint job before the tests."

**Steps:**

1. `kloudlite pipelines get api-ci --json --owner TEAM`. Start from the newest version.
2. Edit the file. Add the job and `"needs": ["lint"]` on `test`.
3. `kloudlite pipelines update api-ci --file pipelines/ci.json --owner TEAM`. A definition equal to the newest version saves nothing.

**Done when:** `kloudlite pipelines versions api-ci` shows the new number.

**If it fails:** `409`: another save won. Read the newest version again, apply the change, and save.

### 3. Start a run by hand and follow it

**Trigger:** "Run the tests now."

**Steps:**

1. `kloudlite pipelines run api-ci --json --owner TEAM`. Add `--input KEY=VALUE` for each input, `--version N` for an older version. Note the run `id`.
2. `kloudlite pipelines wait-run TEAM api-ci RUN --timeout-s 3600`. It exits non-zero unless the run succeeded.
3. `kloudlite pipelines logs TEAM api-ci RUN test`. Use `--follow` to read a running job.

**Done when:** the run state is `success`, or you reported the failure (scenario 10).

**If it fails:** `422` at start: the version cannot run (a missing input, a deleted secret). Nothing is recorded. Fix the cause and start again.

### 4. Schedule a pipeline

**Trigger:** "Run it every weekday at 03:00 UTC."

**Steps:**

1. Add to the definition: `"triggers": { "schedule": ["0 3 * * 1-5"] }`. Five fields in UTC: minute, hour, day of month, month, weekday. No `@daily`, no names, no seconds.
2. Every input needs a `default`: a trigger has nobody to give a value.
3. `kloudlite pipelines update api-ci --file pipelines/ci.json --owner TEAM`.

**Done when:** the new version is saved. Its runs show `event` `schedule`.

**If it fails:** a tick that the platform misses while it is down is dropped. Tell the user when the next tick is in their time.

### 5. Start from a webhook

**Trigger:** "Rebuild the index when the CMS calls us."

**Steps:**

1. Add `"triggers": { "webhook": true }`. Read body fields through `env`: `"env": { "DOC_ID": "${{ webhook.body.id }}" }`, then `"run": "reindex \"$DOC_ID\""`.
2. Save with `kloudlite pipelines update` (or `create`). The answer shows the webhook URL once. Tell the user to store it as a secret of the calling system. Do not repeat it later.
3. To replace a leaked URL: `kloudlite pipelines rotate-webhook NAME --owner TEAM`. The old URL stops at once.

**Done when:** a `POST` to the URL with a JSON body starts a run with `event` `webhook`.

**If it fails:** a `run`, `cwd` or `image` that reads `webhook.body` is refused at save. A pipeline takes 30 calls a minute and a body of at most 256 KiB.

### 6. Use secrets in a job

**Trigger:** "The deploy job needs DEPLOY_TOKEN."

**Steps:**

1. `kloudlite secrets list --json --owner TEAM --scope team`. A pipeline job reads only the secrets of the pipeline owner (the team for a team).
2. If the name is missing, ask the user to set it. Give the command, value on stdin only: `printf %s "$TOKEN" | kloudlite secrets set DEPLOY_TOKEN --owner TEAM --scope team`.
3. In the job: `"secrets": ["DEPLOY_TOKEN"]`, or `"env": { "TOKEN": "${{ secrets.DEPLOY_TOKEN }}" }`.
4. Save the pipeline.

**Done when:** the save passes. The logs show `***` in place of the value.

**If it fails:** a value shorter than 4 bytes is not masked. Tell the user to use a longer value.

### 7. Clone code in a job

**Trigger:** "The job must check out acme/web."

**Steps:**

1. `kloudlite connectors list --owner TEAM`. A connector of the pipeline owner must cover the repository.
2. In the job: `"permissions": { "git": "read" }`, and a step `{ "run": "git clone https://github.com/acme/web web" }`. Use HTTPS. Pin a commit in the script if needed (`git checkout SHA`).

**Done when:** the clone step succeeds.

**If it fails:**

- `job KEY did not ask for permissions.git: read`: add the permission.
- `no git connector of OWNER covers HOST/REPO`: the user connects the code host in the web console.
- With GitHub, `git: read` reads every repository the app is installed on. Tell the user before a webhook pipeline gets it. Another git host needs a token secret in the clone URL.

### 8. Publish an image after the tests pass

**Trigger:** "When tests pass, tag the tested image as a release."

**Steps:**

1. Build and push the image from a workspace (`kloudlite-develop`, "Publish an image"), or let an earlier job push it.
2. Add a job:

   ```json
   "release": {
     "needs": ["test"],
     "image": "docker:27-cli",
     "permissions": { "registry": "push" },
     "steps": [
       { "run": "docker buildx imagetools create -t \"$KL_REGISTRY/api:$KL_RUN_NUMBER\" \"$KL_REGISTRY/api:candidate\"" }
     ]
   }
   ```

   The platform logs in to each registry connector of the owner first. `KL_REGISTRY` is the first registry and its namespace.
3. Save and run the pipeline.

**Done when:** the registry lists the new tag.

**If it fails:** `registry: push needs docker in the job's image`: use an image with `docker`. No registry connector: the user connects one in the web console.

### 9. Pass data between jobs and runs with a volume

**Trigger:** "Download the dataset once, then train on it in the next job."

**Steps:**

1. On the first job: `"saveTo": "dataset"`. When the job succeeds, its home is saved as the next version of the volume `dataset`.
2. On the next job: `"needs": ["fetch"]` and `"fromSnapshot": "dataset"`. Its home starts as a copy of the newest version. Use `dataset@N` to pin a version.
3. Read versions with `kloudlite volumes versions dataset --owner TEAM`.

**Done when:** the run shows `saved` on the first job and the second job reads the files.

**If it fails:**

- `saveTo` is not allowed with `matrix`, and it must be a literal name.
- Two jobs that save to one name need an order in `needs`.
- `fromSnapshot V: volume V has no ready version`: the name exists with no version. Tell the user.
- A save counts one `snapshots` unit of the quota. A failed job saves nothing.

### 10. Debug a failed run

**Trigger:** "Why did the last run fail?"

**Steps:**

1. `kloudlite pipelines runs TEAM api-ci --limit 5 --json`. Find the run.
2. `kloudlite pipelines get-run TEAM api-ci RUN --json`. Read the run `detail`, and for each job `state`, `failedStep`, `exitCode` and `detail`.
3. `kloudlite pipelines logs TEAM api-ci RUN JOB`. The log marks each step with `▶` and ends with `■` and the cause.
4. Tell the user the failing job, step and the lines that show the cause. Propose the fix to the definition or the code.

**Done when:** the user knows the cause and the fix.

**If it fails:**

- A job `skipped`: a needed job did not succeed, or the `if` was false. Add `always()` to `if` for a job that must run after a failure.
- `cloning NAME: …` or `the clone of NAME did not start within 15 minutes`: the copy of the environment failed. Check the services of the environment.
- A log older than 90 days reads `log expired`.

### 11. Run jobs against an environment

**Trigger:** "Run the integration job against a fresh copy of staging."

**Steps:**

1. On the job or the pipeline: `"environment": { "clone": "staging" }`. Use `"environment": "staging"` for the shared environment as it is.
2. Or per run: `kloudlite pipelines run api-ci --clone staging`, or `--environment staging`.

**Done when:** the job reaches the services by name. The copy is deleted when the run ends.

**If it fails:** a copy counts against the quota while it exists. Obey "Limits".

### 12. Start after another pipeline

**Trigger:** "Deploy when the build pipeline succeeds."

**Steps:**

1. Add `"triggers": { "after": { "pipeline": "build", "result": "success" } }`. `result` is `success`, `failure` or `cancelled`; without it, any end starts a run.
2. The pipeline `build` must exist, with the same owner. Save.

**Done when:** a run of `build` that ends with `success` starts a run with `event` `pipeline`.

**If it fails:** a pipeline cannot follow itself, and a chain stops at a depth of 5. The ended run lists the refusal in `triggered`.

## Rules

- Obey the safety rules of the `kloudlite` skill.
- Save every definition from a file in the user's project, never from a one-off string.
- Never put a secret value in a definition. Use `secrets` or a whole-value `${{ secrets.NAME }}`.
- Never put `webhook.body` in `run`, `cwd`, `image` or `packages`.
- Give each job a `timeoutMinutes` that fits its work.
- Delete a pipeline (`kloudlite pipelines delete`) or cancel a run (`kloudlite pipelines cancel-run`) only when the user asks and names it.
- Show the webhook URL only once, in the answer to the save.
