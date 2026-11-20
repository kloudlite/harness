# Processes: right and wrong

The workspace's tool server lists every process it started in `process` `list`. That list is the whole rule: a workspace stays awake while one of its processes runs, and its netgroup with it. A **background process** is a listed process that runs on after its call answered: `exec` with `background: true`, or an `exec` past its `soft_ms`. An **untracked** process is one a command left behind inside an exec with `&`, `nohup`, `setsid`, `disown` or a program's own daemon fork. It is not listed, it keeps nothing awake, and it ends with its exec.

Each case below gives the right calls, then the wrong one.

## 1. Start a dev server

Right:

```
exec {workspace: "web", cmd: "npm run dev", background: true}   -> {id: "p-…"}
process {action: "output", workspace: "web", id: "p-…", tail: 20}            -> "ready on :3000"
exec {workspace: "web", cmd: "curl -s localhost:3000/health"}
```

Wrong: `exec {cmd: "npm run dev &"}`. The server is untracked, dies when the exec returns, and nobody can read its log.

## 2. A long build or test suite

Right:

```
exec {workspace: "api", cmd: "cargo test -j 6 > ~/notes/test.log 2>&1", background: true}   -> {id: "p-…"}
process {action: "wait", workspace: "api", id: "p-…", timeout_ms: 600000}               -> {timed_out: true, next, next_err}
process {action: "wait", workspace: "api", id: "p-…", since: next, since_err: next_err}  -> {state: "exited", exit_code: 0}
exec {workspace: "api", cmd: "tail -n 40 ~/notes/test.log"}
```

Call `wait` again while it answers `timed_out: true`, with `since` and `since_err` from the last answer. A remote connector cuts each wait at 20 s (a cut says `clamped`), so the loop is the same, only longer.

Wrong: `exec {cmd: "sleep 30; tail ~/notes/test.log"}` in a loop. Each call costs a turn and often a permission prompt, and it learns less than `wait`. Also wrong: `exec {cmd: "nohup cargo test &"}`, which is untracked and ends with its exec.

## 3. A watcher or a database a test needs

Right: a watcher is a background process. A database, queue or broker is a service of the environment, never a process in the workspace (`services.md`).

```
exec {workspace: "web", cmd: "npx tsc --watch --preserveWatchOutput", background: true}   -> {id: "p-…"}
env {action: "create", name: "web-test", services: [{name: "db", image: "postgres:16", ports: [5432], mounts: [...]}]}
```

Stop each when the tests are done: `process` `kill` for the watcher, `env` `delete` for a copy you made.

Wrong: `exec {cmd: "postgres -D ~/pg &"}`. It is untracked, and a database belongs in the environment.

## 4. Done with a server

Right:

```
process {action: "list", workspace: "web"}                  -> [{id: "p-…", cmd: "npm run dev", state: "running"}]
process {action: "kill", workspace: "web", id: "p-…"}       -> {state: "exited"}
```

A listed process that runs keeps the workspace and its netgroup awake, so the idle stop never comes. Kill what you no longer need.

Wrong: leaving the dev server running at the end of a task. The workspace then never idles until its TTL or a delete.

## 5. Something that must not keep the workspace awake

This is rare and deliberate: a helper that only the rest of one command needs. Say "untracked on purpose" in your answer.

```
exec {workspace: "api", cmd: "./server & sleep 1; curl -s localhost:8080/health; kill %1"}
```

The helper ends when this exec returns, whatever the command does. Anything that must outlive its call is a background process (case 1).

## 6. A tool that forks itself into a daemon

Right: run it in its foreground mode as a background process, so the process you started is the one that works.

```
exec {workspace: "app", cmd: "gradle build --no-daemon", background: true}
exec {workspace: "app", cmd: "ssh-agent -D -a ~/.ssh/agent.sock", background: true}
```

Wrong: `exec {cmd: "gradle --daemon build"}` or a tool's `-d` or `--daemonize` flag. The daemon leaves the listed process, is untracked, and ends with the exec.

## 7. What is running

Right: `process {action: "list", workspace: "web"}`. It lists every exec, build and watch, running and finished, and `status` lists the running ones of the desk.

Wrong: `exec {cmd: "ps aux"}`. An exec sees only its own processes. Anything not in `process` `list` is untracked and may be gone after its exec.
