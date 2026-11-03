//! Platform API tools: the model's hands on /v1 (workspaces, environments, volumes, sessions).
//! The bearer is a short-lived tool token (rotates every 900 s) in a file, so it is read on
//! EVERY call, never cached. Non-2xx comes back as text for the model, never a throw.
//! Main sessions get the whole table; a workspace session gets the subset its own token's
//! route list allows (WORKSPACE_TOOL_ROUTES), with its workspace fixed and `env` defaulted.
//! `all` (the laptop MCP door, backend/src/mcp.ts) is main's table plus the workspace-only tools,
//! each aimed by a required `workspace`/`env`.
import { ensureRunning } from "./ensure.ts";
import { readFileSync } from "node:fs";
import { STATUS_CODES } from "node:http";
import { checkArgs } from "./args.ts";
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

const NO_SESSION = "no session is set (KL_SESSION is not set)";

/** The bench's own session: a bench belongs to one session and never joins another, so there is
 * no session_use here. The laptop door (`kloudlite mcp`) answers session_current and session_use
 * itself, from the session the laptop picked. */
async function currentSession(): Promise<string> {
  const id = process.env.KL_SESSION;
  if (!id) return NO_SESSION;
  const r = await raw("GET", `/v1/sessions/${seg(id)}`);
  if (r.unavailable) throw new Error(UNAVAILABLE);
  if (r.status === 404 || r.status === 403) return `session ${id} has ended`;
  if (r.status < 200 || r.status >= 300) throw new Error(httpError(r.status, r.text));
  const d = r.data as any;
  return JSON.stringify({ id: d.id, name: d.name, environment: d.environment });
}

/** Connect the bench's session to an environment, or (`null`) disconnect it: the session moves, the
 * bench and its members stay. Answers the session as session_current does. */
async function connectSession(environment: string | null): Promise<string> {
  const id = process.env.KL_SESSION;
  if (!id) return NO_SESSION;
  const r = await raw("PUT", `/v1/sessions/${seg(id)}/environment`, { environment });
  if (r.unavailable) throw new Error(UNAVAILABLE);
  if (r.status === 404 || r.status === 403) return `session ${id} has ended`;
  if (r.status < 200 || r.status >= 300) throw new Error(httpError(r.status, r.text));
  const d = r.data as any;
  return JSON.stringify({ id: d.id, name: d.name, environment: d.environment ?? null });
}

/** Wake an idle-stopped environment before a read that needs it up. Only an idle-stopped one: a
 * creating, errored or person-stopped environment is what env_get exists to show, and a failed
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
const VOLUME = { type: "string", description: "The volume's name: required on its first push, optional (but equal) after." };
const strip = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

type Props = Record<string, unknown>;
const S = { type: "string" };
// Models reach for the display name; every /v1 path takes the id, so say so on every param.
const WS = { type: "string", description: "The workspace id (`ws-…`, the `id` from workspace_list). Do not use the name." };
const ENV = { type: "string", description: "The environment id (`env-…`, the `id` from env_list). Do not use the name." };
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
    env: { type: "object", additionalProperties: S, description: "Environment variables, name to string value." },
    mounts: { type: "array", items: { type: "object", properties: { folder: { type: "string", description: "A single name ([A-Za-z0-9._-]) of a folder inside the environment's own volume, created on demand." }, path: { type: "string", description: "Where it appears in the container (absolute)." } }, required: ["folder", "path"] }, description: "Persistent folders of the environment's volume." },
    ports: { type: "array", items: I, description: "Container ports the service answers on, as integers. Siblings reach it by service name on these." },
    resources: {
      type: "object",
      description: "Override the default size of this service, in Kubernetes quantities. Give all four.",
      properties: { cpuRequest: { type: "string", description: "e.g. 250m" }, cpuLimit: { type: "string", description: "e.g. 2" }, memoryRequest: { type: "string", description: "e.g. 512Mi" }, memoryLimit: { type: "string", description: "e.g. 2Gi" } },
    },
  },
  required: ["name", "image"],
  description: "The `command`, `env` and `mounts` fields default to empty.",
};

/** The API requires command, env and mounts on every service; the schema asks only for name and image. */
const noName = (a: any): string | undefined => (typeof a.service?.name === "string" && a.service.name && typeof a.service.image === "string" ? undefined : "error: `service` needs `name` and `image` (an object like {name, image, ports?})");
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
const ASYNC = " It returns 202 immediately. The work continues after the return. Poll the matching `*_get` tool.";

/** GET a document and throw on a failure like `api`. */
async function load(path: string): Promise<{ doc: any } | { err: string }> {
  const r = await raw("GET", path);
  if (r.unavailable) throw new Error(UNAVAILABLE);
  if (r.status < 200 || r.status >= 300) throw new Error(httpError(r.status, r.text));
  return { doc: r.data };
}

/** The platform table, for every kind. */
export function platformTools(kind: "main" | "workspace" | "all", wsId?: string, tickMs = 5000): ToolDef[] {
  return basePlatformTools(kind, wsId, tickMs);
}

/** `timeout` is seconds, `timeout_ms` milliseconds; a model that learnt one spelling on exec sends it here. */
const waitSecs = (a: any) => (a.timeout !== undefined ? a.timeout : a.timeout_ms !== undefined ? a.timeout_ms / 1000 : undefined);

/** Sessions polled env_get 24-40 times after each deploy; the loop belongs here, not in the model's turns. */
async function settle(get: () => Promise<string>, timeoutS: unknown, tickMs: number): Promise<string> {
  const limit = Math.min(900, Math.max(10, Number(timeoutS) || 300));
  const end = Date.now() + limit * 1000;
  for (;;) {
    const view = await get();
    try {
      const doc = JSON.parse(view);
      const svcs: any[] = Array.isArray(doc?.services) ? doc.services : [];
      if (doc?.state === "error" || doc?.state === "deleted" || svcs.some((x) => x.failing) || (doc?.state === "running" && svcs.every((x) => x.ready))) return view;
      if (Date.now() >= end) return JSON.stringify({ ...doc, timedOut: true }, null, 2);
    } catch {
      return view; // not a document: nothing to wait on
    }
    // ponytail: no abort signal reaches ToolDef.run; a cancelled turn waits out its timeout. Thread a signal through ToolDef to stop at the next tick.
    await new Promise((r) => setTimeout(r, tickMs));
  }
}

