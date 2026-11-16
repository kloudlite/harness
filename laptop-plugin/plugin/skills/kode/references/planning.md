# Planning work that is split

Plan centrally, execute in parallel. One Coordinator writes one plan file. Each Worker reads it and works alone. This file gives the method and a template of the plan file. A session that cannot delegate uses the same plan for itself: it writes the contracts first, then does the streams one after the other.

## When to write a plan file

Write one when two or more Workers change things that must fit together: an API and its caller, a schema and its reader, a tool and its documentation. Work that shares no name, field or file needs only a brief for each Worker (`worker-templates.md`).

## The method

1. **Read first.** The Coordinator reads enough of the code to name the real files, types and routes. A contract that guesses a name costs each Worker a correction.
2. **Write the contracts before any Worker starts.** A contract is what two streams must agree on: names, fields, arguments, limits, error sentences, and who owns which files. Write the exact words. Leave the inside of a stream to its Worker.
3. **Give each file one owner.** Two streams never edit the same file. When two streams need one file, one stream owns it and the contract says what it must put there.
4. **Put the plan in the base workspace.** Write it as one file at the root of the source folder (`~/workspace/PLAN.md`). Each clone of the base then carries it.
5. **Make one clone of the base for each Worker.** Read `quota` first. `workspace` `create` with `source`, a `task` that names the stream, then `ttl`. A clone starts ready: the code, the packages and the plan are in it.
6. **Give each Worker a brief.** The brief names the workspace, the plan file, the stream, the files that the Worker owns, its branch and what "done" means (a command that exits 0). `worker-templates.md` gives the order of a brief.
7. **Workers never negotiate with each other.** A Worker that finds a gap or an error in a contract stops that part, says so in `REPORT.md` and goes on with what the gap does not touch. The Coordinator corrects the plan file and tells each Worker that the change touches. A contract changes in one place only.
8. **Integrate in a fixed order.** The plan names the order: the stream that others build on goes first. The Coordinator reads each `REPORT.md`, takes the branches in that order into one workspace, and runs the whole test set once. A failure goes back to the Worker that owns the file, with the end of the log.
9. **End the session.** Push the result. Save the base as the next version of its volume when the work changed what a session starts from. `memory` `write`: the volume version and the open work. Delete every workspace, the clones and the base included.

## What makes a contract good

- It can be checked: a field name, a type, a limit, a status code, a sentence.
- It says what an absent value means, and what an old object looks like.
- It names the test that proves it, when one side must prove it to the other.
- It holds no reason that a Worker must work out again: the "why" has its own section.

## Template of the plan file

```markdown
# Plan: <what changes, in one line>

Written by the Coordinator on <date>. Every Worker reads this file first. It is the contract between the streams: do not change a name, a field or a limit in it. If it is wrong, stop and say so in your REPORT.md.

## Why
Two or three sentences: the problem and what is true when the work is done.

## Repositories
- `~/workspace/<repo>`: what it holds and which parts this work touches.
- The files to read before an edit (the rules of the repository).
- How a commit leaves the workspace: push, or the Coordinator takes it.

## Contract 1: <the data>
Each new field: its name, its type, its limits, what an absent value means, who writes it.

## Contract 2: <the API or the interface>
Each route, call or argument: its name, the input, the answer, each refusal with its status and its sentence.

## Contract 3: <the next layer>
The same, for each layer that two streams meet at.

## Work streams
| Stream | Owns (edits only these) | Branch |
|---|---|---|
| A. <name> | `<paths>` | `<branch>` |
| B. <name> | `<paths>` | `<branch>` |

Integration order: A, then B. What a stream must hold back, when another stream must land first.

## Every Worker
- Work only in the workspace of your brief, only in the files of your stream.
- How to commit: the branch, the author, the form of the subject.
- How to build and test: the commands, and what not to run.
- Leave `REPORT.md`: outcome, commits, how it was verified, what is not verified, open questions.
- What the Worker must not do to the workspace (stop, snapshot, delete), when the Coordinator ends it.
```

## Mistakes

- A contract written after the Workers start: each Worker has by then picked its own names.
- Two streams that own one file: the second merge loses work.
- A Worker that asks another Worker: two private agreements replace one contract.
- Tests run in each clone only: the parts pass alone and fail together. Run the whole set once, after the last merge.
- Clones left after the merge: each holds a slot and its disk.
