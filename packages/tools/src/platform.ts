//! Platform API tools: the model's hands on /v1 (workspaces, environments, volumes, desks).
//! The bearer is a short-lived tool token (rotates every 900 s) in a file, so it is read on
//! EVERY call, never cached. Non-2xx comes back as text for the model, never a throw.
//! Main desks get the whole table; a workspace desk gets the subset its own token's
//! route list allows (WORKSPACE_TOOL_ROUTES), with its workspace fixed and `env` defaulted.
//! `all` (the laptop MCP door, backend/src/mcp.ts) is main's table plus the workspace-only tools,
//! each aimed by a required `workspace`/`env`.
import { ensureRunning } from "./ensure.ts";
import { readFileSync } from "node:fs";
import { STATUS_CODES } from "node:http";
import { checkArgs } from "./args.ts";
import { resource, type Action } from "./actions.ts";
import type { ToolDef } from "./index.ts";

const UNAVAILABLE = "platform tools unavailable: KL_API_URL / KL_TOOL_KEY_FILE not set";

type Raw = { unavailable: true } | { unavailable?: false; status: number; text: string; data: any };

async function raw(method: string, path: string, body?: unknown, asText = false): Promise<Raw> {
  const base = process.env.KL_API_URL;
  const file = process.env.KL_TOOL_KEY_FILE;
  if (!base || !file) return { unavailable: true };
  const token = readFileSync(file, "utf8").trim();
  const res = await fetch(base.replace(/\/$/, "") + path, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": asText ? "text/plain" : "application/json" }) },
    ...(body === undefined ? {} : { body: asText ? String(body) : JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {}
  return { status: res.status, text, data };
}

/** "404: {...}" for a JSON or plain answer; an HTML page (a Cloudflare 404 in front of the api) is "404 Not Found: <200 chars of its text>", never raw markup. */
export function httpError(status: number, text: string): string {
  if (!/<\/?(html|body|head|!doctype)\b/i.test(text)) return `${status}: ${text}`;
  const body = text.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  return `${status} ${STATUS_CODES[status] ?? ""}${body ? `: ${body}` : ""}`.replace(/ :/, ":").trim();
}

function show(r: Raw): string {
  if (r.unavailable) throw new Error(UNAVAILABLE);
  if (r.status < 200 || r.status >= 300) throw new Error(httpError(r.status, r.text));
  if (r.status === 204 || !r.text) return "ok";
  return r.data === undefined ? r.text : JSON.stringify(r.data, null, 2);
}

/** One call, rendered for the model. A non-2xx answer throws, so a direct call shows as failed and a codemode script stops. */
export async function api(method: string, path: string, body?: unknown, asText = false): Promise<string> {
  return show(await raw(method, path, body, asText));
}

/** One call, parsed. For the TUI's own reads (sidebar): the same text a failed `api` shows, as an Error. */
export async function apiJson<T>(method: string, path: string, body?: unknown): Promise<T> {
  let r: Raw;
  try {
    r = await raw(method, path, body);
  } catch (e: any) {
    throw new Error(`error: ${e?.message ?? e}`);
  }
  if (r.unavailable) throw new Error(UNAVAILABLE);
  if (r.status < 200 || r.status >= 300) throw new Error(`error ${httpError(r.status, r.text)}`);
  return r.data as T;
}

export const seg = encodeURIComponent;

/** The workspaces `workspace list` shows: a desk (KL_DESK) serves its own members only, as the sidebar does
 * (backend/src/desk.ts); without it a second desk saw the first one's. `status` reads the same rows. */
export async function deskWorkspaces(team?: string): Promise<any[]> {
  const all = await apiJson<any[]>("GET", `/v1/workspaces${qs({ team })}`);
  const desk = process.env.KL_DESK;
  return desk ? all.filter((w) => w.desk === desk && w.id !== process.env.KL_BENCH) : all;
}

const NO_DESK = "no desk is set (KL_DESK is not set)";

/** A desk's `{id, name, environment}`: the thread's own (KL_DESK) unless `desk` names another. A
 * bench belongs to one desk, and `desk connect` here only moves a desk's environment. */
async function currentDesk(desk?: string): Promise<string> {
  const id = desk ?? process.env.KL_DESK;
  if (!id) return NO_DESK;
  const r = await raw("GET", `/v1/desks/${seg(id)}`);
  if (r.unavailable) throw new Error(UNAVAILABLE);
  if (r.status === 404 || r.status === 403) return `desk ${id} has ended`;
  if (r.status < 200 || r.status >= 300) throw new Error(httpError(r.status, r.text));
  const d = r.data as any;
  return JSON.stringify({ id: d.id, name: d.name, environment: d.environment });
}

/** Wake an idle-stopped environment before a read that needs it up. Only an idle-stopped one: a
 * creating, errored or person-stopped environment is what `env get` exists to show, and a failed
 * lookup is the real call's error to report. */
const wake = async (env: string) => {
  const id = decodeURIComponent(env);
  const d = await apiJson<any>("GET", `/v1/environments/${env}`).catch(() => undefined);
  if (d?.idle_since) await ensureRunning("environments", id);
};

export const qs = (p: Record<string, string | undefined>) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v) u.set(k, v);
  const s = u.toString();
  return s ? `?${s}` : "";
};
const VOLUME = { type: "string", description: "The name this snapshot gives its volume (volume list shows it; volume get takes it): required on its first push, optional (but equal) after. A clone shares its source's volume and history: its snapshots appear there and take the source's volume name." };
const strip = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

type Props = Record<string, unknown>;
const S = { type: "string" };
const WS = { type: "string", description: "The workspace id or name." };
const ENV = { type: "string", description: "The environment id or name." };
const N = { type: "number" };
const I = { type: "integer" };
const SL = { type: "array", items: S };
const OBJ = { type: "object" };
const SERVICE = {
  type: "object",
  properties: {
    name: S,
    image: { type: "string", description: "repo:tag. The platform pins it to the tag's current digest (repo:tag@sha256:…), so redeploying a rebuilt tag runs the new bytes." },
    command: { type: "array", items: S, description: "The argv of the container; empty runs the image's own entrypoint." },
    env: { type: "object", additionalProperties: { type: ["string", "null"] }, description: "Environment variables, name to string value (null removes one on update)." },
    mounts: { type: "array", items: { type: "object", properties: { folder: { type: "string", description: "A single name ([A-Za-z0-9._-]) of a folder inside the environment's own volume, created on demand." }, path: { type: "string", description: "Where it appears in the container (absolute)." } }, required: ["folder", "path"] }, description: "Persistent folders of the environment's volume." },
    ports: { type: "array", items: I, description: "Container ports the service answers on, as integers. Siblings reach it by service name on these." },
    resources: {
      type: "object",
      description: "Override the default size of this service, in Kubernetes quantities. Give all four.",
      properties: { cpuRequest: { type: "string", description: "e.g. 250m" }, cpuLimit: { type: "string", description: "e.g. 2" }, memoryRequest: { type: "string", description: "e.g. 512Mi" }, memoryLimit: { type: "string", description: "e.g. 2Gi" } },
    },
  },
  required: ["name"],
  description: "`add` needs `name` and `image`; `command`, `env` and `mounts` default to empty. `update` needs `name` and the fields to change: absent fields keep the live service's values, and `env` merges by key (`{X: null}` removes X).",
};

/** The API requires command, env and mounts on every service; the schema asks only for name and image. */
const noName = (a: any): string | undefined => (typeof a.service?.name === "string" && a.service.name && typeof a.service.image === "string" ? undefined : "error: `service` needs `name` and `image` (an object like {name, image, ports?})");
const nameOnly = (a: any): string | undefined => (typeof a.service?.name === "string" && a.service.name ? undefined : "error: `service` needs `name`");
/** Fields given replace those fields, absent ones keep the live service's; `env` merges by key and `{X: null}` removes X. */
const mergeService = (cur: any, given: any) => {
  const { env, ...rest } = given;
  const merged: Record<string, any> = { ...(cur.env ?? {}), ...(env ?? {}) };
  for (const k of Object.keys(merged)) if (merged[k] === null) delete merged[k];
  return { ...cur, ...rest, env: merged };
};
const withServiceDefaults = (s: any) => ({ command: [], env: {}, mounts: [], ...s });

/** Fold service_status into each services[] entry so a poll reads ready where the spec is. */
function withReady(out: string): string {
  try {
    const doc = JSON.parse(out);
    if (!Array.isArray(doc?.services)) return out;
    doc.services = doc.services.map((svc: any) => {
      const st = doc.service_status?.find((x: any) => x.name === svc.name);
      return { ...svc, ready: st?.ready ?? false, ...(st?.message ? { message: st.message } : {}), ...(st?.failing ? { failing: true } : {}), ...(st?.interceptedBy ? { interceptedBy: st.interceptedBy } : {}), ...(st?.proxy ? { proxy: st.proxy } : {}) };
    });
    return JSON.stringify(doc, null, 2);
  } catch {
    return out;
  }
}

export function def(name: string, description: string, properties: Props, required: string[], run: (a: any) => Promise<string>): ToolDef {
  // the tools' own refusals ("error: service exists") fail like an API error does, never pass as a result
  const inputSchema = { type: "object", properties, required };
  const checked = async (input: any) => {
    const c = checkArgs(inputSchema, input);
    if ("error" in c) throw new Error(c.error);
    const r = await run(c.args);
    if (r.startsWith("error: ")) throw new Error(r.slice(7));
    return r;
  };
  return { name, description, inputSchema, run: checked };
}

const attrOf = (p: string) => p.split("@")[0]!;

/** GET a document and throw on a failure like `api`. */
async function load(path: string): Promise<{ doc: any } | { err: string }> {
  const r = await raw("GET", path);
  if (r.unavailable) throw new Error(UNAVAILABLE);
  if (r.status < 200 || r.status >= 300) throw new Error(httpError(r.status, r.text));
  return { doc: r.data };
}

const OWNER = { type: "string", description: "The owner: your handle, or a team slug." };
const OWNER_DEFAULT = { type: "string", description: "The owner: your handle, or a team slug. Default: this desk's team." };
const SBX = { type: "string", description: "The capsule id or name." };
const SES = { type: "string", description: "The desk id, name or `team/name`." };
const PIPE = { type: "string", description: "The pipeline name." };
const RUN = { type: "string", description: "The run id (the `id` of a run from `run list` or `run start`)." };
const TIMEOUT = { type: "number", description: "Milliseconds this call waits before it answers (default 5000, maximum 20000 on a remote connector; default 25000, maximum 900000 in the harness). At the limit the answer has `timed_out: true`: call again." };
const WAITING = {
  wait: { type: "boolean", description: "Wait for the object to settle instead of answering at once." },
  soft_ms: { type: "number", description: "With `wait`: the call answers within this many milliseconds, handing off with `promoted: true` if the work is not done (default 5000, maximum 20000 on a remote connector; default 25000, maximum 600000 in the harness). Resume with the `wait` action named by `kind`." },
};
const MINE = { type: "boolean", description: "Your own secret in the team `owner` (any active member), not the team's shared one." };
const TTL = { type: "integer", description: "Seconds of unused time before it is deleted, 600 to 2592000." };
const CLEAR = { type: "boolean", description: "`ttl` only: remove the limit instead of setting `ttl_secs`." };
const TAIL = { type: "integer", description: "Keep only the last N lines (default 200, maximum 2000)." };
const HEAD = { type: "integer", description: "Keep only the first N lines (applied before `tail`)." };
const PVER = { type: "integer", description: "A version number. `get`: that version. `delete`: only that version (not the latest, not one a run reads)." };
const OFFSET = { type: "integer", description: "Byte offset into the job's output. `logs`: the whole page from there (`next`, `complete`), else the last lines. `wait`: also answers that page as `output`." };
const TEAMSLUG = { type: "string", description: "The team slug. In a desk its own team is used." };
const TEAM = { type: "string", description: "A team you belong to. Omit it for your own." };
const ENVREF = { anyOf: [{ type: "string" }, { type: "null" }], description: "An environment id or name of the desk's team. `connect` with null disconnects." };
const MAX_TAIL = 2000;

/** Cut a log to its first `head` and last `tail` lines (tail defaults to 200); a note says how many lines went. */
function cutLines(text: string, a: { head?: unknown; tail?: unknown }): string {
  let lines = text.split("\n");
  const trailing = lines.at(-1) === "" ? lines.pop() : undefined;
  const total = lines.length;
  if (a.head !== undefined) lines = lines.slice(0, Math.max(0, Number(a.head)));
  const tail = Math.min(MAX_TAIL, Math.max(1, Number(a.tail ?? 200) || 200));
  if (lines.length > tail) lines = lines.slice(-tail);
  const cut = total - lines.length;
  const note = cut > 0 ? `[${cut} of ${total} lines left out; raise tail (maximum ${MAX_TAIL}) or pass head]\n` : "";
  return note + lines.join("\n") + (trailing !== undefined && lines.length ? "\n" : "");
}
const ttlBody = (a: any): { ttl_secs: number | null } | string =>
  a.clear && a.ttl_secs !== undefined ? "error: give `ttl_secs` or `clear`, not both" : a.clear ? { ttl_secs: null } : a.ttl_secs === undefined ? "error: give `ttl_secs` (600 to 2592000) or `clear: true`; neither would change the limit by guesswork" : { ttl_secs: a.ttl_secs };
const clamp = (ms: number, max: number) => Math.min(max, Math.max(1, Math.round(ms)));
/** How long a `wait` action waits: `timeout_ms`. `max_wait_ms` (ms), `timeout_s` and `timeout` (seconds) are read as aliases, never listed. */
const timeoutMs = (a: any): number => {
  const ms = a.timeout_ms ?? a.max_wait_ms ?? (a.timeout_s !== undefined ? a.timeout_s * 1000 : a.timeout !== undefined ? a.timeout * 1000 : undefined);
  return clamp(Number(ms) || 25_000, 900_000);
};
/** Where a `wait: true` action hands off. */
/** The polling bound for `soft_ms`: 5 s short of it, so the hand-off (and the MCP answer) lands INSIDE the client's own deadline of `soft_ms`
 * (a 60 s call answered at 61.6 s, after the client gave up, 2026-11-04). A `soft_ms` of 5 s or less has no margin to give and is kept. */
const softMs = (a: any): number => {
  const s = clamp(Number(a.soft_ms) || 25_000, 600_000);
  return s <= 5_000 ? s : Math.max(5_000, s - 5_000);
};
/** The answer of a call that handed off: nothing keeps running in the bench, the platform does the work, so there is no output offset. */
const promoted = (id: unknown, kind: string) => JSON.stringify({ promoted: true, id, kind, next: 0, next_err: 0, poll_after_ms: 2000 }, null, 2);

/** GET a plain-text body (logs): `api` would pretty-print JSON-looking text and turn an empty body into "ok". */
async function getText(path: string): Promise<string> {
  const r = await raw("GET", path);
  if (r.unavailable) throw new Error(UNAVAILABLE);
  if (r.status < 200 || r.status >= 300) throw new Error(httpError(r.status, r.text));
  return r.text;
}

/** Poll a document with back-off (tick, then 1.5x up to 6 ticks) until `done`. At the limit: `limit()` when given
 * (a hand-off, which does not wait for a slow read either), else the last view with `timed_out: true`.
 * One loop for every `wait`: an environment, a workspace, a desk, a run. */
async function pollUntil(get: () => Promise<string>, done: (d: any) => boolean, limitMs: number, tickMs: number, trim: (d: any) => any = (d) => d, limit?: () => string): Promise<string> {
  const end = Date.now() + limitMs;
  let wait = tickMs;
  const LIMIT = Symbol();
  for (;;) {
    const got = limit ? await Promise.race([get(), new Promise<symbol>((r) => setTimeout(() => r(LIMIT), Math.max(0, end - Date.now())))]) : await get();
    if (got === LIMIT) return limit!();
    const view = got as string;
    let d: any;
    try {
      d = JSON.parse(view);
    } catch {
      return view; // not a document: nothing to wait on
    }
    if (done(d)) return JSON.stringify(trim(d), null, 2);
    if (Date.now() >= end) return limit ? limit() : JSON.stringify({ ...trim(d), timed_out: true }, null, 2);
    // ponytail: no abort signal reaches ToolDef.run; a cancelled turn waits out its timeout. Thread a signal through ToolDef to stop at the next tick.
    await new Promise((r) => setTimeout(r, Math.max(0, Math.min(wait, end - Date.now()))));
    wait = Math.min(wait * 1.5, tickMs * 6);
  }
}

const envDone = (d: any) => {
  const svcs: any[] = Array.isArray(d?.services) ? d.services : [];
  return d?.state === "error" || d?.state === "deleted" || svcs.some((x) => x.failing) || (d?.state === "running" && svcs.every((x) => x.ready));
};
const restartMarked = (d: any) => !!(d?.restart_required || d?.restartRequired || (Array.isArray(d?.service_status) ? d.service_status : []).some((x: any) => x?.restartRequired || x?.restart_required));
const stoppedDone = (d: any) => d?.state === "stopped" || d?.state === "error" || d?.state === "deleted";
// stopping waits for stopped only: a "ready" read right after the POST is the old state, not a finished stop
const wsDone = (stopped: boolean) => (d: any) => d?.state === "error" || d?.state === "deleted" || d?.state === (stopped ? "stopped" : "ready");
const wsAny = (d: any) => wsDone(true)(d) || d?.state === "ready";
const RUN_ENDED = ["success", "failure", "cancelled"];

/** The capsule's own server-side wait, looped to the bound; at it `limit()` (a hand-off) or the last view with `timed_out`. */
async function capsuleWait(path: string, limitMs: number, limit?: () => string): Promise<string> {
  const end = Date.now() + limitMs;
  for (;;) {
    const d = JSON.parse(await api("POST", `${path}/wait`, { timeout_ms: Math.max(1, Math.min(20000, Math.round(end - Date.now()))) }));
    if (d.phase === "terminated" || d.exit_code != null || d.finished_at) return JSON.stringify(d, null, 2);
    if (Date.now() >= end) return limit ? limit() : JSON.stringify({ ...d, timed_out: true }, null, 2);
  }
}

/** Read the object, run the removal, answer the object as last read with `state: "deleted"`. */
async function deleting(readPath: string, remove: () => Promise<unknown>): Promise<string> {
  const doc = JSON.parse(await api("GET", readPath));
  await remove();
  return JSON.stringify({ ...doc, state: "deleted" }, null, 2);
}

const act = (properties: Props, required: string[], run: (a: any) => Promise<string>, nulls?: string[]): Action => ({ properties, required, run, ...(nulls ? { nulls } : {}) });
/** A plain tool (no actions) from the same pieces. */
const single = (name: string, description: string, a: Action) => def(name, description, a.properties, a.required, a.run);

/** The platform table. Resource tools take an `action`; the rest are single-purpose. `main` and `all` list
 * everything except what only a workspace does (packages edits, intercept); `workspace` is the slice a workspace's own token reaches, with its workspace fixed and `env`
 * defaulted to its desk's. `noStop` drops `workspace stop` (a subagent never stops its workspace). */
export function platformTools(kind: "main" | "workspace" | "all", wsId?: string, tickMs = 5000, noStop = false): ToolDef[] {
  const ws = kind === "workspace";
  const W = ws ? `/v1/workspaces/${seg(wsId!)}` : "";
  const wsPath = (a: any) => (ws ? W : `/v1/workspaces/${seg(a.workspace)}`);
  /** `workspace` param only on main. */
  const wp = (extra: Props = {}): Props => (ws ? extra : { workspace: WS, ...extra });
  const wr = (req: string[] = []) => (ws ? req : ["workspace", ...req]);
  const wact = (props: Props, req: string[], run: (a: any) => Promise<string>) => act(wp(props), wr(req), run);
  /** An action that needs the main-only `workspace` argument. */
  const mact = (props: Props, req: string[], run: (a: any) => Promise<string>) => act({ workspace: WS, ...props }, ["workspace", ...req], run);

  /** `env` for a workspace desk: the environment its desk connects it to (the workspace doc carries it, resolved through the desk). */
  const envOf = async (a: any): Promise<{ env: string } | { err: string }> => {
    if (a.env) return { env: a.env };
    if (!ws) return { err: "error: env is required" };
    const g = await load(W);
    if ("err" in g) return g;
    if (!g.doc?.desk) return { err: "error: this workspace is in no desk" };
    return g.doc.environment ? { env: g.doc.environment } : { err: "error: this workspace's desk has no environment" };
  };
  const ENVP = ws ? { ...ENV, description: "The environment id or name. Default: the environment of this workspace's desk." } : ENV;
  const eact = (props: Props, req: string[], run: (env: string, a: any) => Promise<string>, alias?: Record<string, string>): Action => ({
    ...act({ env: ENVP, ...props }, ws ? req : ["env", ...req], async (a) => {
      const e = await envOf(a);
      return "err" in e ? e.err : run(seg(e.env), a);
    }),
    ...(alias ? { alias } : {}),
  });
  /** `env get` as a poll reads it: services carry `ready` from service_status. */
  const envView = async (env: string) => withReady(await api("GET", `/v1/environments/${env}`));
  const waitEnv = (env: string, a: any) => pollUntil(() => envView(env), envDone, timeoutMs(a), tickMs);
  /** `wait: true` polls the object the action made or changed until `done` or `soft_ms`, then hands off with `promoted`;
   * without it the action's own answer, or the object re-read when the answer is not the object (`reread`). */
  const thenWait = async (out: string, a: any, w: { kind: string; path: (d: any) => string; done: (d: any) => boolean; id?: (d: any) => unknown; get?: (p: string) => Promise<string>; reread?: boolean }): Promise<string> => {
    let d: any = {};
    try {
      d = JSON.parse(out);
    } catch {
      // a plain "ok" (a start on something already running): the poll still answers the object
    }
    const p = w.path(d);
    if (p.includes("undefined")) return out;
    const read = () => (w.get ? w.get(p) : api("GET", p));
    if (!a.wait) return w.reread ? read() : out;
    try {
      return await pollUntil(read, w.done, softMs(a), tickMs, undefined, () => promoted(w.id ? w.id(d) : d.id, w.kind));
    } catch (e: any) {
      // A desk's bench reads only the environment its desk is connected to, so a create
      // answers the object and the way in rather than the 403 the first poll met.
      const m = String(e?.message ?? e);
      if (m.startsWith("403") && m.includes("not connected to this desk")) {
        return JSON.stringify({ ...d, hint: "created; this desk is not connected to it: `desk` `connect` with `environment`, then `env` `wait`" }, null, 2);
      }
      throw e;
    }
  };
  const thenWaitEnv = (out: string, a: any, env?: string, reread = false, done = envDone) =>
    thenWait(out, a, { kind: "env", path: (d) => `/v1/environments/${env ?? seg(d.id)}`, done, id: (d) => (env ? decodeURIComponent(env) : d.id), get: async (p) => withReady(await api("GET", p)), reread });
  const thenWaitWs = (out: string, a: any, o: { stopped?: boolean; ws?: string; reread?: boolean } = {}) =>
    thenWait(out, a, { kind: "workspace", path: (d) => `/v1/workspaces/${o.ws ? seg(o.ws) : seg(d.id)}`, done: wsDone(!!o.stopped), id: (d) => o.ws ?? d.id, reread: o.reread });

  const services = (props: Props, req: string[], edit: (cur: any[], a: any) => any[] | string, after?: (env: string, a: any) => Promise<void>) =>
    eact({ ...props, ...WAITING }, req, async (env, a) => {
      const g = await load(`/v1/environments/${env}`);
      if ("err" in g) return g.err;
      const next = edit(g.doc?.services ?? [], a);
      if (typeof next === "string") return next;
      const out = await api("PATCH", `/v1/environments/${env}`, { services: next });
      await after?.(env, a);
      // a restart re-reads the environment and waits for the "restart required" mark to clear, so the answer is the settled state, not the patch body
      if (a.restart) return thenWaitEnv(out, { ...a, wait: true }, env, true, (d) => envDone(d) && !restartMarked(d));
      return thenWaitEnv(out, a, env);
    });

  const tools: ToolDef[] = [];

  // ---- workspace
  const stopAct = act(WAITING, [], async (a) => thenWaitWs(await api("POST", `${W}/stop`), a, { stopped: true, ws: wsId }));
  /** The workspace as it is after the snapshot, with the snapshot's own answer under `snapshot` (its id is the one thing the object does not hold). */
  /** A push answers before its record is `ready`; wait (bounded) so `volume get` right after lists it. */
  const settled = async (snapshot: any): Promise<any> => {
    const id = snapshot?.id; const vol = snapshot?.volume;
    if (!id || !vol || snapshot?.phase === "ready") return snapshot;
    const until = Date.now() + 25_000;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, 1000));
      const rows = await apiJson<any[]>("GET", `/v1/volumes/${seg(vol)}/history`).catch(() => undefined);
      const row = Array.isArray(rows) ? rows.find((r) => r?.id === id) : undefined;
      if (row) return { ...snapshot, ...row, phase: "ready" };
    }
    return { ...snapshot, note: "still being written; it lists in volume get once ready" };
  };
  const snapAct = wact({ message: S, volume: VOLUME }, [], async (a) => {
    const snapshot = await settled(JSON.parse(await api("POST", `${wsPath(a)}/snapshots`, strip({ message: a.message, volume: a.volume }))));
    // the POST succeeded: a failed re-read must not turn a saved snapshot into an error
    try { return JSON.stringify({ ...JSON.parse(await api("GET", wsPath(a))), snapshot }, null, 2); }
    catch (e) { return JSON.stringify({ snapshot, note: `saved; the workspace was not re-read: ${(e as Error).message}` }, null, 2); }
  });
  tools.push(
    resource("workspace", ws ? "This workspace. Actions: stop (snapshots first), snapshot." : "Workspaces: dev machines with a home volume. Actions: list, get, create (clone with `source`), restore, start, stop, restart, delete, wait, ttl, snapshot.",
      ws
        ? { ...(noStop ? {} : { stop: stopAct }), snapshot: snapAct }
        : {
            list: act({ team: S }, [], async (a) => JSON.stringify(await deskWorkspaces(a.team), null, 2)),
            get: mact({}, [], async (a) => api("GET", `/v1/workspaces/${seg(a.workspace)}`)),
            // In a desk (KL_DESK) a workspace is created and deleted THROUGH it, so it is managed: a
            // direct create would be standalone and then refused by this desk's own tools, and a direct
            // delete of a managed one is a 409. The desk already names the owner, so `team` is dropped.
            create: act({ name: S, image: S, packages: SL, team: S, source: { type: "string", description: "A workspace (id or name) to clone instead of creating an empty one." }, task: { type: "string", description: "What the clone is for (at most 200 characters)." }, device: { type: "string", description: "A device id (dev-…, from `kloudlite devices list`): make a device workspace, whose folder is on that machine and whose tools run there. The device must be online and active in this team." }, snapshot: { type: "string", description: "With `source` a device workspace: the id (dsnap-…) of the snapshot of it to clone." }, access: { type: "array", items: { type: "string" }, description: "Device workspaces only: names of extra sandbox access (e.g. `xcode`, `gradle`, `user-temp`), defined on the person's own machine (built in, or added with `kloudlite devices access add`). A name the machine does not define keeps the workspace from starting (`AccessUndefined`)." }, ...WAITING }, ["name"], async (a) => {
              if (a.source) return thenWaitWs(await api("POST", `/v1/workspaces/${seg(a.source)}/clone`, strip({ name: a.name, task: a.task, snapshot: a.snapshot })), a);
              const body = { name: a.name, image: a.image, packages: a.packages, device: a.device, access: a.access };
              const ses = process.env.KL_DESK;
              return thenWaitWs(ses ? await api("POST", `/v1/desks/${seg(ses)}/workspaces`, strip(body)) : await api("POST", "/v1/workspaces", strip({ team: a.team, ...body })), a);
            }),
            restore: act({ name: S, snapshot_id: { type: "string", description: "A volume name, `name@N` or a snapshot id." }, team: S, image: S, packages: SL, ...WAITING }, ["name", "snapshot_id"], async (a) =>
              thenWaitWs(await api("POST", "/v1/workspaces/restore", strip({ name: a.name, snapshot_id: a.snapshot_id, team: a.team, image: a.image, packages: a.packages })), a)),
            start: mact(WAITING, [], async (a) => thenWaitWs(await api("POST", `/v1/workspaces/${seg(a.workspace)}/start`), a, { ws: a.workspace, reread: true })),
            stop: mact(WAITING, [], async (a) => thenWaitWs(await api("POST", `/v1/workspaces/${seg(a.workspace)}/stop`), a, { stopped: true, ws: a.workspace })),
            restart: mact({ soft_ms: WAITING.soft_ms }, [], async (a) => {
              const url = `/v1/workspaces/${seg(a.workspace)}`;
              const lastAt = (o: any) => { const r = o?.restarts; return Array.isArray(r) && r.length ? r[r.length - 1] : undefined; };
              const before: any = JSON.parse(await api("GET", url));
              const n0 = before?.restarts?.length ?? 0, last0 = JSON.stringify(lastAt(before));
              await api("POST", `${url}/restart`);
              // answered once the new record is there and the "restart required" mark has cleared, within soft_ms
              const end = Date.now() + softMs(a);
              let d: any;
              for (;;) {
                await new Promise((r) => setTimeout(r, Math.min(1000, tickMs)));
                d = JSON.parse(await api("GET", url));
                const recorded = (d?.restarts?.length ?? 0) > n0 || (lastAt(d) !== undefined && JSON.stringify(lastAt(d)) !== last0);
                if (recorded && !d.restart_required) return JSON.stringify({ ...d, restart: lastAt(d) });
                if (Date.now() >= end) break;
              }
              const recorded = (d?.restarts?.length ?? 0) > n0 || (lastAt(d) !== undefined && JSON.stringify(lastAt(d)) !== last0);
              return JSON.stringify(recorded ? { ...d, restart: lastAt(d), hint: "restarted; restart_required is still set" } : { ...d, restart: null, hint: "the restart was accepted; its record follows on the next get" });
            }),
            delete: mact({}, [], async (a) => {
              const ses = process.env.KL_DESK;
              return deleting(`/v1/workspaces/${seg(a.workspace)}`, () => api("DELETE", ses ? `/v1/desks/${seg(ses)}/workspaces/${seg(a.workspace)}` : `/v1/workspaces/${seg(a.workspace)}`));
            }),
            wait: mact({ timeout_ms: TIMEOUT }, [], async (a) => pollUntil(() => api("GET", `/v1/workspaces/${seg(a.workspace)}`), wsAny, timeoutMs(a), tickMs)),
            ttl: mact({ ttl_secs: TTL, clear: CLEAR }, [], async (a) => { const b = ttlBody(a); return typeof b === "string" ? b : (await api("PUT", `/v1/workspaces/${seg(a.workspace)}/ttl`, b), api("GET", `/v1/workspaces/${seg(a.workspace)}`)); }),
            snapshot: snapAct,
          }),
  );

  // ---- environment
  tools.push(
    resource("env", "Environments: the services of a stack, in the team's region. Actions: list, get, create (clone with `source`), start, stop, delete, wait, ttl, snapshot, restore.",
      ws
        ? {
            get: eact({}, [], async (env) => (await wake(env), envView(env))),
            wait: eact({ timeout_ms: TIMEOUT }, [], async (env, a) => (await wake(env), waitEnv(env, a))),
          }
        : {
            list: act({ team: S }, [], async (a) => api("GET", `/v1/environments${qs({ owner: a.team })}`)),
            get: eact({}, [], async (env) => (await wake(env), envView(env))),
            create: act({ name: S, services: { type: "array", items: SERVICE }, team: S, region: S, source: { type: "string", description: "An environment (id or name) to clone live, or a snapshot id to restore into a new environment. Omit it for an empty one. A clone shares its source's volume and history: its snapshots appear there and take the source's volume name." }, ...WAITING }, ["name"], async (a) => {
              const services = a.services?.map(withServiceDefaults);
              if (a.source) {
                const r = await raw("GET", `/v1/environments/${seg(a.source)}`);
                if (r.unavailable) throw new Error(UNAVAILABLE);
                if (r.status === 200) return thenWaitEnv(await api("POST", `/v1/environments/${seg(a.source)}/clone`, strip({ name: a.name, owner: a.team, services, region: a.region })), a);
                if (r.status !== 404) throw new Error(httpError(r.status, r.text));
              }
              return thenWaitEnv(await api("POST", "/v1/environments", strip({ name: a.name, snapshot_id: a.source, services, owner: a.team })), a);
            }),
            start: eact(WAITING, [], async (env, a) => thenWaitEnv(await api("POST", `/v1/environments/${env}/start`), a, env, true)),
            stop: eact(WAITING, [], async (env, a) => thenWaitEnv(await api("POST", `/v1/environments/${env}/stop`), a, env, false, stoppedDone)),
            delete: eact({}, [], async (env) => deleting(`/v1/environments/${env}`, () => api("DELETE", `/v1/environments/${env}`))),
            wait: eact({ timeout_ms: TIMEOUT }, [], async (env, a) => (await wake(env), waitEnv(env, a))),
            ttl: eact({ ttl_secs: TTL, clear: CLEAR }, [], async (env, a) => { const b = ttlBody(a); return typeof b === "string" ? b : (await api("PUT", `/v1/environments/${env}/ttl`, b), envView(env)); }),
            snapshot: eact({ message: S, volume: VOLUME }, [], async (env, a) => {
              const snapshot = await settled(JSON.parse(await api("POST", `/v1/environments/${env}/snapshots`, strip({ message: a.message, volume: a.volume }))));
              try { return JSON.stringify({ ...JSON.parse(await envView(env)), snapshot }, null, 2); }
              catch (e) { return JSON.stringify({ snapshot, note: `saved; the environment was not re-read: ${(e as Error).message}` }, null, 2); }
            }),
            restore: eact({ source: { type: "string", description: "A volume name, `name@N` or a snapshot id." }, discard: { type: "array", items: S, description: "Names of the services from the 409 `lost` list whose data you accept losing." }, ...WAITING }, ["source"], async (env, a) => {
              // an in-place restore keeps the environment "running" throughout, so done is the restore
              // having landed (`restore_requested_at` moved on) with every service back and ready
              const before = (await apiJson<any>("GET", `/v1/environments/${env}`).catch(() => undefined))?.restore_requested_at;
              const out = await api("POST", `/v1/environments/${env}/restore`, strip({ snapshot_id: a.source, discard: a.discard }));
              return thenWaitEnv(out, a, env, true, (d) => envDone(d) && d?.restore_requested_at !== before && !!d?.restored_to);
            }, { snapshot_id: "source" }),
          }),
  );

  // ---- desk
  tools.push(
    resource("desk", ws ? "The desk of this workspace and its environment. Action: list." : "Desks: the one link between workspaces and an environment. Actions: list, create, connect (sets a desk's environment; null disconnects), start, stop, delete, ttl.",
      ws
        ? {
            list: act({}, [], async () => {
              const g = await load(W);
              return "err" in g ? g.err : JSON.stringify({ desk: g.doc?.desk ?? null, environment: g.doc?.environment ?? null }, null, 2);
            }),
          }
        : {
            list: act({ team: TEAM }, [], async (a) => api("GET", `/v1/desks${qs({ team: a.team })}`)),
            create: act({ name: S, team: TEAM, environment: ENVREF, ttl_secs: TTL }, ["name"], async (a) =>
              api("POST", "/v1/desks", strip({ name: a.name, team: a.team, environment: a.environment, ttl_secs: a.ttl_secs }))),
            connect: act({ desk: SES, environment: ENVREF }, [], async (a) => {
              const id = a.desk ?? process.env.KL_DESK;
              if (!id) return NO_DESK;
              if (a.environment === undefined) return "error: `environment` is required (an id or name, or null to disconnect)";
              const r = await raw("PUT", `/v1/desks/${seg(id)}/environment`, { environment: a.environment });
              if (r.unavailable) throw new Error(UNAVAILABLE);
              if (r.status === 404 || r.status === 403) return `desk ${id} has ended`;
              if (r.status < 200 || r.status >= 300) throw new Error(httpError(r.status, r.text));
              return currentDesk(id);
            }, ["environment"]),
            start: act({ desk: SES, ...WAITING }, ["desk"], async (a) => thenWait(await api("POST", `/v1/desks/${seg(a.desk)}/start`), a, { kind: "desk", path: () => `/v1/desks/${seg(a.desk)}`, done: (d) => d?.state === "running", id: () => a.desk, reread: true })),
            // no follow-up read: a stop of the bench's own desk ends the link before a second call answers
            stop: act({ desk: SES }, ["desk"], async (a) => {
              const out = await api("POST", `/v1/desks/${seg(a.desk)}/stop`);
              let body: any;
              try { body = JSON.parse(out); } catch {}
              return JSON.stringify({ id: a.desk, state: "stopping", ...(body && typeof body === "object" ? body : {}) }, null, 2);
            }),
            delete: act({ desk: SES }, ["desk"], async (a) => deleting(`/v1/desks/${seg(a.desk)}`, () => api("DELETE", `/v1/desks/${seg(a.desk)}`))),
            ttl: act({ desk: SES, ttl_secs: TTL, clear: CLEAR }, ["desk"], async (a) => { const b = ttlBody(a); return typeof b === "string" ? b : (await api("PUT", `/v1/desks/${seg(a.desk)}/ttl`, b), api("GET", `/v1/desks/${seg(a.desk)}`)); }),
          }),
  );

  // ---- services of an environment
  tools.push(
    resource("service", "Services of an environment. Actions: add, update (merges into the live service by name: given fields replace, absent ones stay, `env` merges by key; `restart` restarts it), remove, logs.", {
      add: services({ service: SERVICE }, ["service"], (cur, a) => noName(a) ?? (cur.some((s) => s.name === a.service?.name) ? `error: service exists: ${a.service?.name}` : [...cur, withServiceDefaults(a.service)])),
      update: services(
        { service: SERVICE, restart: { type: "boolean", description: "Restart the service after the change so it reads its current variables and secrets." } },
        ["service"],
        (cur, a) => nameOnly(a) ?? (cur.some((s) => s.name === a.service?.name) ? cur.map((s) => (s.name === a.service.name ? mergeService(s, a.service) : s)) : `error: no such service: ${a.service?.name}`),
        async (env, a) => {
          if (a.restart) await api("POST", `/v1/environments/${env}/services/${seg(a.service.name)}/restart`).catch((e) => { throw new Error(`service updated; restart failed: ${e?.message ?? e}`); });
        },
      ),
      remove: services({ name: { type: "string", description: "The service's name." } }, ["name"], (cur, a) => (cur.some((s) => s.name === a.name) ? cur.filter((s) => s.name !== a.name) : `error: no such service: ${a.name}`)),
      logs: eact({ name: { type: "string", description: "The service's name." }, tail: N, since: N, previous: { type: "boolean" } }, ["name"], async (env, a) => {
        await wake(env);
        const d = await apiJson<any>("GET", `/v1/environments/${env}/services/${seg(a.name)}/logs${qs({ tail: a.tail === undefined ? undefined : String(a.tail), since: a.since === undefined ? undefined : String(a.since), previous: a.previous === true || String(a.previous).trim().toLowerCase() === "true" ? "true" : undefined })}`);
        return `${(d?.lines ?? []).join("\n")}${d?.truncated ? "\n[truncated]" : ""}`;
      }),
    }),
  );

  // ---- packages
  const packagesEdit = (edit: (cur: string[], a: any) => string[] | string) =>
    wact({ packages: SL }, ["packages"], async (a) => {
      const g = await load(wsPath(a));
      if ("err" in g) return g.err;
      const next = edit(g.doc?.packages ?? [], a);
      return typeof next === "string" ? next : api("PATCH", wsPath(a), { packages: next });
    });
  tools.push(
    resource("packages", "Packages (`attr` or `attr@version`) a workspace declares. Actions: list, add (replaces the same `attr`), remove, update (re-resolve the pins).", {
      list: wact({}, [], async (a) => {
        const g = await load(wsPath(a));
        return "err" in g ? g.err : JSON.stringify(g.doc?.packages ?? [], null, 2);
      }),
      // the orchestrating desk reads packages; a workspace (or the laptop door) changes them
      ...(kind === "main" ? {} : {
        add: packagesEdit((cur, a) => {
          const add: string[] = a.packages ?? [];
          return [...cur.filter((p) => !add.some((n) => attrOf(n) === attrOf(p))), ...add];
        }),
        remove: packagesEdit((cur, a) => {
          const gone = new Set<string>((a.packages ?? []).map(attrOf));
          const next = cur.filter((p) => !gone.has(attrOf(p)));
          return next.length === cur.length ? `error: not declared: ${(a.packages ?? []).join(", ")}` : next;
        }),
        update: wact({}, [], async (a) => api("POST", `${wsPath(a)}/packages/update`)),
      }),
    }),
  );

  // ---- intercept (a workspace desk intercepts for itself only: no `workspace` argument); not the orchestrator's
  if (kind !== "main") tools.push(
    resource("intercept", "Send an environment service's traffic to a workspace. Actions: start (`wait` until the proxy is ready), stop (the service goes back to its own pod).", {
      start: eact(
        { service: { type: "string", description: "The environment service to take over." }, ...(ws ? {} : { workspace: { ...WS, description: "The workspace that receives the traffic (id or name)." } }), ports: { type: "array", description: "Port remaps: `service` is the port callers dial on the environment service, `workspace` the port the workspace listens on. Omit to forward each port to the same number.", items: { type: "object", properties: { service: I, workspace: I }, required: ["service", "workspace"] } }, ...WAITING },
        ["service", ...(ws ? [] : ["workspace"])],
        async (env, a) => {
          await api("POST", `/v1/environments/${env}/intercepts`, strip({ service: a.service, workspace: ws ? wsId : a.workspace, ports: a.ports }));
          // taken over once the proxy answers; a failed proxy ends the wait too
          const done = (d: any) => { const s = d?.services?.find((x: any) => x.name === a.service); return !!s && ((!!s.interceptedBy && s.proxy === "ready") || s.proxy === "failed"); };
          return thenWait("{}", a, { kind: "env", path: () => `/v1/environments/${env}`, done, id: () => decodeURIComponent(env), get: async (p) => withReady(await api("GET", p)), reread: true });
        },
      ),
      stop: eact({ service: { type: "string", description: "The intercepted environment service." } }, ["service"], async (env, a) => (await api("DELETE", `/v1/environments/${env}/intercepts/${seg(a.service)}`), envView(env))),
    }),
  );

  if (ws) return tools;
  return [...tools, ...mainOnly(tickMs)];
}

