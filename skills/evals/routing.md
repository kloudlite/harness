# Routing table

One row per prompt: the skill that must load (`base` is the `kode` skill alone; it loads first for every row) and the tie-breaker or situation that decides it. Manual eval: give each prompt to an agent that has the installed skills and record which skill loaded. `evals.test.ts` checks the skill column.

Tie-breaker for "stop": one lifecycle verb on a named object (stop, start, delete) goes to `base`; "stop everything" or "stop for the day" is a sequence (stop intercepts, stop workspaces, the desk last) and goes to `kode-develop`.

| Prompt | Skill | Rule |
|---|---|---|
| what do I have | base | Reads need no scenario |
| which desk am I in | base | Reads need no scenario |
| is api up | base | Status of one object |
| status of shop-dev | base | Status of one object |
| logs of db | base | Service logs |
| why is worker crashing | base | Service logs, then develop if code must change |
| who intercepts api | base | Intercepts in force: env(get) |
| stop my desk | base | Lifecycle verb on one named object goes to base, even though develop 17 also stops things |
| start the environment | base | Lifecycle |
| set the desk TTL to a day | base | Lifecycle |
| delete the review workspace | base | Delete: name the target, rule 1 |
| delete all stopped workspaces | base | Delete: list by name first |
| why can't I create a workspace | base | Quota |
| ask for more quota | base | Quota: request_create when asked |
| tools say not logged in | base | Setup and recovery symptom |
| a call refused for no `desk` | base | Setup and recovery symptom |
| 403 your access to acme is paused | base | Setup and recovery symptom |
| connect Kode to my agent (no Kode tool present) | base | Setup steps, if the skill is installed at all |
| set up this repo | kode-develop | Creates the shape |
| give me a workspace with Postgres | kode-develop | "set up" creates the shape |
| give me a workspace for acme/api | kode-develop | Creates the shape |
| I need Postgres and Redis | kode-develop | Creates the shape (environment) |
| stand up the app's dependencies | kode-develop | Creates the shape (environment) |
| connect my workspace to staging | kode-develop | Desk joins workspace and environment |
| run my API against the real database | kode-develop | Keeps a process running |
| run my server | kode-develop | Keeps a process running |
| hit it with real traffic | kode-develop | Edits code or keeps a process running |
| intercept api | kode-develop | Intercept |
| send real traffic to my code | kode-develop | Intercept |
| fix the bug in the checkout flow | kode-develop | Edits code (situation: tools present, code task) |
| add shipped-order emails across api, worker and web | kode-develop | Several components: shape 3 |
| debug this with real traffic | kode-develop | Intercept and logs |
| try two approaches | kode-develop | Parallel work: managed workspaces or worktrees |
| work on two features at once | kode-develop | Parallel work |
| reproduce it without breaking staging | kode-develop | Copy of the environment: shape 4 |
| bump Postgres to 16 | kode-develop | Service change |
| open port 8081 on api | kode-develop | Service change |
| set DATABASE_URL on api | kode-develop | Variables |
| give the worker the SMTP password | kode-develop | Secrets in a service |
| rotate the DB password | kode-develop | Rotation, the restart is the user's choice |
| checkpoint before the refactor | kode-develop | Snapshot on request |
| go back to this morning | kode-develop | Restore |
| reset the data to last night's snapshot | kode-develop | Environment restore |
| save this dataset as v2 | kode-develop | Named volume |
| build and push the api image | kode-develop | Publish an image |
| stop everything for today | kode-develop | "Everything" or "for the day" means stop intercepts, stop the workspaces, then the desk last; a lifecycle verb on one named object is base |
| I want to run psql from my terminal | kode-develop | Reach the environment from the laptop |
| add a field to the order model, and check it | kode-develop | A change, then verify: develop first |
| run the unit tests | kode-verify | Once, now, a result to read |
| check it works | kode-verify | Once, now |
| try it | kode-verify | Once, now |
| run the integration tests against staging | kode-verify | Clean run in a capsule |
| run this migration once and show me the output | kode-verify | One-off script |
| what did that capsule print | kode-verify | Record of a capsule |
| did it pass | kode-verify | Record of a capsule |
| why did the capsule fail | kode-verify | Which record it is: capsule |
| review PR 42 against a copy of staging | kode-verify | PR review in a real environment |
| test my api change with Priya's web change | kode-verify | Integration across two changes |
| clean up my capsules | kode-verify | Cleanup |
| make a pipeline that runs the tests | kode-automate | Writes a pipeline |
| run the tests every night | kode-automate | Repeats without a person |
| run the tests on every push | kode-automate | Repeats without a person |
| run it after the build | kode-automate | Follows another event |
| run it now (a pipeline) | kode-automate | Starts a run |
| add a lint job | kode-automate | New version |
| roll back to v3 | kode-automate | New version from an old one |
| every night at 02:00 IST | kode-automate | Schedule, UTC conversion |
| start it from a GitHub push | kode-automate | Webhook |
| release after the tests pass | kode-automate | After another pipeline |
| let me choose the branch | kode-automate | Inputs |
| lint and test in parallel, then build | kode-automate | needs and if |
| test on node 20 and 22 | kode-automate | Matrix |
| the job needs the npm token | kode-automate | Secrets in a job |
| check out the repo in the job | kode-automate | Clone code |
| run the e2e tests against a fresh copy of staging | kode-automate | Jobs against an environment |
| build the image in CI | kode-automate | Registry push |
| pass the dataset to the next job | kode-automate | saveTo, fromSnapshot |
| why did run 12 fail | kode-automate | Which record it is: pipeline run |
| let GitHub Actions start this pipeline | kode-automate | Token for CI |
| cancel the run | kode-automate | Cancel |
| delete the old versions | kode-automate | Cleanup of versions |
