//! The server `instructions` every door answers once, so no tool description repeats it. The remote
//! door (crates/workspaces/src/api/mcp/local.rs) and the laptop door (bins/kloudlite/src/mcp.rs) keep
//! a copy; the test below holds this one under 1200 characters so the copies stay small.
export const INSTRUCTIONS = `Kloudlite runs code in workspaces (dev machines with a home volume) and environments (stacks of services), joined by one desk. Teams are isolated.
- A resource tool takes \`action\` plus that action's arguments and answers the object, a list or {"ok":true}. Names and ids both work. A failure is JSON {error, hint?, schema?}.
- \`desk\` on any call picks the desk it acts in; \`desk use\` changes this connection's default and its environment (\`environment: null\` disconnects).
- \`wait: true\` on create, start, restore or run start waits \`soft_ms\` (default 25000); \`timeout_ms\` is how long a \`wait\` action waits (default 25000).
- A long call may answer {promoted: true, id, kind} (clients that wait on MCP tasks never see it): call the \`kind\` tool's \`wait\` with \`id\` (kind desk: \`get\`; kind process: loop \`process wait\` with \`since\`/\`since_err\` = the last \`next\`/\`next_err\` until \`state\` is not running). A remote door cuts a wait at 90 s; \`timed_out: true\` means call again.
- Each turn, call \`status\` first (notices, processes).
- Destructive actions (delete, kill, cancel, restore) ask the person first.
- A path starting with \`scratch:\` in read or write is the desk's scratch folder.`;
