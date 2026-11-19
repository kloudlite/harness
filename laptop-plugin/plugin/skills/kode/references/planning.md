# Planning work that is split

Plan centrally, execute in parallel. One coordinator writes one plan file. Each worker reads it and works alone. This file gives the method and a template of the plan file. A session that cannot delegate uses the same plan for itself: it writes the contracts first, then does the streams one after the other.

## When to write a plan file

Write one when two or more workers change things that must fit together: an API and its caller, a schema and its reader, a tool and its documentation. Work that shares no name, field or file needs only a brief for each worker (`worker-templates.md`).

## The method

1. **Design first when the shape is open.** When the right data model, protocol or architecture is not yet clear, a separate design agent on the deep class answers it first (`models.md`), and the plan is written from its `DESIGN.md`.
2. **Read first.** The coordinator reads the project `memory`, every section, so the plan uses the volumes, environments and conventions that exist (and any change that `open-work` already proposes), and it reads enough of the code to name the real files, types and routes. A contract that guesses a name costs each worker a correction.
3. **Write the contracts before any worker starts.** A contract is what two streams must agree on: names, fields, arguments, limits, error sentences, and who owns which files. Write the exact words. Leave the inside of a stream to its worker.
4. **Give each file one owner.** Two streams never edit the same file. When two streams need one file, one stream owns it and the contract says what it must put there.
5. **Put the plan in the base workspace.** Write it as one file at the root of the source folder (`~/workspace/PLAN.md`). Each fork of the base then carries it.
6. **Give each parallel stream its own workspace.** Read `quota` first. The coordinator makes one fork of the base per stream: `workspace` `fork` with `source`, a name `<base>-<stream>`, a `task` that names the stream and `ttl_secs`. A fork starts ready: the code, the packages and the plan are in it. A fork is never snapshotted: it shares the volume of the base. Never give two workers one workspace; when two streams must share one, the plan splits its files between them.
7. **Give each worker its task.** `worker_ask` with the workspaces it uses (its fork, and any other it needs), the plan file, the stream, the files that the worker owns, its branch and what "done" means (a command that exits 0). `worker-templates.md` gives the order of a task.
8. **Workers never negotiate with each other.** A Worker that finds a gap or an error in a contract stops that part, says so in `REPORT.md` and goes on with what the gap does not touch. The coordinator corrects the plan file and tells each worker that the change touches. A contract changes in one place only.
9. **Integrate in a fixed order.** The plan names the order: the stream that others build on goes first. The coordinator reads each `REPORT.md`, takes the branches in that order into the base workspace (a pushed branch, or a patch or bundle file that the worker sent with `transfer`), deletes each fork when its commits are taken, and runs the whole test set once. A failure goes back to the worker that owns the file, with the end of the log.
10. **End the session.** Push and merge the result; work that is left goes to a git branch on origin. A code change alone is no reason for a volume commit: code reaches the next session through git (pushed to origin, unfinished work on a git branch; the next workspace pulls it). Refresh the base only when the environment changed (convention 8 of the skill): the merged default branch checked out, the whole test set passed, credentials removed from the home, then the base workspace's `workspace` `delete` with `save: true` (`base` advances); a failed run moves no base and `open-work` says so. `memory` `write`: the volume, and the open work with its git branch. Delete every workspace, the forks and the base included: a plain `delete` takes no snapshot (it refuses, naming the difference, when packages, image or variables changed since the base: `save: true` or `skip_snapshot: true`).

## What makes a contract good

- It can be checked: a field name, a type, a limit, a status code, a sentence.
- It says what an absent value means, and what an old object looks like.
- It names the test that proves it, when one side must prove it to the other.
- It holds no reason that a worker must work out again: the "why" has its own section.

## Template of the plan file

```markdown
# Plan: <what changes, in one line>

Written by the coordinator on <date>. Every worker reads this file first. It is the contract between the streams: do not change a name, a field or a limit in it. If it is wrong, stop and say so in your REPORT.md.

## Why
Two or three sentences: the problem and what is true when the work is done.

## Repositories
- `~/workspace/<repo>`: what it holds and which parts this work touches.
- The files to read before an edit (the rules of the repository).
- How a commit leaves the workspace: push, or a patch or bundle file sent with `transfer` to the base workspace.

## Contract 1: <the data>
Each new field: its name, its type, its limits, what an absent value means, who writes it.

## Contract 2: <the API or the interface>
Each route, call or argument: its name, the input, the answer, each refusal with its status and its sentence.

## Contract 3: <the next layer>
The same, for each layer that two streams meet at.

## Work streams
| Stream | Worker | Workspaces | Owns (edits only these) | Branch | Model class |
|---|---|---|---|---|---|
| A. <name> | `<worker>` | `<base>-a` | `<paths>` | `<branch>` | standard |
| B. <name> | `<worker>` | `<base>-b` | `<paths>` | `<branch>` | light |

Integration order: A, then B. What a stream must hold back, when another stream must land first.

## Every worker
- Work only on the workspaces of your task, only in the files of your stream.
- How to commit: the branch, the author, the form of the subject.
- How to build and test: the commands, and what not to run.
- Leave `REPORT.md`: outcome, commits, how it was verified, what is not verified, open questions.
- Never fork, stop, snapshot or delete a workspace: the coordinator ends it. A fork is never snapshotted.
```

## Mistakes

- A contract written after the workers start: each worker has by then picked its own names.
- Two streams that own one file: the second merge loses work.
- Two workers on one workspace: each overwrites the other's files and processes.
- A worker that asks another worker: two private agreements replace one contract.
- Tests run in each fork only: the parts pass alone and fail together. Run the whole set once, after the last merge.
- Forks left after the merge: each holds a slot and its disk.