/** Everything a workspace token does not reach: capsules, pipelines and runs, volumes, requests, secrets. */
function mainOnly(tickMs: number): ToolDef[] {
  const sbx = (a: any) => `/v1/capsules/${seg(a.capsule)}`;
  const own = (a: any) => a.owner || process.env.KL_TEAM;
  const pipe = (a: any) => `/v1/pipelines/${seg(own(a))}/${seg(a.pipeline)}`;
  const run = (a: any) => `${pipe(a)}/runs/${seg(a.run)}`;
  const secret = (a: any) => `/v1/secrets/${seg(a.owner ?? process.env.KL_TEAM)}${a.mine ? "/mine" : ""}`;
  const RUNREF = { owner: OWNER_DEFAULT, pipeline: PIPE, run: RUN };
  const RUNREQ = ["pipeline", "run"];
  /** `run wait` and a waiting `run start`: the run without its definition, plus the log page at `offset` when one is given. */
  const runWait = async (a: any, limitMs: number, limit?: () => string): Promise<string> => {
    const view = await pollUntil(() => api("GET", run(a)), (d) => RUN_ENDED.includes(d?.state), limitMs, tickMs, ({ definition: _d, ...rest }) => rest, limit);
    if (a.offset === undefined || JSON.parse(view).promoted) return view;
    const page = await api("GET", `${run(a)}/jobs/${a.job ?? 0}/logs${qs({ offset: String(a.offset) })}`);
    let output: unknown = page;
    try { output = JSON.parse(page); } catch {}
    return JSON.stringify({ ...JSON.parse(view), output }, null, 2);
  };
  return [
    resource("capsule", "Capsules: an isolated container that runs one command and ends when it exits. Actions: create, get, list, wait, logs, delete (ends a running one first).", {
      create: act({ command: { oneOf: [S, SL], description: "A shell string (run with `sh -c`), or an argv array." }, image: S, packages: SL, variables: { type: "object", additionalProperties: S, description: "Environment variables for the command. A value of exactly `${{ secrets.NAME }}` reads a secret." }, lifetime_s: { ...I, description: "The capsule's hard lifetime in seconds, 10 to 86400 (default 300). It ends when the command exits or this runs out." }, team: TEAMSLUG, from_workspace: { type: "string", description: "A workspace of yours (id, name or `team/name`) whose current files the capsule starts as, uncommitted work included." }, from_snapshot: { type: "string", description: "A snapshot id or `name@N` reference whose files the capsule starts as." }, ...WAITING }, ["command"], async (a) => {
        const cmd = Array.isArray(a.command) ? a.command : ["sh", "-c", String(a.command)];
        const body = { cmd, image: a.image, packages: a.packages, env: a.variables, timeout_secs: a.lifetime_s ?? a.timeout_s, from_workspace: a.from_workspace, from_snapshot: a.from_snapshot };
        const ses = process.env.KL_DESK;
        const out = ses ? await api("POST", `/v1/desks/${seg(ses)}/capsules`, strip(body)) : await api("POST", "/v1/capsules", strip({ team: a.team, ...body }));
        if (!a.wait) return out;
        const id = JSON.parse(out).id;
        return capsuleWait(`/v1/capsules/${seg(id)}`, softMs(a), () => promoted(id, "capsule"));
      }),
      get: act({ capsule: SBX }, ["capsule"], async (a) => api("GET", sbx(a))),
      list: act({ team: TEAMSLUG, state: { type: "string", enum: ["waiting", "running", "ended", "stopped", "timed-out", "failed"] }, q: { type: "string", description: "Keep capsules whose id, image, packages or command contain this text." }, limit: I }, [], async (a) =>
        api("GET", `/v1/capsules${qs({ team: a.team, state: a.state, q: a.q, limit: a.limit === undefined ? undefined : String(a.limit) })}`)),
      wait: act({ capsule: SBX, timeout_ms: TIMEOUT }, ["capsule"], async (a) => capsuleWait(sbx(a), timeoutMs(a))),
      logs: act({ capsule: SBX, tail: TAIL, head: HEAD }, ["capsule"], async (a) => cutLines(await getText(`${sbx(a)}/logs`), a)),
      delete: act({ capsule: SBX }, ["capsule"], async (a) => {
        const doc = JSON.parse(await api("GET", sbx(a)));
        // a running capsule is ended first; a capsule already over (409) or gone (404) has nothing to end
        await api("POST", `${sbx(a)}/terminate`).catch((e) => { if (!/^(409|404)\b/.test(String(e?.message))) throw e; });
        await api("DELETE", sbx(a));
        return JSON.stringify({ ...doc, state: "deleted" }, null, 2);
      }),
    }),
    resource("volume", "Volumes: the stored state of workspaces and environments. Actions: list, get (history and branch tips), delete a detached volume.", {
      list: act({ kind: S, owner: S }, [], async (a) => api("GET", `/v1/volumes${qs({ kind: a.kind, owner: a.owner })}`)),
      get: act({ volume: { type: "string", description: "The volume's id or its given name." } }, ["volume"], async (a) => {
        // /history and /refs are keyed by the volume id; a name given at a snapshot is a claim on the list row
        const rows = await apiJson<any[]>("GET", "/v1/volumes").catch(() => []);
        const id = (Array.isArray(rows) ? rows : []).find((r) => r?.name === a.volume)?.id ?? a.volume;
        const [history, refs] = await Promise.all([api("GET", `/v1/volumes/${seg(id)}/history?include=working`), api("GET", `/v1/volumes/${seg(id)}/refs`)]);
        // `working` and each row's `working_copies` come from the api untouched; an object answer ({history, working}) is spread, a bare list stays `history`
        const h = JSON.parse(history);
        return JSON.stringify({ volume: a.volume, ...(Array.isArray(h) ? { history: h } : h), refs: JSON.parse(refs) }, null, 2);
      }),
      delete: act({ volume: S }, ["volume"], async (a) => (await api("DELETE", `/v1/volumes/${seg(a.volume)}`), JSON.stringify({ volume: a.volume, state: "deleted" }, null, 2))),
    }),
    resource("snapshot", "Snapshots of a volume. Action: delete one.", {
      delete: act({ volume: S, snapshot: S }, ["volume", "snapshot"], async (a) => {
        // the route is keyed by the volume id; a display name resolves from the list rows as `volume get` does (a clone shares its source's row)
        const rows: any[] = await apiJson<any[]>("GET", "/v1/volumes").then((r) => (Array.isArray(r) ? r : [])).catch(() => []);
        const byId = rows.some((r) => r?.id === a.volume);
        const named = byId ? [] : rows.filter((r) => r?.name === a.volume).map((r) => r.id);
        if (named.length > 1) throw new Error(`409: volume name ${a.volume} is ambiguous; use one of these ids: ${named.join(", ")}`);
        try { await api("DELETE", `/v1/volumes/${seg(named[0] ?? a.volume)}/snapshots/${seg(a.snapshot)}`); }
        catch (e) {
          if (!byId && !named.length && rows.length && String((e as Error).message).startsWith("404")) throw new Error(`404: no volume named ${a.volume}; volume list shows names and ids`);
          throw e;
        }
        return JSON.stringify({ volume: a.volume, snapshot: a.snapshot, state: "deleted" }, null, 2);
      }),
    }),
    resource("pipeline", "Pipelines: versioned definitions. Actions: list, get (a version, or the pipeline with its versions), save, delete (one version with `version`).", {
      list: act({ owner: OWNER_DEFAULT }, [], async (a) => api("GET", `/v1/pipelines/${seg(own(a))}`)),
      get: act({ owner: OWNER_DEFAULT, pipeline: PIPE, version: PVER }, ["pipeline"], async (a) => {
        if (a.version !== undefined) return api("GET", `${pipe(a)}${qs({ version: String(a.version) })}`);
        const [p, versions] = await Promise.all([api("GET", pipe(a)), api("GET", `${pipe(a)}/versions`)]);
        return JSON.stringify({ ...JSON.parse(p), versions: JSON.parse(versions) }, null, 2);
      }),
      save: act({ owner: OWNER_DEFAULT, definition: { type: "object", description: "The pipeline definition (JSON). Its `name` names the pipeline; an equal definition saves nothing; a save that turns the webhook on answers `webhookUrl` once." } }, ["definition"], async (a) => {
        const name = a.definition?.name;
        if (typeof name !== "string" || !name) return "error: `definition` needs a `name`";
        const r = await raw("GET", `/v1/pipelines/${seg(own(a))}/${seg(name)}`);
        if (r.unavailable) throw new Error(UNAVAILABLE);
        if (r.status === 404) return api("POST", `/v1/pipelines/${seg(own(a))}`, a.definition);
        if (r.status < 200 || r.status >= 300) throw new Error(httpError(r.status, r.text));
        return api("PUT", `/v1/pipelines/${seg(own(a))}/${seg(name)}`, a.definition);
      }),
      delete: act({ owner: OWNER_DEFAULT, pipeline: PIPE, version: PVER }, ["pipeline"], async (a) => {
        if (a.version !== undefined) return (await api("DELETE", `${pipe(a)}/versions/${a.version}`), JSON.stringify({ pipeline: a.pipeline, version: a.version, state: "deleted" }, null, 2));
        return deleting(pipe(a), () => api("DELETE", pipe(a)));
      }),
    }),
    resource("run", "Pipeline runs. Actions: start, list, get, wait, logs (a job's output), cancel.", {
      start: act({ owner: OWNER_DEFAULT, pipeline: PIPE, inputs: { type: "object", additionalProperties: S, description: "String values by input name." }, version: { ...I, description: "The version to run. Default: the newest." }, key: { type: "string", description: "A retry key: a second start with the same key answers the first run." }, ...WAITING }, ["pipeline"], async (a) => {
        const out = await api("POST", `${pipe(a)}/runs`, strip({ inputs: a.inputs, version: a.version, key: a.key }));
        if (!a.wait) return out;
        const id = JSON.parse(out).id;
        return runWait({ ...a, run: id, offset: undefined }, softMs(a), () => promoted(id, "run"));
      }),
      list: act({ owner: OWNER_DEFAULT, pipeline: PIPE, state: { type: "string", enum: ["queued", "running", "success", "failure", "cancelled"] }, limit: I }, [], async (a) => {
        const q = qs({ state: a.state, limit: a.limit === undefined ? undefined : String(a.limit) });
        return api("GET", a.pipeline ? `${pipe(a)}/runs${q}` : `/v1/pipelines/${seg(own(a))}/runs${q}`);
      }),
      get: act(RUNREF, RUNREQ, async (a) => api("GET", run(a))),
      wait: act({ ...RUNREF, timeout_ms: TIMEOUT, job: { ...I, description: "The job's index in the run (default 0)." }, offset: OFFSET }, RUNREQ, async (a) => runWait(a, timeoutMs(a))),
      logs: act({ ...RUNREF, job: { ...I, description: "The job's index in the run (default 0)." }, offset: OFFSET, tail: TAIL, head: HEAD }, RUNREQ, async (a) => {
        const out = await api("GET", `${run(a)}/jobs/${a.job ?? 0}/logs${qs({ offset: a.offset === undefined ? undefined : String(a.offset) })}`);
        if (a.offset !== undefined) return out;
        try {
          const d = JSON.parse(out);
          return typeof d?.data === "string" ? JSON.stringify({ ...d, data: cutLines(d.data, a) }, null, 2) : out;
        } catch {
          return out;
        }
      }),
      cancel: act(RUNREF, RUNREQ, async (a) => (await api("POST", `${run(a)}/cancel`), api("GET", run(a)))),
    }),
    resource("worktree", "Worktrees of a workspace. Actions: add, drop.", {
      add: act({ workspace: WS, name: S, soft_ms: WAITING.soft_ms }, ["workspace", "name"], async (a) => {
        const out = JSON.parse(await api("POST", `/v1/workspaces/${seg(a.workspace)}/trees`, { name: a.name }));
        // the node cuts the subvolume on its next pass: wait for the row to be ready, within soft_ms
        const end = Date.now() + softMs(a);
        let ready = false;
        while (!ready && Date.now() < end) {
          await new Promise((r) => setTimeout(r, Math.min(1000, tickMs)));
          ready = !!JSON.parse(await api("GET", `/v1/workspaces/${seg(a.workspace)}`))?.trees?.some((t: any) => t.name === a.name && t.ready);
        }
        return JSON.stringify({ name: out?.name ?? a.name, path: out?.path, ...(ready ? {} : { ready: false }), note: `pass tree: "${a.name}" to exec, read and write; the path is not visible from the main tree` }, null, 2);
      }),
      drop: act({ workspace: WS, name: S }, ["workspace", "name"], async (a) => api("DELETE", `/v1/workspaces/${seg(a.workspace)}/trees/${seg(a.name)}`)),
    }),
    resource("workspace_vars", "A workspace's variables as stored (a secret shows as its reference). Actions: get, set (merges unless `replace`).", {
      get: act({ workspace: WS }, ["workspace"], async (a) => api("GET", `/v1/workspaces/${seg(a.workspace)}/env`)),
      set: act({ workspace: WS, variables: { type: "object", additionalProperties: S, description: "Variable name to value. A value of exactly `${{ secrets.NAME }}` reads a secret." }, replace: { type: "boolean", description: "Replace the whole set instead of merging; `{}` clears it." }, restart_on_change: { type: "boolean", description: "Restart the workspace itself whenever its variables change from now on." } }, ["workspace", "variables"], async (a) => {
        let env = a.variables;
        if (!a.replace) {
          const cur = JSON.parse(await api("GET", `/v1/workspaces/${seg(a.workspace)}/env`));
          env = { ...(cur?.env ?? {}), ...a.variables };
        }
        const out = await api("PUT", `/v1/workspaces/${seg(a.workspace)}/env`, strip({ env, restartOnEnvChange: a.restart_on_change }));
        const state = a.restart_on_change === true ? undefined : (await apiJson<any>("GET", `/v1/workspaces/${seg(a.workspace)}`).catch(() => undefined))?.state;
        if (state !== "ready") return out;
        let body: any;
        try { body = JSON.parse(out); } catch {}
        return JSON.stringify({ ...(body && typeof body === "object" ? body : {}), note: "takes effect after restart" }, null, 2);
      }),
    }),
    def("webhook_rotate", "Make a new webhook secret for a pipeline; the old URL stops at once. The answer holds the new `webhookUrl` once: keep it secret. 409 when the webhook trigger is off.", { owner: OWNER_DEFAULT, pipeline: PIPE }, ["pipeline"], async (a) => api("POST", `${pipe(a)}/webhook/rotate`)),
    def("secret_set", "Store a secret under a name (`A-Z`, `0-9`, `_`), replacing one. The value is never read back; a pod reads it as an env value that is exactly `${{ secrets.NAME }}`. A team's shared secret needs a team admin; `mine` sets your own.", { owner: OWNER_DEFAULT, name: S, value: S, mine: MINE }, ["name", "value"], async (a) => {
      await api("PUT", `${secret(a)}/${seg(a.name)}`, { value: a.value });
      // The route answers 204: the date comes from the names list, which never carries a value.
      const list = await raw("GET", secret(a)).catch(() => undefined);
      const row = list && !list.unavailable && Array.isArray(list.data) ? list.data.find((s: any) => s.name === a.name) : undefined;
      return JSON.stringify({ name: a.name, updatedAt: row?.updated_at ?? new Date().toISOString() }, null, 2);
    }),
    def("secret_list", "List the names of an owner's secrets with when and by whom each was last set. Never a value.", { owner: OWNER_DEFAULT, mine: MINE }, [], async (a) => api("GET", secret(a))),
    def("secret_delete", "Delete one secret. 409 while a workspace, capsule, service or pipeline references it; the answer names the referrers.", { owner: OWNER_DEFAULT, name: S, mine: MINE }, ["name"], async (a) => api("DELETE", `${secret(a)}/${seg(a.name)}`)),
    def("connector_list", "List the git, registry and model-hub connectors of an owner: name, provider, kind, account and state. Read only: connecting happens in the web console.", { owner: { ...OWNER, description: "Your handle or a team slug. Default: your own." } }, [], async (a) => api("GET", `/v1/connectors${qs({ owner: a.owner })}`)),
    def("quota", "Show the limits and the current use of an owner (workspaces, environments, snapshots, diskGb, cpu, memoryGb). To ask for more, use request_create with kind `quota`.", { owner: S }, [], async (a) => api("GET", `/v1/quota${qs({ owner: a.owner ?? process.env.KL_TEAM })}`)),
    def("requests_list", "List the requests of the person and of their teams (quota, access, region, other) with their state and decision note.", { owner: S }, [], async (a) => api("GET", `/v1/requests${qs({ owner: a.owner })}`)),
    def("request_get", "Show one request and its decision.", { id: S }, ["id"], async (a) => api("GET", `/v1/requests/${seg(a.id)}`)),
    def(
      "request_create",
      "Ask a superadmin for what the person cannot do now: quota, access to a team, a region, or other. One pending request per owner and kind (else 409); the decision comes later, read it with request_get.",
      {
        owner: { type: "string", description: "The team slug. Omit it for the person's own." },
        kind: { type: "string", enum: ["quota", "access", "region", "other"] },
        reason: S,
        quota: {
          type: "object",
          description: "The new ceilings that you want. Give only the dimensions that change.",
          properties: { workspaces: { type: "integer" }, environments: { type: "integer" }, snapshots: { type: "integer" }, diskGb: { type: "integer" }, cpu: { type: "integer" }, memoryGb: { type: "integer" } },
        },
        access: { type: "object", properties: { team: S, role: { type: "string", enum: ["member", "admin", "owner"] } }, required: ["team", "role"] },
        region: { type: "string", description: "The region the team moves to (only while the team has nothing)." },
        title: S,
        body: S,
      },
      ["kind", "reason"],
      async (a) => {
        const out = await api("POST", "/v1/requests", strip({ owner: a.owner, kind: a.kind, reason: a.reason, quota: a.quota, access: a.access, region: a.region ? { region: a.region } : undefined, other: a.kind === "other" ? { title: a.title, body: a.body } : undefined }));
        // the stored request holds the title and body under `other`; the answer repeats what was sent
        let doc: any;
        try { doc = JSON.parse(out); } catch { return out; }
        return JSON.stringify({ ...doc, ...strip({ title: a.title, body: a.body }) }, null, 2);
      },
    ),
    def("regions", "List the regions a team can live in. A team has one region, set when it is made.", {}, [], async () => api("GET", "/v1/regions")),
    def("devices", "List the person's own machines (devices): id (`dev-…`, what `workspace` create takes as `device`), name, os, whether it is online, enabled, the account it serves (a handle or a team) and the workspaces it reports. A device workspace needs a device that is online and active in the team. Read only: starting, connecting or removing a device is the person's, on their machine.", {}, [], async () => api("GET", "/v1/devices")),
  ];
}
