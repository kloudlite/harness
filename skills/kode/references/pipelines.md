# Pipelines

A pipeline is a versioned JSON definition of jobs in a graph. Each job runs its steps in its own capsule. A run starts one version by hand, on a schedule, from a webhook, or after another pipeline. A saved pipeline is a declared artifact: a worker with the pipeline authoring brief (`worker-templates.md`) writes and saves it, and the coordinator adds the schedule or the webhook after it reads the definition.

Every pipeline tool takes `owner`: the user's handle, or the team slug for a team. When the host has files, keep each definition in the user's repository (`pipelines/ci.json`) and send its text to `pipeline` action `save`.

## Rules

- camelCase JSON. Every object refuses an unknown key: `need`, `timeout` or `uses` is an error that names the key. A save reports every problem at once.
- Pipeline keys: `name` (required, `[a-z0-9-]`, at most 63 characters), `environment`, `triggers`, `inputs`, `jobs` (required). Job keys: `needs`, `if`, `packages`, `image`, `fromSnapshot`, `saveTo`, `environment`, `matrix`, `timeoutMinutes` (default 60, 1 to 1440), `permissions`, `env`, `secrets`, `steps` (required). Step keys: `name`, `run` (required), `env`, `cwd`.
- Each `run` runs with `sh -e -c`: the first failing command fails the step, and the first failing step stops the job. A step has no `if`.
- `packages` and `image` are exclusive. With neither, the job gets the base image with `git`. With `packages`, list `git` when a step clones.
- `${{ inputs.X }}`, `${{ matrix.X }}`, `${{ needs.JOB.result }}`, `${{ event }}`, `${{ run.number }}` interpolate. A `${{ secrets.NAME }}` must be the whole value of an `env` entry.
- `webhook.body.*` is readable only in `env` and `if`. Read it into `env`; use `"$NAME"` in `run`.
- Limits: 50 jobs, 100 steps per job, 64 KiB, 50 pipelines per owner, 100 versions.
- A job with no `if` runs only when every job in `needs` succeeded. Jobs with no `needs` run in parallel, up to 8 at a time. A failed job fails the run. A job beyond quota waits up to 30 minutes before it fails.
- Never put a secret value in a definition. Use `secrets`, or a whole-value `${{ secrets.NAME }}` in `env`.
- Give each job a `timeoutMinutes` that fits its work.
- Show the webhook URL one time, in the answer to the save. `webhook_rotate` makes a new one, and the old URL stops at once.

## Example

```json
{"name": "api-ci", "jobs": {"test": {"packages": ["git", "nodejs@22"], "permissions": {"git": "read"}, "timeoutMinutes": 30,
  "steps": [{"run": "git clone https://github.com/acme/api api"},
            {"name": "install", "run": "npm ci", "cwd": "api"},
            {"name": "test", "run": "npm test", "cwd": "api"}]}}}
```

1. `connector_list` shows that a git connector covers the repository. `pipeline` {"action": "list", "owner": "acme"} shows a pipeline that already does the job.
2. `pipeline` {"action": "save", "owner": "acme", "definition": {…}}. A `422` lists every problem with its job and step: correct all of them, then save again. A definition equal to the newest version saves nothing.
3. `run` {"action": "start", "owner": "acme", "pipeline": "api-ci", "wait": true}, then `run` `wait` and `run` `logs` (`job` is the index of the job). `run` `get` gives `failedStep` and `exitCode` of a failed run.
4. To go back, `pipeline` `get` an old `version` and save its definition again as the newest. `run` `cancel` stops a run that you started.

## Refresh a base volume

A nightly job that starts from a base branch, pulls, builds, and moves the branch only on success:

```json
{"name": "rust-base-refresh", "triggers": {"schedule": ["17 21 * * *"]},
 "jobs": {"refresh": {"fromSnapshot": "rust-base@base", "saveTo": "rust-base@base",
   "packages": ["git", "cargo", "rustc", "gcc"], "permissions": {"git": "read"}, "env": {"CC": "gcc"}, "timeoutMinutes": 240,
   "steps": [{"name": "pull", "cwd": "payments", "run": "git checkout main && git pull --ff-only origin main && git submodule update --init"},
             {"name": "build", "cwd": "payments", "run": "cargo build -j 1 && cargo test --no-run -j 1"}]}}}
```

- The home is the volume's files, the clone included; the workspace's package profile is not, so list the job's `packages`.
- `origin` and every submodule URL must be `https://github.com/...` (or `gitlab.com`) with no user name or token in it, so the credential helper answers; `permissions.git: read` gives it a read credential.
- A job capsule has 1 CPU and 2 GiB: build with `-j 1`.
- `run` `get` shows `saved.branch: base` when it moved. A `detail` naming the branch means someone moved it meanwhile; the commit is kept on no branch.

## Pipeline

| Key | Default | Rule |
|---|---|---|
| `name` | required | `[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?`, unique per owner |
| `environment` | none | A name, or `{"clone": name}`. Default for jobs that name none |
| `triggers` | none | `schedule`, `webhook`, `after` |
| `inputs` | `{}` | name to `{options, default, required}` |
| `jobs` | required | At least one, in the order written |

