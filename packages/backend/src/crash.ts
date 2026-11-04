//! Notices (crash.ts; watch.ts is the board watcher) for the workspaces a tool touched in the last hour (specs
//! 2026-11-04-mcp-fixes item 4, 2026-11-04-mcp-consolidated #5-#11). Every 10 s per workspace, keyed by its
//! canonical id: `process_list`, the last state kept per (workspace, id); a running -> exited with a non-zero
//! code (or any exit under `always`) of a process an `exec` registered in `notifyOf` becomes one notice with the
//! last 20 stderr lines (`reported` holds ws/id/started_at, so one exit is one notice). The workspace is read
//! too: a new `restarts` entry, or a state change to stopped/error with no entry, and the session's
//! environment changing state, are notices; a `killed_by_restart` process of the same restart folds into it.
//! Delivery is the daemon's: a running main session gets it as a message, otherwise it waits in
//! `notices` for the next MCP tool answer (mcp.ts), which has no server-to-client push.
import { apiJson, podPost, processNotify, touched as podTouched, type Notify } from "@kloudlite-tui/tools";

type Proc = { id: string; cmd?: string; state?: string; exit_code?: number | null; restarted_at?: string | number; started_at?: string | number };

type Restart = { at: string | number; reason?: string; by?: string; detail?: string };
type WsDoc = { name?: string; state?: string; restarts?: Restart[] };

export type WatchDeps = {
  touched: Map<string, number>;
  list(ws: string): Promise<Proc[]>;
  stderr(ws: string, id: string): Promise<string>;
  /** `GET /v1/workspaces/{id}`, read defensively. */
  workspace(ws: string): Promise<WsDoc | undefined>;
  /** The session's environment and its state; null when there is none. */
  environment(): Promise<{ name: string; state: string } | null>;
  notify(msg: string): void;
  notifyOf: Map<string, Notify>;
  now(): number;
};

/** Notices waiting for an MCP client's next tool answer (one bench, one person: not per connection). */
const queue: string[] = [];
/** The last 50 notices, kept after delivery so the `status` tool can answer ones a client never showed. */
const recent: { at: number; text: string; read: boolean }[] = [];
/** Every notice goes through here, delivered (a running main session got it as a message) or not, so `status` can list what a client never showed. */
export const record = (text: string, delivered: boolean) => void (recent.push({ at: Date.now(), text, read: delivered }), recent.length > 50 && recent.shift());
/** Waits for the next MCP answer; the caller `record`s it (local.ts `notice`). */
export const queueNotice = (m: string) => void (queue.push(m), queue.length > 50 && queue.shift());
export const drainNotices = (): string[] => (recent.forEach((r) => (r.read = true)), queue.splice(0));
/** Unread notices (marked read), or all of the last 50 with `all`. */
export const recentNotices = (all?: boolean): string[] => {
  const out = recent.filter((r) => all || !r.read);
  recent.forEach((r) => (r.read = true));
  queue.length = 0;
  return out.map((r) => r.text);
};

const ms = (t: string | number | undefined) => {
  const n = typeof t === "number" ? t : /^\d+(\.\d+)?$/.test(String(t)) ? Number(t) : NaN;
  return Number.isNaN(n) ? Date.parse(String(t)) : n < 1e12 ? n * 1000 : n;
};
const tail = (s: string, n = 20) => s.trimEnd().split("\n").slice(-n).join("\n");
const same = (a: string | number | undefined, b: string | number | undefined) => Math.abs(ms(a) - ms(b)) <= 60_000;

