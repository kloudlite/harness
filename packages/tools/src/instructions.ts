//! The server `instructions` every door answers once, so no tool description repeats it. The remote
//! door (crates/workspaces/src/api/mcp/local.rs) and the laptop door (bins/kloudlite/src/mcp.rs) keep
//! a copy; the test below holds this one under 1200 characters so the copies stay small.
export const INSTRUCTIONS = `Kloudlite runs code in workspaces (dev machines with a home volume) and environments (a stack of services), joined by one session.
- \`session use\` moves the session to another environment; \`environment: null\` disconnects it. Teams are isolated.
- Names and ids are both accepted for a workspace, environment, session or sandbox.
- A resource tool takes \`action\` plus that action's arguments. It answers the document, a list, or {"ok":true}. A bad call answers the action's schema.
- Async actions return at once. \`wait: true\` waits until the object settles: \`timeout\` seconds (default 300, max 900; a remote door cuts every wait at 90 s). Past the bound the answer has \`timedOut: true\`: call \`wait\` again.
- \`exec\` waits 25 s, then keeps the job as a process and answers its id. Loop \`process\` \`wait\` with \`since\`/\`since_err\` = the last \`next\`/\`next_err\` until \`state\` is not running.
- Destructive actions (delete, kill, cancel, restore) ask the person first.
- A path starting with \`scratch:\` in read or write is the session's scratch folder.`;