function basePlatformTools(kind: "main" | "workspace" | "all", wsId?: string, tickMs = 5000): ToolDef[] {
  const ws = kind === "workspace";
  const W = ws ? `/v1/workspaces/${seg(wsId!)}` : "";
  const wsPath = (a: any) => (ws ? W : `/v1/workspaces/${seg(a.workspace)}`);
  /** `workspace` param only on main. */
  const wp = (extra: Props = {}): Props => (ws ? extra : { workspace: WS, ...extra });
  const wr = (req: string[] = []) => (ws ? req : ["workspace", ...req]);

  const packages = (name: string, description: string, props: Props, req: string[], edit: (cur: string[], a: any) => string[] | string) =>
    def(name, description, wp(props), wr(req), async (a) => {
      const g = await load(wsPath(a));
      if ("err" in g) return g.err;
      const next = edit(g.doc?.packages ?? [], a);
      if (typeof next === "string") return next;
      return api("PATCH", wsPath(a), { packages: next });
    });

  /** `env` for a workspace session: the environment its session connects it to (the workspace doc
   * carries it, resolved through the session). */
  const envOf = async (a: any): Promise<{ env: string } | { err: string }> => {
    if (a.env) return { env: a.env };
    if (!ws) return { err: "error: env is required" };
    const g = await load(W);
    if ("err" in g) return g;
    if (!g.doc?.session) return { err: "error: this workspace is in no session" };
    return g.doc.environment ? { env: g.doc.environment } : { err: "error: this workspace's session has no environment" };
  };
  const envTool = (name: string, description: string, props: Props, req: string[], run: (env: string, a: any) => Promise<string>) =>
    def(name, description, { env: ENV, ...props }, ws ? req : ["env", ...req], async (a) => {
      const e = await envOf(a);
      return "err" in e ? e.err : run(seg(e.env), a);
    });
  const services = (name: string, description: string, props: Props, req: string[], edit: (cur: any[], a: any) => any[] | string) =>
    envTool(name, description, props, req, async (env, a) => {
      const g = await load(`/v1/environments/${env}`);
      if ("err" in g) return g.err;
      const next = edit(g.doc?.services ?? [], a);
      return typeof next === "string" ? next : api("PATCH", `/v1/environments/${env}`, { services: next });
    });

  // tools both kinds have
  const shared: ToolDef[] = [
    def("packages_list", "List the packages that the workspace declares. Do this before you change them.", wp(), wr(), async (a) => {
      const g = await load(wsPath(a));
      return "err" in g ? g.err : JSON.stringify(g.doc?.packages ?? [], null, 2);
    }),
    packages("packages_add", "Declare packages (`attr` or `attr@version`) on the workspace. An entry with the same `attr` replaces the old entry.", { packages: SL }, ["packages"], (cur, a) => {
      const add: string[] = a.packages ?? [];
      const keep = cur.filter((p) => !add.some((n) => attrOf(n) === attrOf(p)));
      return [...keep, ...add];
    }),
    packages("packages_remove", "Remove declared packages from the workspace. Give the `attr` of each package.", { packages: SL }, ["packages"], (cur, a) => {
      const gone = new Set<string>((a.packages ?? []).map(attrOf));
      const next = cur.filter((p) => !gone.has(attrOf(p)));
      return next.length === cur.length ? `error: not declared: ${(a.packages ?? []).join(", ")}` : next;
    }),
    def("packages_update", "Resolve the package pins of the workspace again, to the newest matching versions.", wp(), wr(), async (a) => api("POST", `${wsPath(a)}/packages/update`)),
    def("workspace_snapshot", "Make a snapshot of the workspace in its history." + ASYNC, wp({ message: S, volume: VOLUME }), wr(), async (a) => api("POST", `${wsPath(a)}/snapshots`, strip({ message: a.message, volume: a.volume }))),
    envTool(
      "service_logs",
      "Read the recent logs of one service of an environment that you own. The tool reads from inside the cluster, not from /v1. It is read-only. `tail` is the number of lines. The default is 200 and the maximum is 2000. `since` is in seconds. The maximum is 86400. `previous` reads the last container that crashed. If an intercept has taken the service, the answer has a note. The note names the workspace that runs the service.",
      { service: S, tail: N, since: N, previous: { type: "boolean" } },
      ["service"],
      async (env, a) => {
        await wake(env);
        const base = (process.env.KL_LOGS_URL ?? "http://builder-gate.kloudlite-system.svc:1235").replace(/\/$/, "");
        const q = qs({ tail: a.tail === undefined ? undefined : String(a.tail), since: a.since === undefined ? undefined : String(a.since), previous: a.previous === true || String(a.previous).trim().toLowerCase() === "true" ? "true" : undefined });
        // no auth header: the gate identifies this pod by its source IP
        const res = await fetch(`${base}/logs/${env}/${seg(a.service)}${q}`, { signal: AbortSignal.timeout(15_000) });
        const text = await res.text();
        if (res.status < 200 || res.status >= 300) throw new Error(httpError(res.status, text));
        return text;
      },
    ),
    def("session_current", ws ? "Show the session of this workspace and the environment that the session connects it to. A workspace cannot join or leave a session." : "Show this session and its environment.", {}, [], async () => {
      if (ws) {
        const g = await load(W);
        return "err" in g ? g.err : JSON.stringify({ session: g.doc?.session ?? null, environment: g.doc?.environment ?? null }, null, 2);
      }
      return currentSession();
    }),
    ...(ws ? [] : [
      def("session_connect", "Connect this session to an environment of its team (id or name). Its intercepts in the old environment are released first.", { environment: S }, ["environment"], (a) => connectSession(a.environment)),
      def("session_disconnect", "Disconnect this session from its environment; its intercepts there are released.", {}, [], () => connectSession(null)),
    ]),
    envTool("env_get", "Read the services, state and intercepts of an environment. Each `services[]` entry has `ready` (and `message`) from service_status. Read `ready`, not the spec; to wait after a change call env_wait instead of polling. `failing: true` means the service will not come up by waiting (a crash loop, an image that will not pull, a refused config): read `message` (for a crash, the exit code and its last log lines), fix the cause and redeploy. The `state` is `creating`, `running`, `stopped`, `error` or `deleted`. `running` means up. Stop the poll when the state is `error` or `deleted`." + (ws ? " It defaults to the environment that the session of this workspace connects it to." : ""), {}, [], async (env) => (await wake(env), withReady(await api("GET", `/v1/environments/${env}`)))),
    envTool("env_wait", "Wait until an environment settles after a change: every service ready, a service failing, or the state error/deleted. Use this instead of polling env_get. Returns the env_get view; `timedOut: true` means it was still settling after `timeout` seconds (default 300, maximum 900). `timeout_ms` is the same wait in milliseconds; give one of them.", { timeout: { ...N, description: "Seconds." }, timeout_ms: { ...N, description: "Milliseconds (the other spelling of `timeout`)." } }, [], async (env, a) => (await wake(env), settle(async () => withReady(await api("GET", `/v1/environments/${env}`)), waitSecs(a), tickMs))),
    services("service_add", "Add one service to an environment. The call fails if a service with this name exists." + ASYNC, { service: SERVICE }, ["service"], (cur, a) =>
      noName(a) ?? (cur.some((s) => s.name === a.service?.name) ? `error: service exists: ${a.service?.name}` : [...cur, withServiceDefaults(a.service)])),
    services("service_update", "Replace one existing service in an environment. The tool matches the service by name." + ASYNC, { service: SERVICE }, ["service"], (cur, a) =>
      noName(a) ?? (cur.some((s) => s.name === a.service?.name) ? cur.map((s) => (s.name === a.service.name ? withServiceDefaults(a.service) : s)) : `error: no such service: ${a.service?.name}`)),
    services("service_remove", "Remove a service from an environment. Give the name of the service." + ASYNC, { name: S }, ["name"], (cur, a) =>
      cur.some((s) => s.name === a.name) ? cur.filter((s) => s.name !== a.name) : `error: no such service: ${a.name}`),
    // a workspace session intercepts for itself only: no `workspace` param to aim it at another workspace
    envTool("intercept", (ws ? "Send the traffic of an environment service to this workspace." : "Send the traffic of an environment service to a workspace.") + ASYNC, { service: S, ...(ws ? {} : { workspace: WS }), ports: { type: "array", description: "Port remaps: `service` is the port callers dial on the environment service, `workspace` the port the workspace listens on. Omit to forward each port to the same number.", items: { type: "object", properties: { service: I, workspace: I }, required: ["service", "workspace"] } } }, ["service", ...(ws ? [] : ["workspace"])], (env, a) =>
      api("POST", `/v1/environments/${env}/intercepts`, strip({ service: a.service, workspace: ws ? wsId : a.workspace, ports: a.ports }))),
    envTool("release", "Release an intercepted service back to its own pod.", { service: S }, ["service"], (env, a) => api("DELETE", `/v1/environments/${env}/intercepts/${seg(a.service)}`)),
  ];
  // main's own `workspace_stop` (below) takes a `workspace` param; this one stops the session's own
  // workspace, so it sits outside `shared` and `of()` never picks it up.
  if (ws) return [...shared, def("workspace_stop", "Stop this workspace after its task is done and main or the person said to stop. The tool makes a snapshot first. The next start resumes the workspace." + ASYNC, {}, [], async () => api("POST", `${W}/stop`))];

  const of = (n: string) => shared.find((t) => t.name === n)!;

  const lifecycle = (name: string, description: string, method: string, suffix: string, key = "workspace", base = "/v1/workspaces") =>
    def(name, description, { [key]: key === "env" ? ENV : WS }, [key], async (a) => api(method, `${base}/${seg(a[key])}${suffix}`));

  const main: ToolDef[] = [
    def("workspace_list", "List the workspaces of this session. You can give one team.", { team: S }, [], async (a) => {
      // A session serves its own workspaces (KL_SESSION): it lists that session's workspaces only, as the
      // sidebar does (backend/src/session.ts); without it a second session saw the first one's.
      const path = `/v1/workspaces${qs({ team: a.team })}`;
      const session = process.env.KL_SESSION;
      if (!session) return api("GET", path);
      const ws = await apiJson<any[]>("GET", path);
      return JSON.stringify(ws.filter((w) => w.session === session && w.id !== process.env.KL_BENCH), null, 2);
    }),
    def("workspace_get", "Read the state of one workspace. Poll this tool after any lifecycle call. The `state` is `creating`, `ready`, `stopped`, `error` or `deleted`. `ready` means up. A workspace is not `running` at any time. Stop the poll when the state is `error` or `deleted`.", { workspace: WS }, ["workspace"], async (a) => api("GET", `/v1/workspaces/${seg(a.workspace)}`)),
    // In a session (KL_SESSION) a workspace is created and deleted THROUGH it, so it is managed: a
    // direct create would be standalone and then refused by this session's own tools, and a direct
    // delete of a managed one is a 409. The session already names the owner, so `team` is dropped.
    def("workspace_create", "Create a workspace. It runs in the team's region. In a session it is created in the session and is managed by it." + ASYNC, { name: S, quota_gb: N, image: S, packages: SL, team: S }, ["name", "quota_gb"], async (a) => {
      const body = { name: a.name, quota_gb: a.quota_gb, image: a.image, packages: a.packages };
      const ses = process.env.KL_SESSION;
      return ses ? api("POST", `/v1/sessions/${seg(ses)}/workspaces`, strip(body)) : api("POST", "/v1/workspaces", strip({ team: a.team, ...body }));
    }),
    def("workspace_clone", "Clone the current state of a workspace into a new workspace." + ASYNC, { workspace: WS, name: S, task: { type: "string", description: "What the clone is for. Use at most 200 characters." } }, ["workspace", "name"], async (a) => api("POST", `/v1/workspaces/${seg(a.workspace)}/clone`, strip({ name: a.name, task: a.task }))),
    def("workspace_restore", "Create a workspace from a snapshot." + ASYNC, { name: S, snapshot_id: { type: "string", description: "A volume name, `name@N` or a snapshot id." }, team: S, image: S, packages: SL, quota_gb: N }, ["name", "snapshot_id"], async (a) =>
      api("POST", "/v1/workspaces/restore", strip({ name: a.name, snapshot_id: a.snapshot_id, team: a.team, image: a.image, packages: a.packages, quota_gb: a.quota_gb }))),
    lifecycle("workspace_start", "Start a stopped workspace." + ASYNC, "POST", "/start"),
    lifecycle("workspace_stop", "Stop a workspace that is up. The tool makes a snapshot first." + ASYNC, "POST", "/stop"),
    def("workspace_delete", "Delete a workspace permanently. In a session it is deleted in the session." + ASYNC, { workspace: WS }, ["workspace"], async (a) => {
      const ses = process.env.KL_SESSION;
      return api("DELETE", ses ? `/v1/sessions/${seg(ses)}/workspaces/${seg(a.workspace)}` : `/v1/workspaces/${seg(a.workspace)}`);
    }),
    of("workspace_snapshot"),
    def("worktree_add", "Make a new worktree in a workspace." + ASYNC, { workspace: WS, name: S }, ["workspace", "name"], async (a) => api("POST", `/v1/workspaces/${seg(a.workspace)}/trees`, { name: a.name })),
    def("worktree_drop", "Remove a worktree from a workspace." + ASYNC, { workspace: WS, name: S }, ["workspace", "name"], async (a) => api("DELETE", `/v1/workspaces/${seg(a.workspace)}/trees/${seg(a.name)}`)),
    of("packages_list"),
    of("session_current"),
    ...(ws ? [] : [of("session_connect"), of("session_disconnect")]),
    def("env_list", "List the environments. You can give one team.", { team: S }, [], async (a) => api("GET", `/v1/environments${qs({ owner: a.team })}`)),
    def("env_get", "Read the services, state and intercepts of one environment. After an env call, wait with env_wait. Each `services[]` entry has `ready` (and `message`) from service_status. Read `ready`, not the spec; to wait after a change call env_wait instead of polling. `failing: true` means the service will not come up by waiting (a crash loop, an image that will not pull, a refused config): read `message` (for a crash, the exit code and its last log lines), fix the cause and redeploy. The `state` is `creating`, `running`, `stopped`, `error` or `deleted`. `running` means up.", { env: ENV }, ["env"], async (a) => (await wake(seg(a.env)), withReady(await api("GET", `/v1/environments/${seg(a.env)}`)))),
    def("env_wait", "Wait until an environment settles after a change: every service ready, a service failing, or the state error/deleted. Use this instead of polling env_get. Returns the env_get view; `timedOut: true` means it was still settling after `timeout` seconds (default 300, maximum 900). `timeout_ms` is the same wait in milliseconds; give one of them.", { env: ENV, timeout: { ...N, description: "Seconds." }, timeout_ms: { ...N, description: "Milliseconds (the other spelling of `timeout`)." } }, ["env"], async (a) => (await wake(seg(a.env)), settle(async () => withReady(await api("GET", `/v1/environments/${seg(a.env)}`)), waitSecs(a), tickMs))),
    of("service_logs"),
    def("env_delete", "Delete an environment permanently.", { env: ENV }, ["env"], async (a) => api("DELETE", `/v1/environments/${seg(a.env)}`)),
    def("env_start", "Start a stopped environment." + ASYNC, { env: ENV }, ["env"], async (a) => api("POST", `/v1/environments/${seg(a.env)}/start`)),
    def("env_stop", "Stop an environment that is up." + ASYNC, { env: ENV }, ["env"], async (a) => api("POST", `/v1/environments/${seg(a.env)}/stop`)),
    def("env_create", "Create an environment of services in the team's region. With `snapshot_id`, grow it from one of your snapshots, also one of a deleted environment: the snapshot's services run unless you pass `services`." + ASYNC, { name: S, snapshot_id: S, services: { type: "array", items: SERVICE }, team: S, quota_gb: N }, ["name"], async (a) =>
      api("POST", "/v1/environments", strip({ name: a.name, snapshot_id: a.snapshot_id, services: a.services?.map(withServiceDefaults), owner: a.team, quota_gb: a.quota_gb }))),
    def("env_clone", "Create a NEW environment from this one: from its live state, or from one of its snapshots when `snapshot_id` is given." + ASYNC, { env: ENV, name: S, snapshot_id: S, team: S, services: { type: "array", items: SERVICE }, region: S, quota_gb: N }, ["env", "name"], async (a) =>
      api("POST", `/v1/environments/${seg(a.env)}/clone`, strip({ name: a.name, snapshot_id: a.snapshot_id, owner: a.team, services: a.services?.map(withServiceDefaults), region: a.region, quota_gb: a.quota_gb }))),
    def("env_snapshot", "Make a snapshot of an environment in its history." + ASYNC, { env: ENV, message: S, volume: VOLUME }, ["env"], async (a) => api("POST", `/v1/environments/${seg(a.env)}/snapshots`, strip({ message: a.message, volume: a.volume }))),
    def("env_restore", "Put this environment back to one of its own snapshots: its services and its data. Data written since the snapshot is lost. If the call returns 409 with `lost`, those services keep data that the snapshot does not have; ask the person, then call again with `discard` naming them." + ASYNC, { env: ENV, snapshot_id: S, discard: { type: "array", items: S, description: "Names of the services from the 409 `lost` list whose data you accept losing." } }, ["env", "snapshot_id"], async (a) =>
      api("POST", `/v1/environments/${seg(a.env)}/restore`, strip({ snapshot_id: a.snapshot_id, discard: a.discard }))),
    ...["service_add", "service_update", "service_remove"].map(of),
    def("volume_list", "List the volumes. You can filter by kind (`workspace` or `environment`) and by owner.", { kind: S, owner: S }, [], async (a) => api("GET", `/v1/volumes${qs({ kind: a.kind, owner: a.owner })}`)),
    def("volume_history", "List the snapshots of a volume. These ids are for env_restore, env_clone and env_create.", { volume: S }, ["volume"], async (a) => api("GET", `/v1/volumes/${seg(a.volume)}/history`)),
    def("volume_refs", "Read the branch tips of a volume.", { volume: S }, ["volume"], async (a) => api("GET", `/v1/volumes/${seg(a.volume)}/refs`)),
    def("volume_delete", "Delete a detached volume permanently.", { volume: S }, ["volume"], async (a) => api("DELETE", `/v1/volumes/${seg(a.volume)}`)),
    def("snapshot_delete", "Delete one snapshot of a volume.", { volume: S, snapshot: S }, ["volume", "snapshot"], async (a) => api("DELETE", `/v1/volumes/${seg(a.volume)}/snapshots/${seg(a.snapshot)}`)),
    def("builder_status", "Check the state of the image builder for a team.", { team: S }, [], async (a) => api("GET", `/v1/builders/me${qs({ team: a.team })}`)),
    def("quota", "Show the limits and the current use of an owner (workspaces, environments, snapshots, diskGb, cpu, memoryGb). A call that creates more than a limit answers 409. To ask for more, use request_create with kind `quota`.", { owner: S }, [], async (a) => api("GET", `/v1/quota${qs({ owner: a.owner })}`)),
    def("requests_list", "List the requests of the person and of their teams (quota, access, region, other). Each request has a state (`pending`, `approved` or `denied`) and the decision note.", { owner: S }, [], async (a) => api("GET", `/v1/requests${qs({ owner: a.owner })}`)),
    def("request_get", "Show one request and its decision.", { id: S }, ["id"], async (a) => api("GET", `/v1/requests/${seg(a.id)}`)),
    def(
      "request_create",
      "Ask a superadmin for something that the person cannot do now. Examples are more quota, access to a team, a region, or anything else. Each owner can have only one pending request of each kind. Otherwise the answer is 409. The tool returns at once. The decision comes later. Use request_get to check it.",
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
      async (a) => api("POST", "/v1/requests", strip({ owner: a.owner, kind: a.kind, reason: a.reason, quota: a.quota, access: a.access, region: a.region ? { region: a.region } : undefined, other: a.kind === "other" ? { title: a.title, body: a.body } : undefined })),
    ),
    def("regions", "List the regions a team can live in. A team has one region, set when it is made.", {}, [], async () => api("GET", "/v1/regions")),
    ...componentTools(tickMs),
  ];
  if (kind !== "all") return main;
  const have = new Set(main.map((t) => t.name));
  return [...main, ...shared.filter((t) => !have.has(t.name))];
}