## Triggers

| Key | Value | Rule |
|---|---|---|
| `schedule` | list of cron lines | Five fields in UTC. `*`, `N`, `A-B`, `/STEP`, comma lists. No names, no `@daily`. Day of month and weekday both set: either matches. A missed tick is dropped |
| `webhook` | `true` | Secret URL shown once; a JSON body up to 256 KiB is `webhook.body`; 30 calls a minute |
| `after` | `{pipeline, result}` | Same owner; `result` `success`, `failure`, `cancelled` or absent (any end); no self; depth 5 |

A trigger run takes every input's default. A required input with no default plus a trigger is refused.

## Inputs

| Key | Rule |
|---|---|
| `options` | The only accepted values; not empty; `default` must be in it |
| `default` | Used when the run gives none |
| `required` | A run with no value and no default is refused |

## Job

| Key | Default | Rule |
|---|---|---|
| `needs` | `[]` | Jobs that finish first; each exists; no cycle |
| `if` | `success()` | Bare or inside one `${{ }}` |
| `packages` | `[]` | `attr` or `attr@version`; exclusive with `image` |
| `image` | base image with `git` | A container image |
| `fromSnapshot` | none | Home starts as a copy of `name@<branch>` (`shop-base@base`), `name@N` (a storage commit), `name` (its `base` branch, else its newest commit) or a snapshot id. Name the branch |
| `saveTo` | none | A literal volume name, or `name@<branch>`; on exit 0 the home is the next storage commit. `name` moves no branch. `name@<branch>` fast-forwards that branch onto it when the save is ready, only if the branch still points at the commit the home started from (else the commit stays on no branch and the job `detail` says why; the job still succeeds). Never `name@N`, `name@latest` or an id; not with `matrix`. A pipeline that saves to a name blocks a rename of that volume |
| `environment` | the pipeline's | `"staging"` shared, `{"clone": "staging"}` a copy per run |
| `matrix` | none | axis to list; at most 64 combinations |
| `timeoutMinutes` | 60 | 1 to 1440 |
| `permissions` | none | `{"registry": "push", "git": "read"}`. A push: `"git": "write"` with `"gitPush": ["github.com/owner/name"]` (at most 10 repositories); the saver must be the person or a team admin, a connector of the owner must be able to write, and a run that descends from a webhook never gets a push |
| `env` | `{}` | Values interpolate, except a whole-value `${{ secrets.NAME }}` |
| `secrets` | `[]` | Owner's secrets for every step; each must exist at save |
| `steps` | required | At least one |

## Step

| Key | Default | Rule |
|---|---|---|
| `name` | first line of `run` | Shown in the run |
| `run` | required | `sh -e -c`; interpolated |
| `env` | `{}` | Layered over the job's |
| `cwd` | home | Relative to `~`, confined there |

## Expressions

| Name | Value | Where |
|---|---|---|
| `event` | `manual`, `schedule`, `webhook`, `pipeline` | everywhere |
| `run.id`, `run.number` | the run | everywhere |
| `inputs.NAME` | a run input | everywhere |
| `matrix.NAME` | this instance's value | job fields and steps |
| `needs.JOB.result` | `success`, `failure`, `skipped`, `cancelled` | job `if`, job `env`, steps |
| `env.NAME` | env so far | steps only |
| `webhook.body.PATH` | field of the body | `env` and `if` only, never `run`, `cwd`, `image`, `packages`, `environment` |
| `secrets.NAME` | a secret | whole value of an `env` entry |

Operators, tightest first: `!`, `==` `!=`, `&&`, `||`, parentheses. Literals: `'text'`, numbers, `true`, `false`. Functions in `if` only: `success()`, `failure()`, `always()`, `cancelled()`. No indexing, no arithmetic.

## `needs` and `if` truth table

A job with an `if` that calls no status function means `success() && (the condition)`.

| Needed jobs | `if` empty / no function | `always()` | `failure()` | `cancelled()` |
|---|---|---|---|---|
| all succeeded | runs | runs | skipped | skipped |
| one failed | skipped | runs | runs | skipped |
| a needed job skipped | skipped | runs | skipped | skipped |
| run canceled | skipped (never starts) | skipped (never starts) | skipped (never starts) | skipped (never starts) |

After a cancel the platform starts no more jobs and evaluates no `if`: a cleanup job cannot run on a cancel. `always()` runs after any end except a cancel. A job whose condition is false is `skipped`. A failed job makes the run `failure`. Up to 8 jobs run at once.

## Variables the platform sets

`CI=true`, `KD_CI=1`, `KD_PIPELINE`, `KD_RUN_ID`, `KD_RUN_NUMBER`, `KD_JOB`. With `permissions.registry`: `KD_REGISTRY`, `KD_REGISTRY_USER`. With `permissions.git`: `KD_GIT_TOKEN` (logged as `***`) and the `GIT_CONFIG_*` variables of the credential helper; a job `env` that sets `GIT_CONFIG_COUNT` replaces them.
