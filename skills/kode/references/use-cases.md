# Use cases

Each case names the topology, the Worker template (`worker-templates.md`), the steps as tool calls and the end state. Find the nearest case, then adapt it. The last section shows how to compose a new one. The examples use the team `acme` and the environment `shop` with the services `web`, `api`, `worker` and `db`.

| # | Use case | Topology | Template | Environment slots | Workspace slots |
|---|---|---|---|---|---|
| 1 | Build a multi-service system from zero | Delegation | Solo × N | 1 | N |
| 2 | Repair one bug against real data | Solo | Solo | 0 | 1 |
| 3 | Try N approaches, keep the best | Conductor | Throwaway × N | 0 | N |
| 4 | Change frontend and backend together | Solo or Delegation | Solo × 2 | 0 | 2 |
| 5 | Debug a failing request with live traffic | Solo | Solo with 1 intercept | 0 | 1 |
| 6 | Review a pull request by running it | Solo | Desk verification | 1 | 1 |
| 7 | Reproduce a data-dependent bug safely | Solo | Solo | 1 | 1 |
| 8 | Verify a release end to end | Delegation | Desk verification | 1 | N |
| 9 | Bake a golden toolchain | Solo | Solo | 0 | 1, then 0 |
| 10 | Make a repeated check automatic | Solo | Pipeline authoring | 0 | 1, then 0 |
| 11 | Scheduled integration test | Pipeline | none | 0 | 0 |
| 12 | Continue the unfinished work of yesterday | Solo | Solo | 0 | 1 (stopped) |
| 13 | Bring a new repository into Kode | Solo | Solo | 1 | 1 |
| 14 | Two agents test their changes against each other | Delegation | Solo × 2 | 0 | 2 |

## 1. Build a multi-service system from zero

**Situation.** A new product needs `api`, `worker`, `web` and a `db`.
**Steps.** Coordinator: `quota`. `env` `create` with the services as data, `db` with a mount for its data, then `ttl`. `desk` `create` connected to it. `workspace` `create`, one for each service, each with its packages, then `ttl`. One Solo brief for each workspace, each with the intercept of its own service granted. Workers: write, run the code as a detached process, verify through the intercept, commit, `REPORT.md`, stop. Coordinator: read the reports, then brief one Desk verification Worker for the end-to-end run.
**End.** `env` `snapshot` with the message "project base v1". The workspaces deleted. The environment kept: it is now a declared artifact.

## 2. Repair one bug against real data

**Steps.** Solo Worker: `workspace` `restore` from the base volume of the repository. Reproduce in a capsule with `from_workspace`. Repair. Run the test in a capsule again. Commit and push. `REPORT.md`.
**End.** The workspace deleted. Nothing else was created.

## 3. Try N approaches, keep the best

**Steps.** Coordinator: `quota` gives N. `workspace` `create` with `source`, N clones of one seeded base, each with a `task` that names its approach and a short TTL. N Throwaway briefs with the same success command. Each Worker runs, writes `REPORT.md`, hands it back and deletes its workspace. The Coordinator compares the reports, picks one and briefs a Solo Worker to do the winner correctly.
**End.** No resource of the experiment stays. The report of the winner is the only input to the next step.

## 4. Change frontend and backend together

**Steps.** One desk, two workspaces `frontend` and `backend`. `intercept` `start` for `web` to `frontend` and for `api` to `backend`. A request to `web` goes through the two changes against the real `db` and `worker`. Solo when one session can hold the two; Delegation with two Solo Workers when not, each with one intercept granted.
**End.** The two intercepts stopped, the two branches pushed, the workspaces stopped or deleted.

## 5. Debug a failing request with live traffic

**Steps.** Solo Worker: run `api` in the workspace as a detached process with a debugger or more logging. `intercept` `start` for `api`. The failing request now arrives in the workspace. Edit, save; the next request runs the new code. `status` each turn confirms that the process runs.
**End.** `intercept` `stop` first, always. Then commit, `REPORT.md`, delete.