// ---- components with no workspace/environment id: sandboxes, pipelines and runs, secrets, connectors, session lifecycle, TTLs.
// Main and `all` only: a workspace token's route list (WORKSPACE_TOOL_ROUTES) reaches none of these.

const OWNER = { type: "string", description: "The owner: your handle, or a team slug." };
const SBX = { type: "string", description: "The sandbox id (`sbx-…`, the `id` from sandbox_list)." };
const SES = { type: "string", description: "The session id, name or `team/name`." };
const PIPE = { type: "string", description: "The pipeline name." };
const RUN = { type: "string", description: "The run id (the `id` of a run from run_list or run_start)." };
const WAIT = { type: "number", description: "Seconds to wait (default 300, maximum 900). At the limit the answer has `timedOut: true`." };
const MINE = { type: "boolean", description: "Your own secret in the team `owner` (any active member), not the team's shared one." };
const TTL = { type: "integer", description: "Seconds of unused time before it is deleted, 600 to 2592000. Give this or `clear`, never neither." };
const CLEAR = { type: "boolean", description: "Remove the limit (instead of `ttl_secs`)." };
const TAIL = { ...{ type: "integer" }, description: "Keep only the last N lines (default 200, maximum 2000)." };
const HEAD = { ...{ type: "integer" }, description: "Keep only the first N lines (applied before `tail`)." };
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
const clampWait = (t: unknown) => Math.min(900, Math.max(0.001, Number(t) || 300));

