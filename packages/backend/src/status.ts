//! The bench `status` tool: undelivered crash notices plus what is running, so a client that never
//! shows the `notices:` prefix still learns of a crashed process. Each part is read defensively.
import { apiJson, podPost, touched } from "@kloudlite-tui/tools";
import type { ToolDef } from "@kloudlite-tui/tools";
import { recentNotices } from "./crash.ts";

const orNull = async <T>(f: () => Promise<T>, d: T): Promise<T> => { try { return await f(); } catch { return d; } };

export const statusTool: ToolDef = {
  name: "status",
  description: "Undelivered notices (process crashes, restarts), workspace and environment states and running processes. Call once at the start of each turn. `all` re-lists the last 50 notices.",
  inputSchema: { type: "object", properties: { all: { type: "boolean", description: "Include notices already delivered." } } },
  async run(a: any) {
    const notices = recentNotices(!!a?.all);
    const workspaces = await orNull(async () => ((await apiJson<any[]>("GET", "/v1/workspaces")) ?? []).map((w) => ({ name: w.name ?? w.id, state: w.state })), [] as any[]);
    const environment = await orNull(async () => {
      const id = process.env.KL_SESSION;
      if (!id) return null;
      const s = await apiJson<any>("GET", `/v1/sessions/${encodeURIComponent(id)}`);
      const e = s?.environment;
      if (!e) return null;
      const name = typeof e === "string" ? e : e.name ?? e.id;
      const v = await orNull(() => apiJson<any>("GET", `/v1/environments/${encodeURIComponent(name)}`), null);
      return { name, state: v?.state ?? e?.state ?? "unknown" };
    }, null as { name: string; state: string } | null);
    const processes: { workspace: string; id: string; cmd?: string }[] = [];
    for (const ws of touched.keys()) {
      const l = await orNull(async () => ((await podPost<any>(ws, "process_list", {}, 8000))?.processes ?? []) as any[], []);
      for (const p of l) if (p.state === "running") processes.push({ workspace: ws, id: p.id, cmd: p.cmd });
    }
    return JSON.stringify({ notices, workspaces, environment, processes });
  },
} as ToolDef;
