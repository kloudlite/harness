# Worker templates and the hand-off report

A Worker is one session with the resources that it created or that its brief names. A template is the brief that a Coordinator gives it: scope, tools, end state and the report that it must leave. Four templates cover most work. A template is not a new agent type.

## The hand-off report

A Worker never hands off through chat context. It leaves one file, `REPORT.md`, at the root of its workspace home, commits it when there is a repository, and names it in its last message. The Coordinator reads this file before anything else.

```markdown
# Report: <task name>

## Outcome
One line: done, partial, blocked or discarded.

## What changed
The branch or commit, or "nothing persisted". The files touched, one per line.

## How it was verified
The command, its exit code and the last 20 lines of its output. "Not verified" is an allowed answer. A claim without this section is not.

## Resources left
Each storage commit or pipeline saved: the volume, the branch it is on (`name@wip-auth`) and its number, whether it is good or what is left, and what is inside. Each workspace or environment that still runs, only when the brief says that the Coordinator removes it. A stopped workspace is never left. Empty means that everything was deleted.

## Budget spent
The slots used at the peak, the snapshots taken, the context used (approximately).

## Open questions
What the Coordinator must decide. Empty is correct.
```

A Worker that deletes its workspace copies `REPORT.md` first, with `transfer`, to the workspace that the brief names. When the brief names none, the report is its last message.

Commits go back the same way when the Worker does not push: `git format-patch` or `git bundle create <stream>.bundle <base>..<branch>` in its workspace, `transfer` of that file to the workspace that the brief names, and the Coordinator applies it there (`git am`, or `git fetch <file> <branch>`). A Worker in a clone does not snapshot to hand work back: a clone is detached, so its commit would sit on the base volume with no branch.

## 1. Solo (the default)

| | |
|---|---|
| Purpose | One bounded change: a feature, a fix, a refactor |
| Scope | One workspace, created or handed over. The desk's environment is read-only unless the brief grants an intercept |
| Tools | Each Worker tool of `permissions.md` |
| Sub-Workers | In clones of its own workspace, one level, for independent and verifiable parts |
| End state | Commit and push, or hand the commits back as a file. Unfinished work that cannot go to git, when the workspace is not a clone: `workspace` `snapshot` onto the branch that the brief names (`branch: "wip-<topic>"`), a `message` that says what is left, and `name@wip-<topic>` in the report. Then delete the workspace, unless the brief says that the Coordinator ends it. `REPORT.md` |
| Must not | Touch the resources of another desk; create or clone an environment or a desk; name a volume; move `base` or a branch the brief does not name; leave a stopped workspace |

## 2. Throwaway experiment

| | |
|---|---|
| Purpose | Answer one question: does approach X work, how fast is Y, what breaks if Z |
| Scope | One clone of a named base workspace, or one capsule. A TTL of a few hours at most, set in the turn that creates it |
| Tools | The Worker tools without `workspace` `snapshot`, `pipeline` `save` and `container_push`. Nothing that it makes outlives it |
| Sub-Workers | No |
| End state | Delete everything. The only output is `REPORT.md`. If the code has value, the report says so, and the Coordinator runs the work again as a Solo |
| Must not | Persist anything; intercept anything |

For a matrix, the Coordinator reads `quota`, starts N of these in parallel and compares N reports.

## 3. Desk verification

| | |
|---|---|
| Purpose | Prove that a set of changes works end to end against real services |
| Scope | A desk with the workspaces under test, connected to a clone of the environment by default. The shared environment only when the brief says so and names the service |
| Tools | The Worker tools, `intercept` on the named services, and `capsule` `create` for the test run |
| Sub-Workers | No |
| End state | Stop each intercept. Delete the environment clone unless the brief says to keep it. `REPORT.md` with the end of the full test log |
| Must not | Change code (it reports a failure, it does not repair it); leave an intercept in force |

## 4. Pipeline authoring

| | |
|---|---|
| Purpose | Make a saved pipeline from a workflow that ran the same way three times or more |
| Scope | One workspace for the draft; one pipeline definition of the owner that the brief names |
| Tools | The Worker tools, `pipeline` `save`, and `run` `start`, `wait` and `logs`. No webhook and no schedule: the Coordinator adds a trigger after it reads the definition |
| Sub-Workers | No |
| End state | The pipeline saved and run one time by hand with a result of `success`. The draft workspace deleted. `REPORT.md` with the definition and the run id |
| Must not | Touch an environment; put a secret value in a definition (references only) |

## How a Coordinator writes a brief

One short block, in this order:

1. The template name.
2. The task in one sentence.
3. The resources handed over, by name.
4. What "done" means: a command that passes, a merged branch, an answered question.
5. The budget: slots and a time limit.
6. What is granted beyond the template, such as one named intercept.
7. Where the work goes at the end: "push the branch", "hand the commits back as a file", "a snapshot onto `wip-<topic>`, named in the report", or "leave the workspace, the Coordinator ends it".
8. When the work is split under a plan file (`planning.md`): the path of the plan, the files that this Worker owns, and its branch.

A brief that does not say what "done" means goes back to the Coordinator.