/** GET a plain-text body (logs): `api` would pretty-print JSON-looking text and turn an empty body into "ok". */
async function getText(path: string): Promise<string> {
  const r = await raw("GET", path);
  if (r.unavailable) throw new Error(UNAVAILABLE);
  if (r.status < 200 || r.status >= 300) throw new Error(httpError(r.status, r.text));
  return r.text;
}

/** Poll a document with back-off (tick, then 1.5x up to 6 ticks) until `done`; the last view with `timedOut: true` at the limit. */
async function pollDoc(path: string, done: (d: any) => boolean, timeoutS: unknown, tickMs: number, trim: (d: any) => any = (d) => d): Promise<string> {
  const end = Date.now() + clampWait(timeoutS) * 1000;
  let wait = tickMs;
  for (;;) {
    const d = JSON.parse(await api("GET", path));
    if (done(d)) return JSON.stringify(trim(d), null, 2);
    if (Date.now() >= end) return JSON.stringify({ ...trim(d), timedOut: true }, null, 2);
    // ponytail: no abort signal reaches ToolDef.run (see settle); a cancelled turn waits out its timeout.
    await new Promise((r) => setTimeout(r, Math.max(0, Math.min(wait, end - Date.now()))));
    wait = Math.min(wait * 1.5, tickMs * 6);
  }
}

