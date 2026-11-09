//! The server `instructions` every door answers once, so no tool description repeats it. The remote
//! door (crates/workspaces/src/api/mcp/local.rs) and the laptop door (bins/kloudlite/src/mcp.rs) keep
//! a copy; the test below holds this one under 1200 characters so the copies stay small.
export const INSTRUCTIONS = `Kloudlite runs code in workspaces (dev machines with a home volume) and environments (stacks of services), joined by one desk. Teams are isolated.
- A resource tool takes \`action\` plus that action's arguments and answers an object, a list or {"ok":true}. Names and ids work. A failure is JSON {error, hint?, schema?}.
- \`desk\` on any call picks the desk it acts in; \`desk use\` changes this connection's default and its environment (\`environment: null\` disconnects).
- \`wait: true\` on create, start, restore or run start waits \`soft_ms\` (default 5000, as \`exec\` does); \`timeout_ms\` is how long a \`wait\` action waits.
- A long call answers within seconds with {promoted, id, kind, poll_after_ms} (clients that wait on MCP tasks never see it): after poll_after_ms call the \`kind\` tool's \`wait\` with \`id\` (kind desk: \`get\`; kind process: loop \`process wait\` with \`since\`/\`since_err\` = the last \`next\`/\`next_err\` until \`state\` is not running). A remote door cuts a wait at 20 s; \`timed_out: true\`: call again.
- Each turn, call \`status\` first.
- Destructive actions (delete, kill, cancel, restore) ask first.
- A path starting with \`scratch:\` in read or write is the desk's scratch folder.`;
