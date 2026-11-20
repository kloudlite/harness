# Use cases

Each case names the topology, the steps as tool calls and the end state. Find the nearest case, then adapt it. The last section shows how to compose a new one. The examples use the team `acme`, the environment `shop` with the services `web`, `api`, `jobs` and `db`, the workspace volume `shop-code` and the environment volume `shop-env`.

Every case starts and ends the same way, so the cases do not repeat it. **Start** (convention 15 of the skill): read the memory, find the volume by its label, `workspace` `fork` from `shop-code@base` (a checkout of `base`), then `ttl`, then pull. **End** (convention 16): stop each intercept, push and merge, `memory` `write`, delete each workspace and each environment copy. A code change alone is no reason for a volume commit: code reaches the next session through git (pushed to origin, unfinished work on a git branch; the next workspace pulls it). `workspace` `delete` takes no snapshot by default. The main workspace refreshes the base only when the environment changed (a dependency, toolchain, package or variable, a new repository, a warmed cache; convention 8: the clean merged default branch checked out, its build or test passed, then `delete` with `save: true, tag: "base"`, so `base` moves onto it). A plain delete refuses, naming the difference, when packages, image or variables changed since the base: `save: true` keeps them, `skip_snapshot: true` drops them. Unfinished code is pushed to a git branch on origin and `open-work` names it. "Main workspace" is the one forked from the project volume; a fork, a capsule and a copy of an environment are deleted without a snapshot.

| # | Use case | Topology | Environment slots | Workspace slots |
|---|---|---|---|---|
| 1 | Build a multi-service system from zero | Split | 1 | N |
| 2 | Repair one bug against real data | Solo | 0 | 1 |
| 3 | Try N approaches, keep the best | Conductor | 0 | N |
| 4 | Change frontend and backend together | Solo or Split | 0 | 2 |
| 5 | Debug a failing request with live traffic | Solo | 0 | 1 |
| 6 | Review a pull request by running it | Solo | 1 | 1 |
| 7 | Reproduce a data-dependent bug safely | Solo | 1 | 1 |
| 8 | Verify a release end to end | Split | 1 | N |
| 9 | Bake a golden toolchain, and refresh it | Solo | 0 | 1, then 0 |
| 10 | Make a repeated check automatic | Solo | 0 | 1, then 0 |
| 11 | Scheduled integration test | Pipeline | 0 | 0 |
| 12 | Continue the unfinished work of yesterday | Solo | 0 | 1, then 0 |
| 13 | Bring a new repository into Kode (the first session) | Solo | 1 | 1 |
| 14 | Two agents test their changes against each other | Split | 0 | 2 |

## 1. Build a multi-service system from zero

**Situation.** A new product needs `api`, `jobs`, `web` and a `db`.
**Steps.** `quota`. `env` `create` with the services as data, `db` with a mount for its data, and `ttl_secs`. `netgroup` `create` connected to it. `workspace` `create`, one for each service, each with its packages, then `ttl`. One stream for each workspace, each with the intercept of its own service: write, run the code as a background process, verify through the intercept, commit, push, `REPORT.md`. Read the reports, then run the end-to-end check once.
**End.** `env` `snapshot` with `volume: "shop-env"`, a `description`, `labels: ["shop"]` and a `message`: the first commit of a volume makes `base`. One workspace that holds the repositories is snapshotted the same way as `shop-code`. `memory` `write`: the two volumes and `@base`, the repositories, how to run. The workspaces and the environment deleted. A later `env` `create` with `source: "shop-env@base"` starts from it.

## 2. Repair one bug against real data

**Steps.** `workspace` `fork` from `shop-code@base`, then `ttl`. Pull. Reproduce in a capsule with `from_workspace`. Repair. Run the test in a capsule again. Commit and push. `REPORT.md`.
**End.** The standard end: once the fix is merged, the base is refreshed from the default branch (convention 8). If the repair is not finished, its commits go to a git branch on origin and `open-work` names that branch (case 12).

## 3. Try N approaches, keep the best

