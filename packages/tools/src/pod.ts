//! The workspace pod's code tools (crates/ide `kl ide serve`, port 7788), reached through the
//! platform: GET /v1/workspaces/{id}/tools gives {address, token?}, then plain HTTP to the pod.
//! The names are a FIXED list so the tools exist even while the pod is not Ready; the pod's own
//! description/schema replace the permissive fallback when it answers at construction.
import type { ToolDef } from "./index.ts";
import { api, apiJson, seg } from "./platform.ts";
import { resource, type Action } from "./actions.ts";
import { ensureRunning } from "./ensure.ts";

export const POD_TOOLS = ["read", "write", "edit", "glob", "grep", "exec", "process", "watch", "container_build", "container_push"];

/** The tools the pod serves one per verb, folded here into one tool per resource: `{action}` -> the pod's own tool.
 * The pod keeps `patch` and `process_close_stdin` for its HTTP users; `close_stdin` stays an action, `patch` is not forwarded. */
const FOLDED: Record<string, { description: string; pod: Record<string, string> }> = {
  process: { description: "Detached processes of a workspace (a long exec job becomes one). Actions: list, output, wait, write, close_stdin, kill. An exited process is never restarted; one killed by a workspace stop is relaunched unless the exec passed `relaunch: false` (state `killed_by_restart`).", pod: { list: "process_list", output: "process_output", wait: "process_wait", write: "process_write", close_stdin: "process_close_stdin", kill: "process_kill" } },
  watch: { description: "Watch paths of a workspace for changes. Actions: start, poll, stop.", pod: { start: "watch", poll: "watch_poll", stop: "watch_stop" } },
};

type Addr = { address: string; token?: string };
type Listed = { name: string; description?: string; schema?: Record<string, unknown> };

/** Names of the owner's registry connectors (`connector_list`'s call); empty when the listing fails. */
async function registryNames(): Promise<string[]> {
  try {
    const j: any = JSON.parse(await api("GET", "/v1/connectors"));
    const rows: any[] = Array.isArray(j) ? j : j?.connectors ?? [];
    return rows.filter((c) => c?.kind === "registry").map((c) => String(c.name ?? c.connector));
  } catch {
    return [];
  }
}

/** `kl` prints these two sentences (bins/kl/src/registries.rs); the model gets a shape it can act on. */
export async function mapBuild(j: any): Promise<void> {
  const err = String(j?.stderr ?? "");
  const unknown = /no registry named (\S+?);/.exec(err);
  if (!unknown && !err.includes("no registry is configured")) return;
  const registries = await registryNames();
  throw new Mapped(JSON.stringify(unknown ? { error: "unknown_registry", registry: unknown[1], registries } : { error: "no_registry", hint: "connect one in the console under Connectors", registries }));
}

/** What the tool server says stands between exec and the world (`fence` in `GET /tools`). */
export type PodFence = { sandbox?: string; network?: string };
const fences = new Map<string, PodFence>();
/** The fence `podTools(ws)` last read; undefined when the server is older or was unreachable. */
export const podFence = (ws: string): PodFence | undefined => fences.get(ws);

/** Last call per workspace: the hold beat (daemon.ts) pings only workspaces a running turn has used. */
export const touched = new Map<string, number>();
/** Calls in flight per workspace: a Claude Code session has no turn in the backend, but its call is running. */
export const inflight = new Map<string, number>();
/** Per-process crash-notice choice from `exec`'s `notify`, keyed `{workspace}/{process id}`; the bench's watch (backend/src/watch.ts) reads it. */
export type Notify = "never" | "on_failure" | "always";
export const processNotify = new Map<string, Notify>();
const canonIds = new Map<string, string>();
/** The workspace's id however the model spelled it (id or name), so `touched`, `processNotify` and the watch's
 * keys are one per workspace. A lookup that fails keeps the spelling it got and is not remembered. */
async function canonical(ws: string): Promise<string> {
  const known = canonIds.get(ws);
  if (known) return known;
  try {
    const id = (await apiJson<any>("GET", `/v1/workspaces/${encodeURIComponent(ws)}`))?.id;
    if (typeof id === "string" && id) return canonIds.set(ws, id), id;
  } catch {}
  return ws;
}
/** Backoff before each re-resolve after a network error (tests shorten it). */
export const retryDelays = [2000, 4000, 8000, 16000];
const NOTIFY: Notify[] = ["never", "on_failure", "always"];

