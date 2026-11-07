# Routing table

One row per prompt: the skill that must load (`base` is the `kloudlite` skill alone; it loads first for every row) and the tie-breaker or situation that decides it. Manual eval: give each prompt to an agent that has the installed skills and record which skill loaded. `evals.test.ts` checks the skill column.

Tie-breaker for "stop": one lifecycle verb on a named object (stop, start, delete) goes to `base`; "stop everything" or "stop for the day" is a sequence (stop intercepts, stop workspaces, the session last) and goes to `kloudlite-develop`.

| Prompt | Skill | Rule |
|---|---|---|
| what do I have | base | Reads need no scenario |
| which session am I in | base | Reads need no scenario |
| is api up | base | Status of one object |
| status of shop-dev | base | Status of one object |
| logs of db | base | Service logs |
| why is worker crashing | base | Service logs, then develop if code must change |
| who intercepts api | base | Intercepts in force: env(get) |
| stop my session | base | Lifecycle verb on one named object goes to base, even though develop 17 also stops things |
| start the environment | base | Lifecycle |
| set the session TTL to a day | base | Lifecycle |
| delete the review workspace | base | Delete: name the target, rule 1 |
| delete all stopped workspaces | base | Delete: list by name first |
| why can't I create a workspace | base | Quota |
| ask for more quota | base | Quota: request_create when asked |
| tools say not logged in | base | Setup and recovery symptom |
| the server lists only session(pick) | base | Setup and recovery symptom |
| 403 your access to acme is paused | base | Setup and recovery symptom |
| connect Kloudlite to my agent (no Kloudlite tool present) | base | Setup steps, if the skill is installed at all |
| set up this repo | kloudlite-develop | Creates the shape |
| give me a workspace with Postgres | kloudlite-develop | "set up" creates the shape |
| give me a workspace for acme/api | kloudlite-develop | Creates the shape |
| I need Postgres and Redis | kloudlite-develop | Creates the shape (environment) |
| stand up the app's dependencies | kloudlite-develop | Creates the shape (environment) |
| connect my workspace to staging | kloudlite-develop | Session joins workspace and environment |
| run my API against the real database | kloudlite-develop | Keeps a process running |
| run my server | kloudlite-develop | Keeps a process running |
| hit it with real traffic | kloudlite-develop | Edits code or keeps a process running |
| intercept api | kloudlite-develop | Intercept |
| send real traffic to my code | kloudlite-develop | Intercept |
| fix the bug in the checkout flow | kloudlite-develop | Edits code (situation: tools present, code task) |
| add shipped-order emails across api, worker and web | kloudlite-develop | Several components: shape 3 |
| debug this with real traffic | kloudlite-develop | Intercept and logs |
| try two approaches | kloudlite-develop | Parallel work: managed workspaces or worktrees |
| work on two features at once | kloudlite-develop | Parallel work |
| reproduce it without breaking staging | kloudlite-develop | Copy of the environment: shape 4 |
| bump Postgres to 16 | kloudlite-develop | Service change |
| open port 8081 on api | kloudlite-develop | Service change |
| set DATABASE_URL on api | kloudlite-develop | Variables |
| give the worker the SMTP password | kloudlite-develop | Secrets in a service |
| rotate the DB password | kloudlite-develop | Rotation, the restart is the user's choice |
| checkpoint before the refactor | kloudlite-develop | Snapshot on request |
| go back to this morning | kloudlite-develop | Restore |
| reset the data to last night's snapshot | kloudlite-develop | Environment restore |
| save this dataset as v2 | kloudlite-develop | Named volume |
| build and push the api image | kloudlite-develop | Publish an image |
| stop everything for today | kloudlite-develop | "Everything" or "for the day" means stop intercepts, stop the workspaces, then the session last; a lifecycle verb on one named object is base |
| I want to run psql from my terminal | kloudlite-develop | Reach the environment from the laptop |
| add a field to the order model, and check it | kloudlite-develop | A change, then verify: develop first |
| run the unit tests | kloudlite-verify | Once, now, a result to read |
| check it works | kloudlite-verify | Once, now |
| try it | kloudlite-verify | Once, now |
| run the integration tests against staging | kloudlite-verify | Clean run in a capsule |
| run this migration once and show me the output | kloudlite-verify | One-off script |
| what did that capsule print | kloudlite-verify | Record of a capsule |
| did it pass | kloudlite-verify | Record of a capsule |
| why did the capsule fail | kloudlite-verify | Which record it is: capsule |
| review PR 42 against a copy of staging | kloudlite-verify | PR review in a real environment |
| test my api change with Priya's web change | kloudlite-verify | Integration across two changes |
| clean up my capsules | kloudlite-verify | Cleanup |
| make a pipeline that runs the tests | kloudlite-automate | Writes a pipeline |
| run the tests every night | kloudlite-automate | Repeats without a person |
| run the tests on every push | kloudlite-automate | Repeats without a person |
| run it after the build | kloudlite-automate | Follows another event |
| run it now (a pipeline) | kloudlite-automate | Starts a run |
| add a lint job | kloudlite-automate | New version |
| roll back to v3 | kloudlite-automate | New version from an old one |
| every night at 02:00 IST | kloudlite-automate | Schedule, UTC conversion |
| start it from a GitHub push | kloudlite-automate | Webhook |
| release after the tests pass | kloudlite-automate | After another pipeline |
| let me choose the branch | kloudlite-automate | Inputs |
| lint and test in parallel, then build | kloudlite-automate | needs and if |
| test on node 20 and 22 | kloudlite-automate | Matrix |
| the job needs the npm token | kloudlite-automate | Secrets in a job |
| check out the repo in the job | kloudlite-automate | Clone code |
| run the e2e tests against a fresh copy of staging | kloudlite-automate | Jobs against an environment |
| build the image in CI | kloudlite-automate | Registry push |
| pass the dataset to the next job | kloudlite-automate | saveTo, fromSnapshot |
| why did run 12 fail | kloudlite-automate | Which record it is: pipeline run |
| let GitHub Actions start this pipeline | kloudlite-automate | Token for CI |
| cancel the run | kloudlite-automate | Cancel |
| delete the old versions | kloudlite-automate | Cleanup of versions |
