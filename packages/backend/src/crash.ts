//! Crash notices (crash.ts; watch.ts is the board watcher) for the processes of the workspaces a tool touched in the last hour (spec
//! 2026-11-04-mcp-fixes item 4). Every 10 s: `process_list` per workspace, the last state kept per
//! (workspace, id); a running -> exited with a non-zero code (or any exit under `always`), or a
//! `killed_by_restart` entry not yet reported, becomes one notice with the last 20 stderr lines.
//! Delivery is the daemon's: a running main session gets it as a message, otherwise it waits in
//! `notices` for the next MCP tool answer (mcp.ts), which has no server-to-client push.
import { apiJson, podPost, processNotify, touched as podTouched, type Notify } from "@kloudlite-tui/tools";

type Proc = { id: string; cmd?: string; state?: string; exit_code?: number | null; restarted_at?: string | number; started_at?: string | number };

export type WatchDeps = {
  touched: Map<string, number>;
  list(ws: string): Promise<Proc[]>;
  stderr(ws: string, id: string): Promise<string>;
  /** `restarts` of the workspace (`GET /v1/workspaces/{id}`), read defensively: [] when absent. */
  restarts(ws: string): Promise<{ at: string | number; reason?: string }[]>;
  notify(msg: string): void;
  notifyOf: Map<string, Notify>;
  now(): number;
};

/** Notices waiting for an MCP client's next tool answer (one bench, one person: not per connection). */
const queue: string[] = [];
export const queueNotice = (m: string) => void (queue.push(m), queue.length > 50 && queue.shift());
export const drainNotices = (): string[] => queue.splice(0);

const ms = (t: string | number | undefined) => {
  const n = typeof t === "number" ? t : /^\d+(\.\d+)?$/.test(String(t)) ? Number(t) : NaN;
  return Number.isNaN(n) ? Date.parse(String(t)) : n < 1e12 ? n * 1000 : n;
};
const tail = (s: string, n = 20) => s.trimEnd().split("\n").slice(-n).join("\n");

export function createWatch(d: WatchDeps) {
  const last = new Map<string, string>();
  const killed = new Set<string>();
  return async function tick(): Promise<void> {
    for (const [ws, at] of d.touched) {
      if (d.now() - at > 3_600_000) continue;
      let procs: Proc[];
      try {
        procs = await d.list(ws);
      } catch {
        continue;
      }
      for (const p of procs) {
        const key = `${ws}/${p.id}`;
        const mode = d.notifyOf.get(key) ?? "on_failure";
        const prior = last.get(key) ?? (d.notifyOf.has(key) ? "running" : undefined);
        const state = p.state === "running" ? "running" : p.state === "killed_by_restart" ? "killed" : "exited";
        last.set(key, state);
        const cmd = p.cmd ?? "";
        try {
          if (state === "killed") {
            if (killed.has(key)) continue;
            killed.add(key);
            if (mode === "never") continue;
            const reason = (await d.restarts(ws).catch(() => [])).find((r) => Math.abs(ms(r.at) - ms(p.restarted_at)) <= 60_000)?.reason;
            d.notify(`[process ${p.id} in ${ws} killed by a workspace restart at ${p.restarted_at}${reason ? `, ${reason}` : ""}] ${cmd}`);
          } else if (state === "exited" && (prior === "running" || (prior === undefined && d.now() - ms(p.started_at) <= 3_600_000))) {
            // first seen already exited (a short process between two beats): report it once if it started within the hour
            const code = p.exit_code ?? -1;
            if (mode === "never" || (mode === "on_failure" && code === 0)) continue;
            const err = tail(await d.stderr(ws, p.id).catch(() => ""));
            d.notify(`[process ${p.id} in ${ws} exited ${code}] ${cmd}${err ? `\n${err}` : ""}`);
          }
        } catch {}
      }
    }
  };
}

/** The live wiring: the pod's own tools, notices into `notify`. */
export const liveWatch = (notify: (m: string) => void) =>
  createWatch({
    touched: podTouched,
    list: async (ws) => ((await podPost<any>(ws, "process_list", {}, 8000))?.processes ?? []) as Proc[],
    stderr: async (ws, id) => String((await podPost<any>(ws, "process_output", { id, since_err: 0 }, 8000))?.stderr ?? ""),
    restarts: async (ws) => (await apiJson<any>("GET", `/v1/workspaces/${encodeURIComponent(ws)}`))?.restarts ?? [],
    notify,
    notifyOf: processNotify,
    now: Date.now,
  });
