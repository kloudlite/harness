# Worker templates and the hand-off report

A worker is one agent that executes one task on the workspaces its coordinator listed for it. A template is the task that a coordinator gives it: scope, tools, end state and the report that it must leave. Four templates cover most work. A template is not a new kind of agent. In the Kode runtime the task goes out with `worker_ask` (`task`, and `workspaces` on the first call), and the worker answers with `report`.

## The hand-off report

A worker never hands off through chat context alone. It leaves one file, `REPORT.md`, at the root of its main workspace's source folder, commits it when there is a repository, and names it in its `report` (or its last message on a host without one). The coordinator reads this file before anything else, and before it deletes the workspace.

```markdown
# Report: <task name>

## Outcome
One line: done, partial, blocked or discarded.

## What changed
The branch or commit, or "nothing persisted". The files touched, one per line.

## How it was verified
The command, its exit code and the last 20 lines of its output. "Not verified" is an allowed answer. A claim without this section is not.

## Resources left
Each snapshot or pipeline save: the volume, the tag it carries (`name@node-22`) or untagged, and its number, whether it is good or what is left, and what is inside. Each process or intercept still running, only when the task asked to keep it. Empty means nothing is left running.

## Budget spent
The model that ran (its class), the capsules used at the peak, the snapshots taken, the context used (approximately).

## Open questions
What the coordinator must decide. Empty is correct.
```

Commits go back by `git push` when the worker can push. When it cannot: `git format-patch` or `git bundle create <stream>.bundle <base>..<branch>` in its workspace, `transfer` of that file to the workspace the task names, and the coordinator applies it there (`git am`, or `git fetch <file> <branch>`). A worker in a fork does not snapshot to hand work back: a fork is detached, so its commit would sit on the base volume with no branch.

## 1. Solo (the default)

| | |
|---|---|
| Purpose | One bounded change: a feature, a fix, a refactor |
| Scope | The workspaces the task lists. The desk's environment is read-only unless the task grants an intercept |
| Tools | Each worker tool of `permissions.md` |
| End state | Commit and push (unfinished work on a git branch on origin), or hand the commits back as a file. A code change alone is no reason for a volume commit: code reaches the next session through git (pushed to origin, unfinished work on a git branch; the next workspace pulls it). Environment state the task asks to keep, when the workspace is not a fork: `workspace` `snapshot` onto the branch the task names, a `message` that says what changed, and `name@<branch>` in the report. `REPORT.md`. The coordinator deletes the workspace |
| Must not | Use a workspace the task does not list; create, fork, stop or delete a workspace; create or fork an environment or a desk; name a volume; move `base` or a branch the task does not name |

## 2. Throwaway experiment

| | |
|---|---|
| Purpose | Answer one question: does approach X work, how fast is Y, what breaks if Z |
| Scope | One fork of a base workspace, made by the coordinator with a short TTL, or one capsule |
| Tools | The worker tools without `workspace` `snapshot`, `pipeline` `save` and `container_push`. Nothing that it makes outlives it |
| End state | The only output is `REPORT.md`. If the code has value, the report says so, and the coordinator gives the work again as a Solo task. The coordinator deletes the fork |
| Must not | Persist anything; intercept anything |

For a matrix, the coordinator reads `quota`, makes N forks, gives N workers one each and compares N reports.

## 3. Desk verification

| | |
|---|---|
| Purpose | Prove that a set of changes works end to end against real services |
| Scope | The workspaces under test, in a desk connected to a fork of the environment that the coordinator made. The shared environment only when the task says so and names the service |
| Tools | The worker tools, `intercept` on the named services, and `capsule` `create` for the test run |
| End state | Stop each intercept. `REPORT.md` with the end of the full test log. The coordinator deletes the environment fork |
| Must not | Change code (it reports a failure, it does not repair it); leave an intercept in force |

## 4. Pipeline authoring

| | |
|---|---|
| Purpose | Make a saved pipeline from a workflow that ran the same way three times or more |
| Scope | One workspace for the draft; one pipeline definition of the owner that the task names |
| Tools | The worker tools, `pipeline` `save`, and `run` `start`, `wait` and `logs`. No webhook and no schedule: the coordinator adds a trigger after it reads the definition |
| End state | The pipeline saved and run one time by hand with a result of `success`. `REPORT.md` with the definition and the run id |
| Must not | Touch an environment; put a secret value in a definition (references only) |

## How a coordinator writes a task

One short block, in this order:

1. The template name.
2. The goal in one sentence, in the person's words.
3. The workspaces the worker uses, by name; each parallel worker gets its own.
4. What "done" means: a command that passes, a pushed branch, an answered question.
5. The budget: capsules, and a time limit.
6. What is granted beyond the template, such as one named intercept.
7. The model class (`models.md`): standard for a clear task, light for mechanical work, one class up after a failed attempt.
8. Where the work goes at the end: "push the branch" (unfinished work too, on its own git branch) or "hand the commits back as a file"; a snapshot only when the task changes environment state, onto the branch the brief names.
9. When the work is split under a plan file (`planning.md`): the path of the plan, the files that this worker owns, and its branch.

A task that does not say what "done" means goes back to the coordinator.
