# Scenario acceptance

For a manual run on the dev region: give the prompt, check the tool sequence. `*` repeats; `or` marks an alternative; a tool the host does not serve is replaced by the command in the skill. Titles are held equal to the skills' `###` headings by `evals.test.ts`.

| Scenario | Prompt | Expected tools |
|---|---|---|
| kloudlite-develop 1. Workspace for a repository | set up this repo, acme/api | session(current), workspace(list), workspace(create), workspace(get)*, exec(git clone), read(AGENTS.md), packages(add) |
| kloudlite-develop 2. Environment from the repository | I need Postgres and Redis for this app | env(list), read(docker-compose.yml), secret_set, env(create: db+mount, cache), env(wait) |
| kloudlite-develop 3. Session that joins them | connect my workspace to staging | session(current), session(use) or session(create), workspace(create), exec(getent hosts db) |
| kloudlite-develop 4. Run a component against real services | run my API against the real database | env(get), exec(detach, DATABASE_URL), process(output), process(kill) |
| kloudlite-develop 5. Intercept one service | intercept api | exec(detach), exec(ss -ltn), env(get), intercept(start, ports), env(get)*, intercept(stop) |
| kloudlite-develop 6. Change several components together | add shipped-order emails across api, worker and web | env(create), session(use), workspace(create) x3, exec(detach) x3, intercept(start) x3, env(get), intercept(stop) x3 |
| kloudlite-develop 7. Debug a failing request with real traffic | debug this with real traffic | service(logs), grep, edit, exec(detach), intercept(start), process(output), intercept(stop) |
| kloudlite-develop 8. Parallel work | work on two features at once against the services | workspace(create) (second, in session) or worktree(add), exec(detach) per tree, intercept(start), intercept(stop), worktree(drop) |
| kloudlite-develop 9. Reproduce a bug on a copy | reproduce it without breaking staging | env(create), env(wait), session(use: copy), intercept(start), intercept(stop), session(use: staging), env(delete) (after yes) |
| kloudlite-develop 10. Change a service | bump Postgres to 16 | env(get), service(update: full service, mounts kept), env(wait), service(logs) on failing |
| kloudlite-develop 11. Variables and secrets | set DATABASE_URL on api; give the worker the SMTP password | service(update: env) or workspace(get), workspace_vars(set); secret_set, service(update)(${{ secrets.X }}) |
| kloudlite-develop 12. Rotate a secret | rotate the DB password | secret_set, env(get), workspace(get), (ask user), service(update) or workspace(restart) |
| kloudlite-develop 13. Checkpoint and restore a workspace | checkpoint before the refactor, then go back to this morning | workspace(get), workspace(snapshot: volume), volume(get), workspace(restore), workspace(get)* |
| kloudlite-develop 14. Reset environment data | reset the data to last night's snapshot | env(get), volume(get), (ask), env(restore), (409 lost: ask) env(restore: discard), env(wait) |
| kloudlite-develop 15. Named volume for hand-off | save this dataset as v2 | workspace(snapshot: volume, message), volume(get) |
| kloudlite-develop 16. Publish an image | build and push the api image | container_build, container_push |
| kloudlite-develop 17. Stop for the day | stop everything | session(current), intercept(stop), session(stop) |
| kloudlite-develop 18. Reach the environment from the laptop | I want to run psql from my terminal | env(get), then give: kloudlite env + psql -h db -p 5432 |
| kloudlite-verify 1. Quick check in the workspace | run the unit tests | workspace(list), exec(cwd, tail, quiet) |
| kloudlite-verify 2. Clean run in a sandbox against the environment | run the integration tests against staging | session(current), env(get), sandbox(create: git clone, variables), sandbox(wait), sandbox(logs), sandbox(get) |
| kloudlite-verify 3. One-off script | run this migration once and show me the output | (ask yes if destructive), sandbox(create: packages, env), sandbox(wait), sandbox(logs), sandbox(get) |
| kloudlite-verify 4. Read a sandbox's record | what did that sandbox print | sandbox(list), sandbox(get), sandbox(logs) |
| kloudlite-verify 5. Review a pull request in a real environment | review PR 42 against a copy of staging | env(create), env(wait), session(create), workspace(create), exec(git fetch), sandbox(create) or intercept(start), intercept(stop), (ask) workspace(delete), env(delete) |
| kloudlite-verify 6. Integration test across two changes | test my api change with Priya's web change | env(get: interceptedBy), exec(curl) or sandbox(create), process(output), intercept(stop) |
| kloudlite-verify 7. Clean up | clean up my sandboxes | sandbox(list), (ask ids), sandbox(delete), sandbox(delete) |
| kloudlite-automate 1. Write and save a pipeline | make a pipeline that runs the tests | connector_list, pipeline(list), pipeline(save), pipeline(get) |
| kloudlite-automate 2. Change it as a new version; go back | add a lint job; roll back to v3 | pipeline(get), pipeline(save), pipeline(get) |
| kloudlite-automate 3. Start by hand and follow | run it now | run(start), run(wait), run(logs) |
| kloudlite-automate 4. Schedule | every night at 02:00 IST | pipeline(get), pipeline(save: schedule 30 20 * * *) |
| kloudlite-automate 5. Webhook | start it from a GitHub push | pipeline(save: webhook), (URL shown once), webhook_rotate on leak |
| kloudlite-automate 6. After another pipeline | release after the tests pass | pipeline(save: triggers.after) |
| kloudlite-automate 7. Inputs | let me choose the branch | pipeline(save: inputs), run(start: inputs) |
| kloudlite-automate 8. Order and conditions | lint and test in parallel, then build | pipeline(save: needs, if) |
| kloudlite-automate 9. Matrix | test on node 20 and 22 | pipeline(save: matrix) |
| kloudlite-automate 10. Secrets in a job | the job needs the npm token | secret_list, secret_set, pipeline(save: secrets) |
| kloudlite-automate 11. Clone code | check out the repo in the job | connector_list, pipeline(save: permissions.git, git clone) |
| kloudlite-automate 12. Jobs against an environment | run the e2e tests against a fresh copy of staging | pipeline(save: environment.clone), run(start) |
| kloudlite-automate 13. Build and push an image | build the image in CI | connector_list, pipeline(save: permissions.registry, docker image) |
| kloudlite-automate 14. Data between jobs and runs | pass the dataset to the next job | pipeline(save: saveTo, fromSnapshot), run(wait), volume(get) |
| kloudlite-automate 15. Debug a failed run | why did run 12 fail | run(list), run(get), run(logs) |
| kloudlite-automate 16. A token for CI | let GitHub Actions start this pipeline | (user steps: API token scoped to the pipeline, run route) |
| kloudlite-automate 17. Cancel and clean up | cancel the run; delete the pipeline | run(cancel) or pipeline(delete) (named by the user) |
| base Orient | what do I have | session(current), workspace(list), env(list), env(get) |
| base Status of one object | is api up | workspace(get), env(get), env(wait) |
| base Service logs | why is worker crashing | service(logs: tail, previous) |
| base Intercepts in force | who intercepts api | env(get: services[].interceptedBy) |
| base Lifecycle | stop my session; set the TTL | session(stop), session(ttl) or env(stop), env(start) |
| base Delete | delete the review workspace | (list by name, ask), workspace(delete) |
| base Quota | why can't I create | quota, then request_create only when asked |
| base Setup and recovery | tools are missing | no tool call: give the five steps |