**Steps.** `quota` gives N. `workspace` `fork` with `source`, N forks of the main workspace, each with a `task` that names its approach and a short TTL. Each fork runs its approach against the same success command and writes `REPORT.md`. Compare the reports, delete the forks (`skip_snapshot: true`), pick one approach and do the winner correctly in the main workspace.
**End.** No fork stays and none is snapshotted: code leaves through git, and a fork's disk goes with it. The standard end for the main workspace.

## 4. Change frontend and backend together

**Steps.** One netgroup, two workspaces `frontend` and `backend` (the main workspace and a fork of it, or two forks of the base). `intercept` `start` for `web` to `frontend` and for `api` to `backend`. A request to `web` goes through the two changes against the real `db` and `jobs`. Solo when one session can hold the two; split into two streams when not, each with its own workspace and one intercept.
**End.** The two intercepts stopped, the two branches pushed. The standard end: the main workspace pulls the merged branches and is deleted (with `save: true` only when the environment changed); the other is deleted plainly.

## 5. Debug a failing request with live traffic

**Steps.** Run `api` in the workspace as a background process with a debugger or more logging. `intercept` `start` for `api`. The failing request now arrives in the workspace. Edit, save; the next request runs the new code. `status` each turn confirms that the process runs.
**End.** `intercept` `stop` first, always: a stopped or deleted workspace does not end it. Then commit, push, `REPORT.md`, and the standard end.

## 6. Review a pull request by running it

**Steps.** `env` `fork` with `source` `shop` (a live copy) and `ttl_secs`; `netgroup` `connect` to the copy; `workspace` `fork` from `shop-code@base`, then `ttl`. Check out the branch of the pull request. Intercept the changed service in the copy. Run the suite in a capsule; call the service directly. `REPORT.md` with the end of the log and a verdict.
**End.** The intercept stopped, the environment copy deleted. The workspace holds a git branch that is not merged: it is pushed to origin, the workspace is deleted plainly and `base` does not move; `open-work` names the git branch when the review left work to continue.

## 7. Reproduce a data-dependent bug safely

**Steps.** `env` `fork` with `source` `shop` and `ttl_secs`; `netgroup` `connect` to the copy. Now change data, drop tables and stop services freely. Repair as in case 2.
**End.** `netgroup` `connect` back to `shop`; the copy deleted. If other people need the broken state, `env` `snapshot` the copy first: it becomes a snapshot of the `shop-env` volume, because a copy shares its source's volume. Give it a tag of its own (`tag: "bug-1432"`), never `base`, say in the `message` that the data is broken, and `volume` `untag` it when the bug is closed.

## 8. Verify a release end to end

**Steps.** Fork `shop` one time, with `ttl_secs`. One stream for each subsystem, each with its own workspace and intercepts in the copy. The streams run in parallel, and each leaves `REPORT.md`. Merge the verdicts.
**End.** The copy deleted, each fork deleted, one combined report. A release that passed is a good moment for a tag of its own: `volume` `tag` with `tag: "release-12"` on the snapshot that was tested.

## 9. Bake a golden toolchain, and refresh it

**Steps, first time.** `workspace` `create` with the full package list and `ttl_secs`. Clone the repositories, install what nixpkgs lacks into the home folder, fill the caches, run one build. `workspace` `snapshot` with `volume: "acme-node"`, a `description` that says what is inside and what it is for, `labels` with the project name and a `message`; the first commit makes `base`.
**Steps, refresh.** A base is refreshed, never edited in place. `workspace` `fork` from `acme-node@base`, then `ttl`. Pull the latest code. `packages` `update`. Run one build or one test: a state that does not build never goes on `base`. `volume` `describe` with a new `description` when the contents changed, then `workspace` `delete` with `save: true, tag: "base"` and a `message` that says what changed: it snapshots, moves `base` onto the new snapshot, then deletes. A build that fails moves no base: delete with `skip_snapshot: true` and say so in `open-work`. Refresh when the pull or the package update costs each session more than a few minutes.
**End.** The workspace deleted, each time. `memory` `write`: the volume, what is inside, `@base`. The snapshot that `base` left is untagged: it expires 30 days after its last use, or delete it now with `snapshot` `delete` when nothing needs it.

