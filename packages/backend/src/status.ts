//! The bench `status` tool: undelivered notices plus what is running, so a client that never
//! shows the `notices` content item still learns of a crashed process. Each part is read defensively.
import { podPost, sessionWorkspaces, touched } from "@kloudlite-tui/tools";
import type { ToolDef } from "@kloudlite-tui/tools";
import { recentNotices, sessionEnvironment } from "./crash.ts";

const orNull = async <T>(f: () => Promise<T>, d: T): Promise<T> => { try { return await f(); } catch { return d; } };

export const statusTool: ToolDef = {
  name: "status",
  description: "Undelivered notices (process crashes, restarts, state changes), the session's workspaces and environment with their states and running processes. Call once at the start of each turn. `all` re-lists the last 50 notices.",
  inputSchema: { type: "object", properties: { all: { type: "boolean", description: "Include notices already delivered." } } },
  async run(a: any) {
    const notices = recentNotices(!!a?.all);
    const rows = await orNull(() => sessionWorkspaces(), [] as any[]);
    const workspaces = rows.map((w) => ({ name: w.name ?? w.id, state: w.state }));
    const environment = await orNull(sessionEnvironment, null);
    // the session's workspaces and every one a tool touched, by id, each read bounded (podPost: 8 s)
    const names = new Map<string, string>(rows.map((w) => [w.id, w.name ?? w.id]));
    for (const id of touched.keys()) names.has(id) || names.set(id, id);
    const lists = await Promise.all([...names].map(async ([id, name]) => {
      const l = await orNull(async () => ((await podPost<any>(id, "process_list", {}, 8000))?.processes ?? []) as any[], []);
      return l.filter((p) => p.state === "running").map((p) => ({ workspace: name, id: p.id, cmd: p.cmd }));
    }));
    return JSON.stringify({ notices, workspaces, environment, processes: lists.flat() });
  },
} as ToolDef;
