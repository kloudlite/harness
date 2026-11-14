# Errors

The status comes first; the body is one sentence. Report it as it is, then take the action.

| Error | Action |
|---|---|
| `409` `{dimension}: {used} of {limit} in use; request more under Quota` | Do not retry. Tell the user. Free something, or `request_create` kind `quota` when asked. A pipeline job refused by `capsules`, `cpu` or `memoryGb` waits up to 30 minutes instead (`waiting for quota: …`). |
| `403 your access to {team} is paused` | A team admin must unpause. Stop. |
| `403 you are no longer a member of {team}` | Stop. The user cannot act there. |
| `404 not found` | The object does not exist or is not the user's. Check the id with the list tool. |
| `422` name rule (`name must be 1-40 lowercase letters, digits or '-'…`) | Rename: lowercase, hyphens, starts with a letter, no `--`, not `ws`, `env`, `api`, `admin`, `system`, `kd`. |
| `409 a workspace named "x" already exists here` (also environment, desk) | Reuse it, or pick another name. |
| `409` `"x" is ambiguous; qualify it as owner/name` | Use the id or `team/name`. |
| `409 workspace is interrupted: its storage is moving; it resumes in seconds` | Wait, then read the object again. |
| `409 no storage disk has room for {n} GiB; retry later or ask an operator` | Tell the user. |
| `409 a snapshot is already being cut for this workspace` | Wait, read the volume history, do not repeat. |
| `409 this snapshot is the base of a running worktree` | Keep it; tell the user. |
| `409 the volume still has a workspace or environment` | Delete the owner first, if the user asked. |
| `409 this desk has no environment; connect one…` | `desk` action `create` with `environment` makes a desk that has one. |
| `409 conflict, retry` / `the desk changed; retry` | Read again, repeat once. |
| `env` action `restore` `409` with `lost` | Name the services; call again with `discard` only after a yes. |
| `422` for a package; the answer lists versions | Pick a listed version. |
| `422 volume: this volume has no name yet; name it on its first push` | Ask for a name; give `volume`. |
| `409 volume {name} already exists; delete it first` | Ask for another name. |
| `409 volume {name} is used by {readers}` | A pipeline reads it. Tell the user. |
| `404 volume {name} has no version {n}` / `has no ready version` | List with `volume` action `get`. |
| `no git connector of {owner} covers {host}/{repo}` | The user connects the code host in the web console. |
| `no registry is configured` | The user connects a registry in the web console. |
| `422 pipeline {name} is invalid:` + lines | Fix every line, save again. |
| `422 pipeline {name} cannot run:` + lines | A missing input or secret. Fix the cause, start again. |
| `409 pipeline {name} changed; retry` | Read the newest version, apply the change, save. |
| `409 … not ready yet` (restore or create from a snapshot) | The snapshot is not restorable yet: retry after a few seconds. |
| `409 this run has already finished` | Nothing to cancel. |
| `403 only a team admin can change team pipelines` | Tell the user. |
| `429 this token has {n} runs in flight` | Wait for a run to end. |
| `not logged in — run kode login` | The user runs it, then restarts the client. |