function componentTools(tickMs: number): ToolDef[] {
  const sbx = (a: any) => `/v1/sandboxes/${seg(a.sandbox)}`;
  const pipe = (a: any) => `/v1/pipelines/${seg(a.owner)}/${seg(a.pipeline)}`;
  const run = (a: any) => `${pipe(a)}/runs/${seg(a.run)}`;
  const secret = (a: any) => `/v1/secrets/${seg(a.owner)}${a.mine ? "/mine" : ""}`;
  const RUNREF = { owner: OWNER, pipeline: PIPE, run: RUN };
  const RUNREQ = ["owner", "pipeline", "run"];
  return [
    // Sandbox
    def("sandbox_create", "Start a sandbox: an isolated container that runs one command and ends when it exits. In a session it is created in the session and reaches the session's environment; otherwise it is standalone. `command` is a shell string (run with `sh -c`) or an argv array. It returns at once with the sandbox document in `pending`. Call sandbox_wait for the end, then sandbox_logs." , { command: { oneOf: [S, SL], description: "A shell string, or an argv array." }, image: S, packages: SL, variables: { type: "object", additionalProperties: S, description: "Environment variables for the command. A value of exactly `${{ secrets.NAME }}` reads a secret." }, timeout_s: { ...I, description: "The hard lifetime in seconds, 10 to 86400. Default 300." }, team: { type: "string", description: "The team slug for a standalone sandbox. A session uses its own team." }, from_workspace: { type: "string", description: "A workspace of yours (id, name or `team/name`) whose current files the sandbox starts as, uncommitted work included." }, from_snapshot: { type: "string", description: "A snapshot id or `name@N` reference whose files the sandbox starts as." } }, ["command"], async (a) => {
      const cmd = Array.isArray(a.command) ? a.command : ["sh", "-c", String(a.command)];
      const body = { cmd, image: a.image, packages: a.packages, env: a.variables, timeout_secs: a.timeout_s, from_workspace: a.from_workspace, from_snapshot: a.from_snapshot };
      const ses = process.env.KL_SESSION;
      return ses ? api("POST", `/v1/sessions/${seg(ses)}/sandboxes`, strip(body)) : api("POST", "/v1/sandboxes", strip({ team: a.team, ...body }));
    }),
    def("sandbox_get", "Read one sandbox. The `phase` is `pending`, `starting`, `running` or `terminated`; `reason` and `exit_code` say how it ended.", { sandbox: SBX }, ["sandbox"], async (a) => api("GET", sbx(a))),
    def("sandbox_wait", "Wait until a sandbox ends, then return `{id, phase, reason, exit_code, message}`. `exit_code` is the command's own. `timedOut: true` means it was still running after `timeout` seconds.", { sandbox: SBX, timeout: WAIT }, ["sandbox"], async (a) => {
      const end = Date.now() + clampWait(a.timeout) * 1000;
      for (;;) {
        const d = JSON.parse(await api("POST", `${sbx(a)}/wait`, { timeout_ms: Math.max(1, Math.min(20000, Math.round(end - Date.now()))) }));
        if (d.phase === "terminated") return JSON.stringify(d, null, 2);
        if (Date.now() >= end) return JSON.stringify({ ...d, timedOut: true }, null, 2);
      }
    }),
    def("sandbox_logs", "Read the output of a sandbox's command as plain text: the live output while it runs, the last 256 KiB after it ended. Only the last 200 lines are returned unless `tail` (maximum 2000) or `head` says otherwise. Empty until the first output; 409 while it has not started.", { sandbox: SBX, tail: TAIL, head: HEAD }, ["sandbox"], async (a) => cutLines(await getText(`${sbx(a)}/logs`), a)),
    def("sandbox_list", "List your sandboxes, newest first, ended ones included. The first 50 unless `limit` (1 to 200).", { team: S, state: { type: "string", enum: ["waiting", "running", "ended", "stopped", "timed-out", "failed"] }, q: { type: "string", description: "Keep sandboxes whose id, image, packages or command contain this text." }, limit: I }, [], async (a) =>
      api("GET", `/v1/sandboxes${qs({ team: a.team, state: a.state, q: a.q, limit: a.limit === undefined ? undefined : String(a.limit) })}`)),
    def("sandbox_terminate", "Ask the platform to end a sandbox. The record stays, and the call is safe to repeat. It returns at once; poll sandbox_get or call sandbox_wait.", { sandbox: SBX }, ["sandbox"], async (a) => api("POST", `${sbx(a)}/terminate`)),
    def("sandbox_delete", "Delete a sandbox's record. A sandbox still running dies with it.", { sandbox: SBX }, ["sandbox"], async (a) => api("DELETE", sbx(a))),

    // Pipeline
    def("pipeline_list", "List the pipelines of an owner, with the latest version and the triggers.", { owner: OWNER }, ["owner"], async (a) => api("GET", `/v1/pipelines/${seg(a.owner)}`)),
    def("pipeline_get", "Read a pipeline: its latest definition, or version `version`.", { owner: OWNER, pipeline: PIPE, version: I }, ["owner", "pipeline"], async (a) => api("GET", `${pipe(a)}${qs({ version: a.version === undefined ? undefined : String(a.version) })}`)),
    def("pipeline_save", "Save a pipeline definition (JSON, with its `name`) as a new version; the pipeline is created when it does not exist. A definition equal to the latest saves nothing. It is sent as a JSON object, so a job, input or matrix key that is an integer (\"1\") moves to the front: avoid such names. To roll back, save an old definition. A definition that cannot run is a 422 with every reason. When a save turns `triggers.webhook` on, the answer holds `webhookUrl` once: keep it secret and tell the person.", { owner: OWNER, definition: { type: "object", description: "The pipeline definition. Its `name` names the pipeline." } }, ["owner", "definition"], async (a) => {
      const name = a.definition?.name;
      if (typeof name !== "string" || !name) return "error: `definition` needs a `name`";
      const r = await raw("GET", `/v1/pipelines/${seg(a.owner)}/${seg(name)}`);
      if (r.unavailable) throw new Error(UNAVAILABLE);
      if (r.status === 404) return api("POST", `/v1/pipelines/${seg(a.owner)}`, a.definition);
      if (r.status < 200 || r.status >= 300) throw new Error(httpError(r.status, r.text));
      return api("PUT", `/v1/pipelines/${seg(a.owner)}/${seg(name)}`, a.definition);
    }),
    def("pipeline_versions", "List the versions of a pipeline, oldest first: `{version, createdBy, createdAtMs, definitionSha256}`.", { owner: OWNER, pipeline: PIPE }, ["owner", "pipeline"], async (a) => api("GET", `${pipe(a)}/versions`)),
    def("pipeline_version_delete", "Delete one old version of a pipeline (a pipeline holds 100). The latest version, and a version a queued or running run reads, are 409.", { owner: OWNER, pipeline: PIPE, version: { ...I, description: "The version number from pipeline_versions." } }, ["owner", "pipeline", "version"], async (a) => api("DELETE", `${pipe(a)}/versions/${a.version}`)),
    def("pipeline_delete", "Delete a pipeline and all its versions. Finished runs stay. 409 while a run is queued or running.", { owner: OWNER, pipeline: PIPE }, ["owner", "pipeline"], async (a) => api("DELETE", pipe(a))),
    def("webhook_rotate", "Make a new webhook secret for a pipeline; the old URL stops at once. The answer holds the new `webhookUrl` once: keep it secret and tell the person. 409 when the webhook trigger is off.", { owner: OWNER, pipeline: PIPE }, ["owner", "pipeline"], async (a) => api("POST", `${pipe(a)}/webhook/rotate`)),
    def("run_start", "Start a run of a pipeline by hand. It returns at once with the run in `queued`. Call run_wait. A run that cannot be planned is a 422 with every reason, and nothing is recorded.", { owner: OWNER, pipeline: PIPE, inputs: { type: "object", additionalProperties: S, description: "String values by input name." }, version: { ...I, description: "The version to run. Default: the newest." }, key: { type: "string", description: "A retry key: a second start with the same key answers the first run." } }, ["owner", "pipeline"], async (a) =>
      api("POST", `${pipe(a)}/runs`, strip({ inputs: a.inputs, version: a.version, key: a.key }))),
    def("run_list", "List runs, newest first, of one pipeline or (without `pipeline`) of every pipeline of the owner.", { owner: OWNER, pipeline: PIPE, state: { type: "string", enum: ["queued", "running", "success", "failure", "cancelled"] }, limit: I }, ["owner"], async (a) => {
      const q = qs({ state: a.state, limit: a.limit === undefined ? undefined : String(a.limit) });
      return api("GET", a.pipeline ? `${pipe(a)}/runs${q}` : `/v1/pipelines/${seg(a.owner)}/runs${q}`);
    }),
    def("run_get", "Read one run: `state` (`queued`, `running`, `success`, `failure`, `cancelled`), its jobs and their states.", RUNREF, RUNREQ, async (a) => api("GET", run(a))),
    def("run_wait", "Wait until a run is `success`, `failure` or `cancelled`, then return the run (without its definition). `timedOut: true` means it was still going after `timeout` seconds. There is no server wait: the tool polls with back-off.", { ...RUNREF, timeout: WAIT }, RUNREQ, async (a) =>
      pollDoc(run(a), (d) => ["success", "failure", "cancelled"].includes(d?.state), a.timeout, tickMs, ({ definition: _d, ...rest }) => rest)),
    def("run_logs", "Read the output of one job of a run from a byte offset, one page of at most 1 MiB: `{data, next, complete, state}`. Without `offset` only the last 200 lines of the page are kept (`tail`, maximum 2000; `head` keeps the first lines). With `offset` the whole page comes back: while `complete` is false, call again with `offset` = `next`.", { ...RUNREF, job: { ...I, description: "The job's index in the run (default 0)." }, offset: I, tail: TAIL, head: HEAD }, RUNREQ, async (a) => {
      const out = await api("GET", `${run(a)}/jobs/${a.job ?? 0}/logs${qs({ offset: a.offset === undefined ? undefined : String(a.offset) })}`);
      if (a.offset !== undefined) return out;
      try {
        const d = JSON.parse(out);
        return typeof d?.data === "string" ? JSON.stringify({ ...d, data: cutLines(d.data, a) }, null, 2) : out;
      } catch {
        return out;
      }
    }),
    def("run_cancel", "Ask a run to stop. A queued run is cancelled at once; a running one stops at its next report, so poll run_get. 409 when it has already finished.", RUNREF, RUNREQ, async (a) => api("POST", `${run(a)}/cancel`)),

    // Secrets and workspace variables
    def("secret_set", "Store a secret value under a name (`A-Z`, `0-9`, `_`), replacing an existing one. The value is never printed back: not here, not by secret_list, not by any tool. Answers `{name, updatedAt}`. The harness session transcript keeps this call's arguments, so the value is redacted there. A pod reads it only through an env value that is exactly `${{ secrets.NAME }}`. A team's shared secret needs a team admin; set `mine` for your own in a team.", { owner: OWNER, name: S, value: S, mine: MINE }, ["owner", "name", "value"], async (a) => {
      await api("PUT", `${secret(a)}/${seg(a.name)}`, { value: a.value });
      // The route answers 204: the date comes from the names list, which never carries a value.
      const list = await raw("GET", secret(a)).catch(() => undefined);
      const row = list && !list.unavailable && Array.isArray(list.data) ? list.data.find((s: any) => s.name === a.name) : undefined;
      return JSON.stringify({ name: a.name, updatedAt: row?.updated_at ?? new Date().toISOString() }, null, 2);
    }),
    def("secret_list", "List the names of an owner's secrets with when and by whom each was last set. Never a value.", { owner: OWNER, mine: MINE }, ["owner"], async (a) => api("GET", secret(a))),
    def("secret_delete", "Delete one secret. 409 while a workspace, sandbox, service or pipeline references it; the answer names the referrers.", { owner: OWNER, name: S, mine: MINE }, ["owner", "name"], async (a) => api("DELETE", `${secret(a)}/${seg(a.name)}`)),
    def("workspace_env_get", "Read a workspace's variables as stored: `{env, restartOnEnvChange}`. A secret shows as its `${{ secrets.NAME }}` reference, never a value. Owner only.", { workspace: WS }, ["workspace"], async (a) => api("GET", `/v1/workspaces/${seg(a.workspace)}/env`)),
    def("workspace_env_set", "Set variables of a workspace. By default the given ones are merged into the current set (read with workspace_env_get): others stay. With `replace: true` the whole set is replaced: variables left out are removed, `{}` clears it. A value of exactly `${{ secrets.NAME }}` reads a secret. A running workspace keeps its old variables and is marked `restart_required`; call workspace_restart, or set `restart_on_change`.", { workspace: WS, variables: { type: "object", additionalProperties: S, description: "Variable name to value." }, replace: { type: "boolean", description: "Replace the whole set instead of merging." }, restart_on_change: { type: "boolean", description: "Restart the workspace itself whenever its variables change from now on." } }, ["workspace", "variables"], async (a) => {
      let env = a.variables;
      if (!a.replace) {
        const cur = JSON.parse(await api("GET", `/v1/workspaces/${seg(a.workspace)}/env`));
        env = { ...(cur?.env ?? {}), ...a.variables };
      }
      return api("PUT", `/v1/workspaces/${seg(a.workspace)}/env`, strip({ env, restartOnEnvChange: a.restart_on_change }));
    }),
    def("workspace_restart", "Restart a running workspace so that it reads its current variables and secrets. It returns at once; poll workspace_get. 409 when it is not running (its next start reads them anyway)." , { workspace: WS }, ["workspace"], async (a) => api("POST", `/v1/workspaces/${seg(a.workspace)}/restart`)),
    def("service_restart", "Restart one service of an environment so that it reads its current variables and secrets. It returns at once; call env_wait. 409 when the environment is not running.", { env: ENV, service: S }, ["env", "service"], async (a) => api("POST", `/v1/environments/${seg(a.env)}/services/${seg(a.service)}/restart`)),

    // Connectors
    def("connector_list", "List the git, registry and model-hub connectors of an owner: name, provider, kind, account and state (`connected`, `expired`, `revoked`). Read only: connecting happens in the web console.", { owner: { ...OWNER, description: "Your handle or a team slug. Default: your own." } }, [], async (a) => api("GET", `/v1/connectors${qs({ owner: a.owner })}`)),

    // Session lifecycle and time to live
    def("session_create", "Create a session in a team, optionally connected to an environment of that team. The name is 1 to 40 lowercase letters, digits or `-`.", { name: S, team: { type: "string", description: "A team you belong to. Omit it for your own." }, environment: { type: "string", description: "An environment id or name of the same team." }, ttl_secs: { ...I, description: "Unused seconds before it is deleted, 600 to 2592000. Default: never." } }, ["name"], async (a) =>
      api("POST", "/v1/sessions", strip({ name: a.name, team: a.team, environment: a.environment, ttl_secs: a.ttl_secs }))),
    def("session_stop", "Stop a session and every workspace in it, its bench too: the bench serves your tools on the laptop and runs the agent in the harness, so this ends the tools you are using. Do it as the very last act and tell the person first. Sandboxes and the environment are not touched. It returns at once.", { session: SES }, ["session"], async (a) => api("POST", `/v1/sessions/${seg(a.session)}/stop`)),
    def("session_start", "Start a session: its environment, then its workspaces. It returns at once; poll workspace_get and env_wait.", { session: SES }, ["session"], async (a) => api("POST", `/v1/sessions/${seg(a.session)}/start`)),
    def("session_delete", "Delete a session. Its workspaces are deleted (snapshots stay) and its sandboxes ended. Answers the ids removed.", { session: SES }, ["session"], async (a) => api("DELETE", `/v1/sessions/${seg(a.session)}`)),
    def("session_ttl", "Set (`ttl_secs`) or remove (`clear`) how long a session may stay unused before it is deleted. An awake session is never deleted by it.", { session: SES, ttl_secs: TTL, clear: CLEAR }, ["session"], async (a) => { const b = ttlBody(a); return typeof b === "string" ? b : api("PUT", `/v1/sessions/${seg(a.session)}/ttl`, b); }),
    def("workspace_ttl", "Set (`ttl_secs`) or remove (`clear`) how long a workspace may stay unused before it is deleted.", { workspace: WS, ttl_secs: TTL, clear: CLEAR }, ["workspace"], async (a) => { const b = ttlBody(a); return typeof b === "string" ? b : api("PUT", `/v1/workspaces/${seg(a.workspace)}/ttl`, b); }),
    def("env_ttl", "Set (`ttl_secs`) or remove (`clear`) how long an environment may stay unused before it is deleted. An environment with a session connected is never deleted by it.", { env: ENV, ttl_secs: TTL, clear: CLEAR }, ["env"], async (a) => { const b = ttlBody(a); return typeof b === "string" ? b : api("PUT", `/v1/environments/${seg(a.env)}/ttl`, b); }),
  ];
}