## 10. Make a repeated check automatic

**Steps.** Write the definition with one job for each step, `permissions` `git: "read"` for the code, the secrets by reference, and `fromSnapshot: "shop-code@base"` when the job needs the ready toolchain. `pipeline` `save`. `run` `start` by hand, `run` `wait`, `run` `logs`. `REPORT.md` with the definition and the run id.
**End.** The draft workspace deleted plainly (it holds nothing that git does not). Read the definition again, then save a new version with a schedule or a webhook.

## 11. Scheduled integration test

**Steps.** No session. A saved pipeline with a schedule. Each job runs in a capsule against the environment, reaches the services by name and ends. A failed run is what calls a person or an agent.
**End.** Nothing to remove: the capsules end by themselves. A snapshot that a job saves with `saveTo: name` is untagged and expires after 30 days like any other; a job that reads `name@base` keeps using the snapshot that `base` is on.

## 12. Continue the unfinished work of yesterday

**Steps.** Yesterday's session ended with its commits pushed to the git branch `feat/auth` on origin (with `REPORT.md` committed there), a line in `open-work` of the memory naming the repository, that git branch and what is left, and a plain `workspace` `delete`. A code change alone is no reason for a volume commit: code reaches the next session through git (pushed to origin, unfinished work on a git branch; the next workspace pulls it). `base` still points at the last good environment. Today: `status`, `memory` `read`, `workspace` `fork` from `shop-code@base`, then `ttl`. Pull, `git checkout feat/auth`, read `REPORT.md`, continue.
**End.** Finished: merge, remove the line from `open-work`, delete the workspace (with `save: true` only when the environment changed). Not finished: push again, update `open-work`, delete the workspace. No workspace stays stopped overnight.
**Which volume.** A workspace saves into the volume that it came from: forked from `shop-code`, its snapshot is the next snapshot of `shop-code`, and another `volume` name is refused with a `409`. A tag other than `base` (`node-22`) is for environment state that is not ready for every session yet; untag it when `base` has the change or it is dropped.

## 13. Bring a new repository into Kode (the first session)

**Situation.** The memory is empty and `volume` `list` with the project label finds nothing.
**Steps.** First brainstorm with the person and write the initial draft of the memory, then agree it (`memory.md`). Then read the compose file or the manifests of the repository. `env` `create` with them as services, a mount for each service that keeps data, and `ttl_secs`. `netgroup` `create` connected to it. `workspace` `create` with the packages that the repository needs, then `ttl`. Clone, run the app as a background process, call it, close the gaps. Write `KODE.md` at the root of the repository: the environment, the packages and the run command, for the next agent. Push.
**End.** `env` `snapshot` with `volume: "shop-env"` and `workspace` `snapshot` with `volume: "shop-code"`, each with a `description`, `labels` with the project name and a `message`; each first commit makes `base`. `memory` `write`: the draft made true, `volumes` and `environments` (each volume with `@base`), `sources`, `run`, `netgroups`, and the `plan` step marked done. The workspace and the environment deleted.

## 14. Two agents test their changes against each other

**Steps.** Two netgroups on one shared environment, one workspace and one agent in each; say which service each takes before the intercepts start: `web` to one, `api` to the other. A request to `web` goes through the two workspaces.
**End.** The two intercepts stopped before anything else. Confirm with `env` `get` that no service has `interceptedBy`. The two branches pushed. One workspace pulls the two and gets the standard end; the other is deleted with `skip_snapshot: true`.

## Compose a new use case

Answer four questions in order.

1. What is the unit of isolation: a capsule (one command), a workspace (one change), a netgroup (a piece of work with many workspaces) or a copy of an environment (data that you will break)?
2. Who does the work: one session, one session over many machines, or parallel streams?
3. Which artifact outlives the session (a git branch, a storage commit and the branch on it, a saved pipeline), and who names it?
4. What is the end state of everything else: snapshotted then deleted, or deleted?

Write the four answers as the brief, read `quota`, and start.