class NotReady extends Error {}
class Mapped extends Error {} // an answer already shaped for the model: not wrapped with the tool name

/** How long the tool will wait, as the pod reads it: `soft_ms` (the hand-off point), else `timeout_ms`, else the aliases
 * (`max_wait_ms` in ms, `timeout_s` and `timeout` in seconds), else the default. The client waits this plus a margin, never less. */
export function waitMs(args: any, dflt: number): number {
  for (const k of ["soft_ms", "timeout_ms", "max_wait_ms"]) if (Number(args?.[k]) > 0) return Number(args[k]);
  const s = Number(args?.timeout_s) > 0 ? Number(args.timeout_s) : Number(args?.timeout);
  return s > 0 ? s * 1000 : dflt;
}

/** The pod still reads these spellings; the schemas the model sees list `timeout_ms`/`soft_ms` only. */
const ALIASES = new Set(["timeout", "timeout_s", "max_wait_ms"]);
const withoutAliases = (sch: any) => (sch?.properties ? { ...sch, properties: Object.fromEntries(Object.entries(sch.properties).filter(([k]) => !ALIASES.has(k))) } : sch);

async function lookup(ws: string): Promise<Addr> {
  // api throws on a non-2xx answer; for these callers that is "not ready", not a crash
  const out = await api("GET", `/v1/workspaces/${encodeURIComponent(ws)}/tools`).catch((e) => {
    throw new NotReady(String(e?.message ?? e).replace(/^\d+: /, ""));
  });
  const a = JSON.parse(out);
  if (!a?.address) throw new NotReady("no address");
  return a;
}

/** A ready workspace's tool server, for reads that are not model tool calls (sidebar). One
 * lookup per call: the address and token rotate, and a sidebar beat is 5 s apart. */
