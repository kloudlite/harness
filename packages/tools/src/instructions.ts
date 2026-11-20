//! The server `instructions` every door answers once, so no tool description repeats it. The remote
//! door (crates/workspaces/src/api/mcp/local.rs) and the laptop door (bins/kode/src/mcp.rs) keep
//! a copy; the test below holds this one under 1200 characters so the copies stay small.
export const INSTRUCTIONS = `Kode runs code in workspaces (dev machines with a home volume) and environments (stacks of services), joined by one netgroup.
- A resource tool takes \`action\` plus that action's arguments and answers an object, a list or {"ok":true}. Names and ids work. A failure is {error, hint?, schema?}.
- \`netgroup\` (id or name) on a call names where it acts, else your \`main\`; \`netgroup list\` shows yours, \`connect\` sets one's environment (\`null\` disconnects).
- \`wait: true\` on create, start, restore or run start waits \`soft_ms\` (default 20000; 25000 in the harness); \`timeout_ms\` bounds a \`wait\` action.
- A long call answers with {promoted, id, kind, poll_after_ms} (clients that wait on MCP tasks never see it): call the \`kind\` tool's \`wait\` with \`id\` (netgroup: \`get\`; process: \`process wait\` with \`since\`/\`since_err\` = the last \`next\`/\`next_err\` while \`state\` is running). Remote waits end at 20 s; \`timed_out: true\`: call again.
- Each turn, call \`status\` first.
- What you created here is yours to stop, snapshot and delete once persisted; destroying anything else asks.
- A path starting with \`scratch:\` in read or write is the netgroup's scratch folder.`;