## 6. Review a pull request by running it

**Steps.** Desk verification Worker: `env` `create` with `source` `shop`. `workspace` `create` on the branch of the pull request. Intercept the changed service in the copy. Run the suite in a capsule; call the service directly. `REPORT.md` with the end of the log and a verdict.
**End.** The intercept stopped, the copy deleted, the workspace deleted.

## 7. Reproduce a data-dependent bug safely

**Steps.** `env` `create` with `source` `shop`; `desk` `connect` to the copy. Now change data, drop tables and stop services freely. Repair as in case 2.
**End.** `desk` `connect` back to `shop`; the copy deleted. If other people can use the broken state, `env` `snapshot` it with a message first, then delete.

## 8. Verify a release end to end

**Steps.** The Coordinator clones `shop` one time. One Desk verification brief for each subsystem, each with its own intercepts in the copy. The Workers run in parallel, and each leaves `REPORT.md`. The Coordinator merges the verdicts.
**End.** The copy deleted, each workspace deleted, one combined report.

## 9. Bake a golden toolchain

**Steps.** Solo Worker: `workspace` `create` with the full package list. Install what nixpkgs lacks into the home folder, fill the caches, run one build. `workspace` `snapshot` with a `volume` name such as `acme-node-base` and a `message` that says what is inside. The Coordinator confirms the name: a named base volume is a Coordinator artifact.
**End.** The workspace deleted. The named volume is the artifact; a later `workspace` `restore` from it starts ready.

## 10. Make a repeated check automatic

**Steps.** Pipeline authoring Worker: write the definition with one job for each step, the code through a connector, the secrets by reference. `pipeline` `save`. `run` `start` by hand, `run` `wait`, `run` `logs`. `REPORT.md` with the definition and the run id.
**End.** The draft workspace deleted. The Coordinator reads the definition, then saves a new version with a schedule or a webhook.

## 11. Scheduled integration test

**Steps.** No session. A saved pipeline with a schedule. Each job runs in a capsule against the environment, reaches the services by name and ends. A failed run is what calls a Coordinator.
**End.** Nothing to remove: the capsules end by themselves. A snapshot that a job saves gets a short TTL.

## 12. Continue the unfinished work of yesterday

**Steps.** Coordinator: `status`, `workspace` `list`, find the stopped workspace and its `REPORT.md`. A Solo brief that hands over that workspace by name. Worker: `workspace` `start`, read `REPORT.md`, continue.
**End.** As case 2. Unfinished work is stopped, never deleted, and a workspace that stays stopped for long gets a TTL so that nobody forgets it.

## 13. Bring a new repository into Kode

**Steps.** Solo Worker: read the compose file or the manifests of the repository. Write them as the services of `env` `create`, with a mount for each service that keeps data. `desk` `create` connected to it. `workspace` `create` with the packages that the repository needs. Run the app as a detached process, call it, close the gaps. Write `KODE.md` at the root of the repository: the environment, the packages and the run command, for the next agent.
**End.** `env` `snapshot` with the message "onboarded". A workspace snapshot as the base volume of the repository. The Coordinator names the two. The workspace deleted.

## 14. Two agents test their changes against each other

**Steps.** Two Solo Workers, two desks, one shared environment. The Coordinator grants `web` to one and `api` to the other, and says so before the intercepts start. A request to `web` goes through the two workspaces.
**End.** The two intercepts stopped before anything else. The Coordinator confirms with `env` `get` that no service has `interceptedBy`.

## Compose a new use case

Answer four questions in order.

1. What is the unit of isolation: a capsule (one command), a workspace (one change), a desk (a piece of work with many workspaces) or a copy of an environment (data that you will break)?
2. Who does the work: one session, one session over many machines, or many Workers?
3. Which artifact outlives the session, and who names it?
4. What is the end state of everything else?

Write the four answers as the brief, read `quota`, and start.