async function podFetch<T>(ws: string, path: string, init: RequestInit, ms: number, text = false): Promise<T> {
  const a = await apiJson<Addr>("GET", `/v1/workspaces/${encodeURIComponent(ws)}/tools`);
  if (!a?.address) throw new Error("no address");
  const res = await fetch(`http://${a.address}${path}`, { ...init, headers: { ...(init.headers as object), ...headers(a), "x-kl-watch": "1" }, signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`error ${res.status}`); // body withheld: it may echo the token
  return (text ? await res.text() : await res.json()) as T;
}
export const podGet = <T>(ws: string, path: string, ms = 5000) => podFetch<T>(ws, path, {}, ms);
/** A pod file's bytes as text (`/fs/file`). */
export const podText = (ws: string, path: string, ms = 10_000) => podFetch<string>(ws, path, {}, ms, true);
export const podPost = <T>(ws: string, tool: string, args: unknown, ms = 5000) =>
  podFetch<T>(ws, `/tools/${tool}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(args ?? {}) }, ms);

const headers = (a: Addr): Record<string, string> => (a.token ? { authorization: `Bearer ${a.token}` } : {});

export async function podTools(ws: string, o: { ensure?: typeof ensureRunning } = {}): Promise<ToolDef[]> {
  let cache: Addr | undefined;
  const addr = async () => (cache ??= await lookup(ws));

  let listed = new Map<string, Listed>();
  fences.delete(ws);
  try {
    const a = await addr();
    const res = await fetch(`http://${a.address}/tools`, { headers: headers(a), signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const body = (await res.json()) as { tools: Listed[]; fence?: PodFence };
      for (const t of body.tools) listed.set(t.name, t);
      if (body.fence) fences.set(ws, body.fence);
    }
  } catch {
    cache = undefined;
  }

  async function post(name: string, args: any, timeout: number): Promise<Response> {
    const a = await addr();
    return fetch(`http://${a.address}/tools/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers(a) },
      body: JSON.stringify(args ?? {}),
      signal: AbortSignal.timeout(timeout),
      // Bun's fetch gives up after 300 s whatever the signal says ("The operation timed out." on every
      // exec or build with a timeout_ms past ~285000, 2026-10-17); our own signal is the deadline.
      timeout: false,
    } as RequestInit);
  }

  async function call(name: string, args: any): Promise<string> {
    const label = name.replace(/^(process|watch)_/, "$1 "); // the model calls `process` with an action, never `process_wait`
    // `notify` is the bench's, not the pod's: keep it, forward the rest
    let notify: Notify | undefined;
    if (name === "exec" && args && "notify" in args) {
      const { notify: n, ...rest } = args;
      if (NOTIFY.includes(n)) notify = n;
      args = rest;
    }
    // exec and a build promote to a process at `soft_ms` (25 s, crates/ide SOFT_MS) rather than running to the end.
    const timeout = name === "exec" || name === "container_build" ? waitMs(args, 25_000) + 15_000
      : name === "process_wait" ? waitMs(args, 20_000) + 15_000
      : name === "container_push" ? 180_000 : 60_000;
    try {
      let res: Response | undefined;
      const id = await canonical(ws);
      touched.set(id, Date.now());
      inflight.set(ws, (inflight.get(ws) ?? 0) + 1);
      // a stale address (pod restarted, token rotated) shows as a network error or 401: re-resolve once.
      // Never after our own timeout: the pod got the call and may still be running it, so a resend
      // runs a second `go test` beside the first (2026-10-10: one exec became nine minutes).
      let woke = false;
      let netTries = 0;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          res = await post(name, args, timeout);
          if (res.status !== 401 || attempt) break;
        } catch (e: any) {
          // an idle-stopped workspace has no address: wake it once (a person's stop throws from ensure) and go again
          if (e instanceof NotReady && !woke) {
            woke = true;
            await (o.ensure ?? ensureRunning)("workspaces", ws);
            attempt--;
          } else if (e instanceof NotReady || e?.name === "TimeoutError") throw e;
          else if (attempt) {
            // a container-only restart keeps pod and IP but the tool server is back only after seconds: 2+4+8+16 s, re-resolving each time
            if (netTries >= retryDelays.length) throw e;
            await new Promise((r) => setTimeout(r, retryDelays[netTries++]));
            attempt--;
          }
        }
        cache = undefined;
      }
      const text = await res!.text();
      if (res!.ok) {
        let built: any;
        let out: string;
        try {
          const j = JSON.parse(text);
          built = j;
          // every detached or promoted exec is registered (default on_failure): the watch reports only these, never a plain exec that exited 1
          if (name === "exec" && typeof j?.id === "string") processNotify.set(`${id}/${j.id}`, notify ?? "on_failure");
          if (name === "process_kill" && typeof args?.id === "string") processNotify.set(`${id}/${args.id}`, "never");
          out = JSON.stringify(j, null, 2);
        } catch {
          out = text;
        }
        if (name === "container_build") await mapBuild(built);
        return out;
      }
      let msg = text;
      try {
        msg = JSON.parse(text).error ?? text;
      } catch {}
      throw new Error(`${label} ${res!.status}: ${msg}`);
    } catch (e: any) {
      // a failed call throws (a codemode script stops, a direct call shows as failed); a command that ran and exited non-zero is a 200 and stays a result
      if (e instanceof Mapped) throw e;
      if (e instanceof NotReady) throw new Error(`${label}: workspace not ready: ${e.message}`);
      throw e?.message?.startsWith(`${label} `) ? e : new Error(`${label}: ${e?.message ?? e}`);
    } finally {
      const n = (inflight.get(ws) ?? 1) - 1;
      n > 0 ? inflight.set(ws, n) : inflight.delete(ws);
    }
  }

  /** One resource tool over the pod's own schemas; two actions that spell one key differently in prose share the first spelling. */
  const folded = (name: string): ToolDef => {
    const { description, pod } = FOLDED[name]!;
    const seen: Record<string, any> = {};
    const actions: Record<string, Action> = {};
    for (const [act, podName] of Object.entries(pod)) {
      if (listed.size && !listed.has(podName)) continue;
      const sch: any = withoutAliases(listed.get(podName)?.schema ?? {});
      const properties: Record<string, unknown> = {};
      for (const [k, v] of Object.entries<any>(sch.properties ?? {})) {
        const { description: _d, ...bare } = v;
        const prior = seen[k];
        properties[k] = prior && JSON.stringify(prior.bare) === JSON.stringify(bare) ? prior.v : v;
        seen[k] ??= { bare, v };
      }
      actions[act] = { properties, required: sch.required ?? [], run: (a) => call(podName, a) };
    }
    return { ...resource(name, `${description} (This tool runs in workspace ${ws}.)`, actions) };
  };

  return POD_TOOLS.filter((n) => listed.size === 0 || (n in FOLDED ? Object.values(FOLDED[n]!.pod).some((p) => listed.has(p)) : listed.has(n))).map((name) => {
    if (name in FOLDED) return folded(name);
    const t = listed.get(name);
    const sch: any = withoutAliases(t?.schema) ?? { type: "object", additionalProperties: true };
    return {
      name,
      description: t?.description ? `${t.description} (This tool runs in workspace ${ws}.)` : `This tool runs in workspace ${ws}.`,
      inputSchema: name === "exec" ? { ...sch, properties: { ...sch.properties, notify: { type: "string", enum: NOTIFY, description: "Report a detached or promoted process that ends: `on_failure` (default) tells you on a non-zero exit, `always` also on a clean one, `never` stays silent." } } } : sch,
      run: (args: any) => call(name, args),
    };
  });
}

/** Keeps a READY workspace from idling while a turn that needs it runs elsewhere. Never wakes:
 * a stopped workspace stays stopped until a real call needs it. Errors are dropped. */
export async function podHold(ws: string): Promise<void> {
  try {
    const a = await lookup(ws);
    await fetch(`http://${a.address}/hold`, { method: "POST", headers: headers(a), signal: AbortSignal.timeout(5_000) });
  } catch {}
}

