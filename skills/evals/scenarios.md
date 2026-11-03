# Scenario acceptance

For a manual run on the dev region: give the prompt, check the tool sequence. `*` repeats; `or` marks an alternative; a tool the host does not serve is replaced by the command in the skill. Titles are held equal to the skills' `###` headings by `evals.test.ts`.

| Scenario | Prompt | Expected tools |
|---|---|---|
| kloudlite-develop 1. Workspace for a repository | set up this repo, acme/api | session_current, workspace_list, workspace_create, workspace_get*, exec(git clone), read(AGENTS.md), packages_add |
| kloudlite-develop 2. Environment from the repository | I need Postgres and Redis for this app | env_list, read(docker-compose.yml), secret_set, env_create(db+mount, cache), env_wait |
| kloudlite-develop 3. Session that joins them | connect my workspace to staging | session_current, session_connect or session_create, workspace_create, exec(getent hosts db) |
| kloudlite-develop 4. Run a component against real services | run my API against the real database | env_get, exec(detach, DATABASE_URL), process_output, process_kill |
| kloudlite-develop 5. Intercept one service | intercept api | exec(detach), exec(ss -ltn), env_get, intercept(ports), env_get*, release |
| kloudlite-develop 6. Change several components together | add shipped-order emails across api, worker and web | env_create, session_connect, workspace_create x3, exec(detach) x3, intercept x3, env_get, release x3 |
| kloudlite-develop 7. Debug a failing request with real traffic | debug this with real traffic | service_logs, grep, edit, exec(detach), intercept, process_output, release |
| kloudlite-develop 8. Parallel work | work on two features at once against the services | workspace_create (second, in session) or worktree_add, exec(detach) per tree, intercept, release, worktree_drop |
| kloudlite-develop 9. Reproduce a bug on a copy | reproduce it without breaking staging | env_clone, env_wait, session_connect(copy), intercept, release, session_connect(staging), env_delete (after yes) |
| kloudlite-develop 10. Change a service | bump Postgres to 16 | env_get, service_update(full service, mounts kept), env_wait, service_logs on failing |
| kloudlite-develop 11. Variables and secrets | set DATABASE_URL on api; give the worker the SMTP password | service_update(env) or workspace_get, workspace_env_set; secret_set, service_update(${{ secrets.X }}) |
| kloudlite-develop 12. Rotate a secret | rotate the DB password | secret_set, env_get, workspace_get, (ask user), service_restart or workspace_restart |
| kloudlite-develop 13. Checkpoint and restore a workspace | checkpoint before the refactor, then go back to this morning | workspace_get, workspace_snapshot(volume), volume_history, workspace_restore, workspace_get* |
| kloudlite-develop 14. Reset environment data | reset the data to last night's snapshot | env_get, volume_history, (ask), env_restore, (409 lost: ask) env_restore(discard), env_wait |
| kloudlite-develop 15. Named volume for hand-off | save this dataset as v2 | workspace_snapshot(volume, message), volume_refs |
| kloudlite-develop 16. Publish an image | build and push the api image | container_build, container_push, builder_status on wait |
| kloudlite-develop 17. Stop for the day | stop everything | session_current, release, session_stop |
| kloudlite-develop 18. Reach the environment from the laptop | I want to run psql from my terminal | env_get, then give: kloudlite env + psql -h db -p 5432 |
| kloudlite-verify 1. Quick check in the workspace | run the unit tests | workspace_list, exec(cwd, tail, quiet) |
| kloudlite-verify 2. Clean run in a sandbox against the environment | run the integration tests against staging | session_current, env_get, sandbox_create(git clone, variables), sandbox_wait, sandbox_logs, sandbox_get |
| kloudlite-verify 3. One-off script | run this migration once and show me the output | (ask yes if destructive), sandbox_create(packages, env), sandbox_wait, sandbox_logs, sandbox_get |
| kloudlite-verify 4. Read a sandbox's record | what did that sandbox print | sandbox_list, sandbox_get, sandbox_logs |
| kloudlite-verify 5. Review a pull request in a real environment | review PR 42 against a copy of staging | env_clone, env_wait, session_create, workspace_create, exec(git fetch), sandbox_create or intercept, release, (ask) workspace_delete, env_delete |
| kloudlite-verify 6. Integration test across two changes | test my api change with Priya's web change | env_get(interceptedBy), exec(curl) or sandbox_create, process_output, release |
| kloudlite-verify 7. Clean up | clean up my sandboxes | sandbox_list, (ask ids), sandbox_terminate, sandbox_delete |
| kloudlite-automate 1. Write and save a pipeline | make a pipeline that runs the tests | connector_list, pipeline_list, pipeline_save, pipeline_versions |
| kloudlite-automate 2. Change it as a new version; go back | add a lint job; roll back to v3 | pipeline_get, pipeline_save, pipeline_versions |
| kloudlite-automate 3. Start by hand and follow | run it now | run_start, run_wait, run_logs |
| kloudlite-automate 4. Schedule | every night at 02:00 IST | pipeline_get, pipeline_save(schedule 30 20 * * *) |
| kloudlite-automate 5. Webhook | start it from a GitHub push | pipeline_save(webhook), (URL shown once), webhook_rotate on leak |
| kloudlite-automate 6. After another pipeline | release after the tests pass | pipeline_save(triggers.after) |
| kloudlite-automate 7. Inputs | let me choose the branch | pipeline_save(inputs), run_start(inputs) |
| kloudlite-automate 8. Order and conditions | lint and test in parallel, then build | pipeline_save(needs, if) |
| kloudlite-automate 9. Matrix | test on node 20 and 22 | pipeline_save(matrix) |
| kloudlite-automate 10. Secrets in a job | the job needs the npm token | secret_list, secret_set, pipeline_save(secrets) |
| kloudlite-automate 11. Clone code | check out the repo in the job | connector_list, pipeline_save(permissions.git, git clone) |
| kloudlite-automate 12. Jobs against an environment | run the e2e tests against a fresh copy of staging | pipeline_save(environment.clone), run_start |
| kloudlite-automate 13. Build and push an image | build the image in CI | connector_list, pipeline_save(permissions.registry, docker image) |
| kloudlite-automate 14. Data between jobs and runs | pass the dataset to the next job | pipeline_save(saveTo, fromSnapshot), run_wait, volume_refs |
| kloudlite-automate 15. Debug a failed run | why did run 12 fail | run_list, run_get, run_logs |
| kloudlite-automate 16. A token for CI | let GitHub Actions start this pipeline | (user steps: API token scoped to the pipeline, run route) |
| kloudlite-automate 17. Cancel and clean up | cancel the run; delete the pipeline | run_cancel or pipeline_delete (named by the user) |
| base Orient | what do I have | session_current, workspace_list, env_list, env_get |
| base Status of one object | is api up | workspace_get, env_get, env_wait |
| base Service logs | why is worker crashing | service_logs(tail, previous) |
| base Intercepts in force | who intercepts api | env_get(services[].interceptedBy) |
| base Lifecycle | stop my session; set the TTL | session_stop, session_ttl or env_stop, env_start |
| base Delete | delete the review workspace | (list by name, ask), workspace_delete |
| base Quota | why can't I create | quota, then request_create only when asked |
| base Setup and recovery | tools are missing | no tool call: give the five steps |