export function createWatch(d: WatchDeps) {
  const last = new Map<string, string>();
  const reported = new Set<string>();
  /** Per workspace: the restarts already seen and the last state; absent until the first read (the baseline, which reports nothing). */
  const seen = new Map<string, { at: Set<string>; state?: string }>();
  let env: { name: string; state: string } | null | undefined;

  async function workspace(ws: string, killed: Proc[]): Promise<void> {
    const doc = await d.workspace(ws).catch(() => undefined);
    const name = doc?.name ?? ws;
    const restarts = doc?.restarts ?? [];
    const base = seen.get(ws);
    const now = { at: new Set(restarts.map((r) => String(ms(r.at)))), state: doc?.state };
    if (doc) seen.set(ws, now);
    const fresh = base ? restarts.filter((r) => !base.at.has(String(ms(r.at)))) : [];
    const folded = new Set<Proc>();
    for (const r of fresh) {
      const ids = killed.filter((p) => same(p.restarted_at, r.at));
      ids.forEach((p) => folded.add(p));
      d.notify(`[workspace ${name} ${r.reason ?? "restarted"}${r.by && r.by !== "user" ? ` (by ${r.by})` : ""} at ${r.at}${r.detail ? `: ${r.detail}` : ""}${ids.length ? `; killed processes: ${ids.map((p) => p.id).join(", ")}` : ""}]`);
    }
    if (base && !fresh.length && doc?.state !== base.state && (doc?.state === "stopped" || doc?.state === "error")) d.notify(`[workspace ${name} ${doc.state}]`);
    for (const p of killed) {
      const key = `${ws}/${p.id}/${p.restarted_at}/killed`;
      if (folded.has(p)) { reported.add(key); continue; }
      if (reported.has(key)) continue;
      reported.add(key);
      if (d.notifyOf.get(`${ws}/${p.id}`) === "never") continue;
      const reason = restarts.find((r) => same(p.restarted_at, r.at))?.reason;
      d.notify(`[process ${p.id} in ${name} killed by a workspace restart at ${p.restarted_at}${reason ? `, ${reason}` : ""}] ${p.cmd ?? ""}`);
    }
  }

  return async function tick(): Promise<void> {
    for (const [ws, at] of d.touched) {
      if (d.now() - at > 3_600_000) continue;
      let procs: Proc[];
      try {
        procs = await d.list(ws);
      } catch {
        continue;
      }
      const killed: Proc[] = [];
      for (const p of procs) {
        const key = `${ws}/${p.id}`;
        const state = p.state === "running" ? "running" : p.state === "killed_by_restart" ? "killed" : "exited";
        if (state === "killed") { killed.push(p); continue; }
        // only a process an `exec` registered: a plain exec that exited 1 is its own answer, never a notice
        if (!d.notifyOf.has(key)) continue;
        const prior = last.get(key) ?? "running";
        last.set(key, state);
        if (state !== "exited" || prior !== "running") continue;
        const once = `${key}/${p.started_at}`;
        if (reported.has(once)) continue;
        reported.add(once);
        try {
          const mode = d.notifyOf.get(key);
          const code = p.exit_code ?? -1;
          if (mode === "never" || (mode === "on_failure" && code === 0)) continue;
          const err = tail(await d.stderr(ws, p.id).catch(() => ""));
          d.notify(`[process ${p.id} in ${ws} exited ${code}] ${p.cmd ?? ""}${err ? `\n${err}` : ""}`);
        } catch {}
      }
      await workspace(ws, killed);
    }
    const e = await d.environment().catch(() => undefined);
    if (e !== undefined) {
      if (e && env && env.name === e.name && env.state !== e.state) d.notify(`[environment ${e.name} ${e.state}]`);
      env = e;
    }
  };
}

/** The session's environment (`KL_SESSION`) with its state; null when the session has none. */
export async function sessionEnvironment(): Promise<{ name: string; state: string } | null> {
  const id = process.env.KL_SESSION;
  if (!id) return null;
  const s = await apiJson<any>("GET", `/v1/sessions/${encodeURIComponent(id)}`);
  const e = s?.environment;
  if (!e) return null;
  const name = typeof e === "string" ? e : e.name ?? e.id;
  const v = await apiJson<any>("GET", `/v1/environments/${encodeURIComponent(name)}`).catch(() => null);
  return { name, state: v?.state ?? e?.state ?? "unknown" };
}

/** The live wiring: the pod's own tools, notices into `notify`. */
export const liveWatch = (notify: (m: string) => void) =>
  createWatch({
    touched: podTouched,
    list: async (ws) => ((await podPost<any>(ws, "process_list", {}, 8000))?.processes ?? []) as Proc[],
    stderr: async (ws, id) => String((await podPost<any>(ws, "process_output", { id, since_err: 0 }, 8000))?.stderr ?? ""),
    workspace: (ws) => apiJson<WsDoc>("GET", `/v1/workspaces/${encodeURIComponent(ws)}`),
    environment: sessionEnvironment,
    notify,
    notifyOf: processNotify,
    now: Date.now,
  });