/** Somebody is using this bench's session (a turn runs, a client is connected): hold it. The API
 * stamps `held-at` on the Session and wakes it if it idled; an awake session keeps its environment
 * up and its members running (owner ruling 2026-10-16: a bench never idles, its session does).
 * Best effort, errors dropped; no `KL_SESSION` means not a bench, nothing to hold. */
export async function sessionHold(id = process.env.KL_SESSION): Promise<void> {
  if (!id) return;
  try {
    await apiJson("POST", `/v1/sessions/${seg(id)}/hold`);
  } catch {}
}

export type ExecResult = { code: number; stdout: string; stderr: string };

/** One shell job in workspace `ws` through its tool server (same lookup as `podTools`, fresh each
 * call: callers are the delegate's few git steps, not a hot path). A transport or non-2xx failure
 * comes back as code -1 with the reason in stderr, never a throw. The token stays in the header. */
export async function podExec(ws: string, cmd: string, timeoutMs = 120_000): Promise<ExecResult> {
  try {
    const a = await lookup(ws);
    const res = await fetch(`http://${a.address}/tools/exec`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers(a) },
      body: JSON.stringify({ cmd, timeout_ms: timeoutMs }),
      signal: AbortSignal.timeout(timeoutMs + 15_000),
      timeout: false,
    } as RequestInit);
    const text = await res.text();
    if (!res.ok) return { code: -1, stdout: "", stderr: `exec ${res.status}: ${text}` };
    const j = JSON.parse(text);
    return { code: j.exit_code ?? -1, stdout: j.stdout ?? "", stderr: j.stderr ?? "" };
  } catch (e: any) {
    return { code: -1, stdout: "", stderr: e instanceof NotReady ? `workspace not ready: ${e.message}` : `${e?.message ?? e}` };
  }
}

/**
 * The pod tools for ANY workspace (the laptop MCP door, backend/src/mcp.ts): each takes a required
 * `workspace` and runs through that workspace's own `podTools`. Schemas come from `sample` (a running
 * workspace) when it answers; a workspace's tools are built once and kept, so its address is
 * resolved on first use and re-resolved by `podTools` itself.
 */
export async function anyPodTools(sample?: string): Promise<ToolDef[]> {
  const shape = new Map((sample ? await podTools(sample) : []).map((t) => [t.name, t]));
  const per = new Map<string, Promise<ToolDef[]>>();
  return POD_TOOLS.map((name) => {
    const s: any = shape.get(name)?.inputSchema ?? { type: "object", additionalProperties: true };
    const description = (shape.get(name)?.description ?? "").replace(/ ?\(This tool runs in workspace [^)]*\.\)$/, "");
    return {
      name,
      description: description.trim(),
      inputSchema: { ...s, type: "object", properties: { workspace: { type: "string", description: "The workspace id or name." }, ...s.properties }, required: ["workspace", ...(s.required ?? []).filter((n: string) => n !== "workspace")] },
      run: async (input: any) => {
        const { workspace, ...args } = input ?? {};
        if (typeof workspace !== "string" || !workspace) throw new Error(`${name}: workspace is required`);
        let tools = per.get(workspace);
        if (!tools) per.set(workspace, (tools = podTools(workspace)));
        const t = (await tools).find((t) => t.name === name);
        if (!t) throw new Error(`${name}: workspace ${workspace} does not serve this tool`);
        return t.run(args);
      },
    };
  });
}
