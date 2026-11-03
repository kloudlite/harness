//! The server `instructions` every door answers once, so no tool description repeats it. The remote
//! door (crates/workspaces/src/api/mcp/local.rs) and the laptop door (bins/kloudlite/src/mcp.rs) keep
//! a copy; the test below holds this one under 1200 characters so the copies stay small.
export const INSTRUCTIONS = `Kloudlite runs code in workspaces (dev machines with a home volume) and environments (stacks of services), joined by one session. Teams are isolated.
- A resource tool takes \`action\` plus that action's arguments and answers the object, a list or {"ok":true}. Names and ids both work. A failure is JSON {error, hint?, schema?}.
- \`session use\` moves the session to another environment; \`environment: null\` disconnects it.
- \`timeout_ms\` is how long a \`wait\` action waits (default 25000; a remote door cuts every wait at 90 s). At the limit the answer has \`timed_out: true\`: call it again.
- \`wait: true\` on create, start, restore or run start waits \`soft_ms\` (default 25000), then answers {promoted: true, id, kind}: call the \`kind\` tool's \`wait\` action with \`id\` (kind session: \`get\`).
- \`exec\` and \`container_build\` hand off the same way with kind \`process\`: loop \`process\` \`wait\` with \`since\`/\`since_err\` = the last \`next\`/\`next_err\` until \`state\` is not running.
- Destructive actions (delete, kill, cancel, restore) ask the person first.
- A path starting with \`scratch:\` in read or write is the session's scratch folder.`;
