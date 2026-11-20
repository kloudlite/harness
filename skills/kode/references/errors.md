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
| `409 the storage pool is full; retry later or ask an operator` | Tell the user. |
| `409 a snapshot is already being cut for this workspace` | Wait, read the volume history, do not repeat. |
| `409 this snapshot is the base of …` / `… is where … stands now (its latest push)` | A live workspace or environment was built from it or last pushed it. Delete that workspace first (after its own snapshot), or keep the commit. |
| `409 snapshot {N} is tagged {t}; move or delete the tag first` | A tagged snapshot is kept. Keep it, or `volume` `untag` it first when nobody starts from that tag any more; never untag `base` to delete its snapshot. |
| `409 the volume still has a workspace or environment` | Delete the owner first, if the user asked. |
| `409 this desk has no environment; connect one…` | `desk` `connect` with `environment`. |
| `409 conflict, retry` / `the desk changed; retry` / `volume {name} is being changed; retry` | Read again, repeat once. |
| `env` action `restore` `409` with `lost` | Name the services; call again with `discard` only after a yes. |
| `422` for a package; the answer lists versions | Pick a listed version. |
| A first snapshot without `volume` | It names the volume after the workspace. Always pass `volume` on the first snapshot of a workspace that was created empty. |
| `409 this volume is named X, not Y (this workspace is a fork of that volume…)` | Drop `volume` or pass X: a fork saves into its source's volume. |
| `409 volume {name} already exists; delete it first` | Ask for another name. |
| `409 volume {name} is used by {readers}` | A pipeline reads it. Tell the user. |
| `409 volume name {to} is taken` | A volume of the owner already has that name. Ask for another name. |
| `404` or `405` with no sentence on `volume` `rename`, or `volume rename is not available on this platform's api yet` | The platform does not have rename yet. Nothing was renamed; tell the user. |
| `404 volume {name} has no commit {n}` / `has no tag {t}` / `has no ready version` | Read `volume` `get`: it lists the snapshots and their tags. A `base` that is gone means that nobody put it on a good snapshot: ask which one is good. |
| `422 tag: "X" must be lowercase letters, digits and hyphens (at most 32), and not a number or "latest"` | Pick another tag name. |
| `422 labels: …` / `tags: at most 16 on one volume` | Fix the list; remove a tag that nobody uses with `volume` `untag`. |
| A snapshot answer says it is `untagged` | It moved no tag and expires 30 days after its last use. Tag it only if a session should start there (`snapshot` `tag`), or let it expire. |
| `no git connector of {owner} covers {host}/{repo}` | The user connects the code host in the web console. |
| `link your GitHub account to push: …` / `your GitHub link has expired; link it again` | The person links GitHub in the web console (Settings, Connectors). Until then the work is an unfinished snapshot, not a push. |
| `connector {name} can only read` | The connector's GitHub App has no write on contents. Tell the user; leave the work as an unfinished snapshot. |
| `no registry is configured` | The user connects a registry in the web console. |
| `422 pipeline {name} is invalid:` + lines | Fix every line, save again. |
| `422 pipeline {name} cannot run:` + lines | A missing input or secret. Fix the cause, start again. |
| `409 pipeline {name} changed; retry` | Read the newest version, apply the change, save. |
| `409 … not ready yet` (a fork from a snapshot) | The snapshot is not restorable yet: retry after a few seconds. |
| `409 this run has already finished` | Nothing to cancel. |
| `403 only a team admin can change team pipelines` | Tell the user. |
| `429 this token has {n} runs in flight` | Wait for a run to end. |
| `not logged in — run kode login` | The user runs it, then restarts the client. |
