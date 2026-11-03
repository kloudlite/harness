# Pipeline definition

Source: `docs/product/reference/pipeline-definition.md` (product reference). camelCase JSON; every object refuses an unknown key.

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
| `fromSnapshot` | none | Home starts as a copy of `name`, `name@N` or a snapshot id |
| `saveTo` | none | A literal volume name; on exit 0 the home is the next version; not with `matrix` |
| `environment` | the pipeline's | `"staging"` shared, `{"clone": "staging"}` a copy per run |
| `matrix` | none | axis to list; at most 64 combinations |
| `timeoutMinutes` | 60 | 1 to 1440 |
| `permissions` | none | `{"registry": "push", "git": "read"}` |
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

`CI=true`, `KL_CI=1`, `KL_PIPELINE`, `KL_RUN_ID`, `KL_RUN_NUMBER`, `KL_JOB`. With `permissions.registry`: `KL_REGISTRY`, `KL_REGISTRY_USER`. With `permissions.git`: `KL_GIT_TOKEN` (logged as `***`) and the `GIT_CONFIG_*` variables of the credential helper; a job `env` that sets `GIT_CONFIG_COUNT` replaces them.
