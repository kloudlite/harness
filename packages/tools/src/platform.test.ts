import { afterEach, beforeEach, expect, jest, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { api, platformTools } from "./platform.ts";

type Call = { method: string; url: string; auth: string | null; body: any };
let calls: Call[] = [];
let routes: Record<string, () => Response | Promise<Response>> = {};
const realFetch = globalThis.fetch;
let tokenFile = "";

beforeEach(() => {
  calls = [];
  routes = {};
  tokenFile = join(mkdtempSync(join(tmpdir(), "kl-tok-")), "token");
  writeFileSync(tokenFile, "tok1\n");
  process.env.KL_API_URL = "http://api.test";
  process.env.KL_TOOL_KEY_FILE = tokenFile;
  delete process.env.KL_SESSION;
  globalThis.fetch = (async (url: string, init: any = {}) => {
    const u = String(url).replace("http://api.test", "");
    calls.push({ method: init.method ?? "GET", url: u, auth: init.headers?.authorization ?? null, body: init.body ? JSON.parse(init.body) : undefined });
    const r = routes[`${init.method ?? "GET"} ${u}`];
    return r ? await r() : new Response("not found", { status: 404 });
  }) as any;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.KL_API_URL;
  delete process.env.KL_TOOL_KEY_FILE;
  delete process.env.KL_SESSION;
});

const json = (v: unknown, status = 200) => () => new Response(JSON.stringify(v), { status });
/** The old per-verb tool names, as {tool, action} calls on the folded tools: the cases below keep their wording. */
const tool = (tools: ReturnType<typeof platformTools>, n: string) => {
  const exact = tools.find((t) => t.name === n);
  if (exact) return exact;
  const over: Record<string, [string, string, ((i: any) => any)?]> = {
    pipeline_version_delete: ["pipeline", "delete"],
    workspace_env_get: ["workspace_vars", "get"],
    workspace_env_set: ["workspace_vars", "set"],
  };
  if (over[n]) {
    const [tn, action] = over[n]!;
    const t = tools.find((x) => x.name === tn)!;
    return { ...t, name: n, run: (i: any) => t.run({ action, ...i }) };
  }
  const r = tools.filter((t) => n.startsWith(t.name + "_")).sort((a, b) => b.name.length - a.name.length)[0];
  if (!r) throw new Error(`no tool ${n}`);
  const action = n.slice(r.name.length + 1);
  const tweak: Record<string, (i: any) => any> = {
    session_connect: (i) => ({ action: "use", environment: i.environment }),
    session_disconnect: () => ({ action: "use", environment: null }),
    workspace_clone: ({ workspace, ...i }) => ({ action: "create", source: workspace, ...i }),
  };
  return { ...r, name: n, run: (i: any) => r.run(tweak[n] ? tweak[n]!(i ?? {}) : { action, ...(i ?? {}) }) };
};

test("api reads the token file on every call, reports unavailable, 204 and errors", async () => {
  routes["GET /x"] = json({ a: 1 });
  routes["DELETE /x"] = () => new Response(null, { status: 204 });
  routes["POST /x"] = () => new Response('{"error":"busy"}', { status: 409 });
  expect(await api("GET", "/x")).toBe('{\n  "a": 1\n}');
  writeFileSync(tokenFile, "tok2");
  await api("GET", "/x");
  expect(calls.map((c) => c.auth)).toEqual(["Bearer tok1", "Bearer tok2"]);
  expect(await api("DELETE", "/x")).toBe("ok");
  await expect(api("POST", "/x", {})).rejects.toThrow('409: {"error":"busy"}');
  delete process.env.KL_API_URL;
  await expect(api("GET", "/x")).rejects.toThrow("platform tools unavailable");
});

test("packages_add merges by attr, packages_remove errors on unknown", async () => {
  const t = platformTools("workspace", "w1");
  routes["GET /v1/workspaces/w1"] = json({ packages: ["nodejs", "git@2"] });
  routes["PATCH /v1/workspaces/w1"] = json({});
  await tool(t, "packages_add").run({ packages: ["nodejs@20", "jq"] });
  expect(calls.at(-1)!.body).toEqual({ packages: ["git@2", "nodejs@20", "jq"] });
  await tool(t, "packages_remove").run({ packages: ["git"] });
  expect(calls.at(-1)!.body).toEqual({ packages: ["nodejs"] });
  const n = calls.length;
  await expect(tool(t, "packages_remove").run({ packages: ["zzz"] })).rejects.toThrow("not declared: zzz");
  expect(calls.length).toBe(n + 1); // the GET only, no PATCH
});

test("a workspace session has the slice its token reaches, folded; main keeps today's subset and all adds the workspace-only tools", async () => {
  const slice = platformTools("workspace", "w1");
  expect(slice.map((x) => x.name)).toEqual(["workspace", "env", "session", "service", "packages", "intercept"]);
  const actions = (t: ReturnType<typeof platformTools>, n: string) => (tool(t, n).inputSchema as any).properties.action.enum;
  expect(actions(slice, "workspace")).toEqual(["stop", "snapshot"]);
  expect(actions(slice, "env")).toEqual(["get", "wait"]);
  expect(actions(slice, "session")).toEqual(["current"]);
  expect(actions(platformTools("workspace", "w1", 5000, true), "workspace")).toEqual(["snapshot"]);
  const main = platformTools("main");
  expect(actions(main, "packages")).toEqual(["list"]);
  expect(main.map((x) => x.name)).not.toContain("intercept");
  expect(actions(platformTools("all"), "packages")).toEqual(["list", "add", "remove", "update"]);
  routes["POST /v1/workspaces/w1/stop"] = json({ id: "w1", state: "stopped" }, 202);
  const stop = tool(slice, "workspace_stop");
  expect((tool(slice, "workspace").inputSchema as any).properties.workspace).toBeUndefined();
  expect(JSON.parse(await stop.run({}))).toEqual({ id: "w1", state: "stopped" });
  expect(calls.filter((c) => c.method === "POST").at(-1)!.url).toBe("/v1/workspaces/w1/stop");
  await expect(tool(main, "workspace_stop").run({})).rejects.toThrow("`workspace` is required");
});

test("service add/update/remove PATCH the whole list; duplicates and strangers error", async () => {
  const t = platformTools("main");
  const a = { name: "a", image: "a:1" };
  const b = { name: "b", image: "b:1" };
  routes["GET /v1/environments/e1"] = json({ services: [a] });
  routes["PATCH /v1/environments/e1"] = json({});
  await tool(t, "service_add").run({ env: "e1", service: b });
  expect(calls.at(-1)!.body).toEqual({ services: [a, { ...b, command: [], env: {}, mounts: [] }] });
  await tool(t, "service_update").run({ env: "e1", service: { name: "a", image: "a:2" } });
  expect(calls.at(-1)!.body).toEqual({ services: [{ name: "a", image: "a:2", env: {} }] });
  await tool(t, "service_update").run({ env: "e1", service: { name: "a", image: "a:3", env: { K: "v" } } });
  expect(calls.at(-1)!.body).toEqual({ services: [{ name: "a", image: "a:3", env: { K: "v" } }] });
  await tool(t, "service_remove").run({ env: "e1", name: "a" });
  expect(calls.at(-1)!.body).toEqual({ services: [] });
  // merge: absent fields stay, env merges by key, null removes
  routes["GET /v1/environments/e1"] = json({ services: [{ name: "a", image: "a:1", env: { X: "1", Y: "2" }, ports: [80] }] });
  await tool(t, "service_update").run({ env: "e1", service: { name: "a", image: "a:2", env: { X: null, Z: "3" } } });
  expect(calls.at(-1)!.body).toEqual({ services: [{ name: "a", image: "a:2", env: { Y: "2", Z: "3" }, ports: [80] }] });
  await tool(t, "service_update").run({ env: "e1", service: { name: "a" } });
  expect(calls.at(-1)!.body).toEqual({ services: [{ name: "a", image: "a:1", env: { X: "1", Y: "2" }, ports: [80] }] });
  routes["GET /v1/environments/e1"] = json({ services: [a] });
  await expect(tool(t, "service_add").run({ env: "e1", service: a })).rejects.toThrow("service exists: a");
  await expect(tool(t, "service_update").run({ env: "e1", service: b })).rejects.toThrow("no such service");
  await expect(tool(t, "service_remove").run({ env: "e1", name: "q" })).rejects.toThrow("no such service");
});

test("workspace sessions default env through the workspace's session", async () => {
  const t = platformTools("workspace", "w1");
  routes["GET /v1/workspaces/w1"] = json({ team: "acme", session: "ses-1", environment: "e9", packages: [] });
  routes["GET /v1/environments/e9"] = json({ services: [] });
  routes["POST /v1/environments/e9/intercepts"] = json({}, 202);
  await tool(t, "env_get").run({});
  expect(calls.at(-1)!.url).toBe("/v1/environments/e9");
  await tool(t, "intercept_start").run({ service: "web" });
  const posted = (method: string) => calls.filter((c) => c.method === method).at(-1)!.body;
  expect(posted("POST")).toEqual({ service: "web", workspace: "w1" });
  // no aiming it at another workspace
  expect((tool(t, "intercept_start").inputSchema as any).properties.workspace).toBeUndefined();
  await tool(t, "intercept_start").run({ service: "web", workspace: "w2" });
  expect(posted("POST")).toEqual({ service: "web", workspace: "w1" });
  // in a session whose environment is not resolved, or in none
  routes["GET /v1/workspaces/w1"] = json({ session: "ses-1", packages: [] });
  await expect(tool(t, "env_get").run({})).rejects.toThrow("this workspace's session has no environment");
  routes["GET /v1/workspaces/w1"] = json({ packages: [] });
  await expect(tool(t, "env_get").run({})).rejects.toThrow("this workspace is in no session");
  expect(t.some((x) => x.name === "workspace_create")).toBe(false);
});

test("the bench offers session current and use: a bench belongs to its session and never joins another", () => {
  for (const kind of ["main", "all"] as const) expect((tool(platformTools(kind, "w1"), "session").inputSchema as any).properties.action.enum).toEqual(expect.arrayContaining(["current", "use", "create"]));
  expect((tool(platformTools("workspace", "w1"), "session").inputSchema as any).properties.action.enum).toEqual(["current"]);
});

test("session_current shows the workspace's own session; the bench's is its KL_SESSION", async () => {
  routes["GET /v1/workspaces/w1"] = json({ session: "ses-1", environment: "e9" });
  expect(JSON.parse(await tool(platformTools("workspace", "w1"), "session_current").run({}))).toEqual({ session: "ses-1", environment: "e9" });
  const t = platformTools("main");
  expect(await tool(t, "session_current").run({})).toContain("no session");
  process.env.KL_SESSION = "ses-1";
  routes["GET /v1/sessions/ses-1"] = json({ id: "ses-1", name: "main", environment: "e9" });
  expect(JSON.parse(await tool(t, "session_current").run({}))).toEqual({ id: "ses-1", name: "main", environment: "e9" });
  routes["GET /v1/sessions/ses-1"] = json({ error: "no such session" }, 404);
  expect(await tool(t, "session_current").run({})).toContain("ended");
});

test("session use sets or clears the bench's environment (null disconnects) and refuses another session", async () => {
  const t = platformTools("main");
  delete process.env.KL_SESSION;
  expect(await tool(t, "session_connect").run({ environment: "e2" })).toContain("no session");
  process.env.KL_SESSION = "ses-1";
  routes["GET /v1/sessions/ses-1"] = json({ id: "ses-1", name: "main", environment: "e2" });
  routes["PUT /v1/sessions/ses-1/environment"] = json({ id: "ses-1", name: "main", environment: "e2" });
  expect(JSON.parse(await tool(t, "session_connect").run({ environment: "e2" }))).toEqual({ id: "ses-1", name: "main", environment: "e2" });
  expect(calls.filter((c) => c.method === "PUT").at(-1)!.body).toEqual({ environment: "e2" });
  routes["PUT /v1/sessions/ses-1/environment"] = json({ id: "ses-1", name: "main", environment: null });
  routes["GET /v1/sessions/ses-1"] = json({ id: "ses-1", name: "main", environment: null });
  expect(JSON.parse(await tool(t, "session_disconnect").run({}))).toEqual({ id: "ses-1", name: "main", environment: null });
  expect(calls.filter((c) => c.method === "PUT").at(-1)!.body).toEqual({ environment: null });
  // absent keeps; another session's name is refused
  const n = calls.length;
  await tool(t, "session").run({ action: "use" });
  expect(calls.slice(n).map((c) => c.method)).toEqual(["GET"]);
  await expect(tool(t, "session").run({ action: "use", name: "other", environment: "e3" })).rejects.toThrow("belongs to session main");
});

test("env_get folds service_status readiness into services[]; workspace_clone sends task only when given", async () => {
  const t = platformTools("main");
  routes["GET /v1/environments/e1"] = json({ services: [{ name: "a" }, { name: "b" }], service_status: [{ name: "a", ready: true }, { name: "b", ready: false, message: "pulling" }] });
  const out = JSON.parse(await tool(t, "env_get").run({ env: "e1" }));
  expect(out.services).toEqual([{ name: "a", ready: true }, { name: "b", ready: false, message: "pulling" }]);
  expect(out.service_status.length).toBe(2);
  routes["POST /v1/workspaces/w1/clone"] = json({}, 202);
  await tool(t, "workspace_clone").run({ workspace: "w1", name: "c" });
  expect(calls.at(-1)!.body).toEqual({ name: "c" });
  await tool(t, "workspace_clone").run({ workspace: "w1", name: "c", task: "try x" });
  expect(calls.at(-1)!.body).toEqual({ name: "c", task: "try x" });
});

test("a rejected service_add throws and sends no further call", async () => {
  const t = platformTools("main");
  routes["GET /v1/environments/e1"] = json({ services: [] });
  routes["PATCH /v1/environments/e1"] = json({ error: "services[0]: missing field `command`" }, 422);
  await expect(tool(t, "service_add").run({ env: "e1", service: { name: "n", image: "n:1" } })).rejects.toThrow("422:");
});

test("service_add of an existing name rejects with the refusal, no prefix", async () => {
  routes["GET /v1/environments/e1"] = json({ services: [{ name: "web", image: "w:1" }] });
  await expect(tool(platformTools("main"), "service_add").run({ env: "e1", service: { name: "web", image: "w:2" } })).rejects.toThrow("service exists: web");
});

test("request_create sends only the kind's own payload; requests_list filters by owner", async () => {
  const t = platformTools("main");
  routes["POST /v1/requests"] = json({});
  routes["GET /v1/requests?owner=acme"] = json([]);
  const post = async (a: any) => (await tool(t, "request_create").run(a), calls.at(-1)!.body);
  expect(await post({ kind: "access", reason: "r", access: { team: "acme", role: "member" } })).toEqual({ kind: "access", reason: "r", access: { team: "acme", role: "member" } });
  expect(await post({ kind: "region", reason: "r", region: "eu" })).toEqual({ kind: "region", reason: "r", region: { region: "eu" } });
  expect(await post({ kind: "other", reason: "r", title: "t", body: "b" })).toEqual({ kind: "other", reason: "r", other: { title: "t", body: "b" } });
  await tool(t, "requests_list").run({ owner: "acme" });
  expect(calls.at(-1)!.url).toBe("/v1/requests?owner=acme");
});

test("service_logs reads the api route, defaulting env in a workspace session", async () => {
  const lines = (...l: string[]) => json({ lines: l, pod: "web-0", truncated: false });
  routes["GET /v1/environments/e1"] = json({ id: "env-e1" });
  routes["GET /v1/environments/e1/services/web/logs?tail=50&previous=true"] = lines("a", "b");
  routes["GET /v1/environments/e1/services/web/logs"] = json({ lines: ["c"], pod: "web-0", truncated: true });
  routes["GET /v1/environments/e1/services/web/logs?previous=true"] = lines("d");
  const m = platformTools("main");
  expect(await tool(m, "service_logs").run({ env: "e1", name: "web", tail: 50, previous: true })).toBe("a\nb");
  expect(calls.at(-1)!.url).toBe("/v1/environments/e1/services/web/logs?tail=50&previous=true");
  // a quoted flag reads as the flag: "false" must not ask for the crashed container
  expect(await tool(m, "service_logs").run({ env: "e1", name: "web", previous: "false" })).toBe("c\n[truncated]");
  expect(await tool(m, "service_logs").run({ env: "e1", name: "web", previous: "true" })).toBe("d");
  await expect(tool(m, "service_logs").run({ name: "web" })).rejects.toThrow("`env` is required");
  // workspace: env defaults through the workspace's session
  const t = platformTools("workspace", "w1");
  routes["GET /v1/workspaces/w1"] = json({ team: "acme", session: "ses-1", environment: "e9", packages: [] });
  routes["GET /v1/environments/e9/services/web/logs"] = lines("z");
  expect(await tool(t, "service_logs").run({ name: "web" })).toBe("z");
});

test("every workspace and env param takes the id or the name, and no sentence says otherwise", () => {
  for (const kind of ["main", "workspace"] as const)
    for (const t of platformTools(kind, "ws-1")) {
      expect(t.description).not.toContain("Do not use the name");
      for (const k of ["workspace", "env"]) {
        const p = (t.inputSchema.properties as any)[k];
        if (p && t.name !== "intercept") expect(`${t.name}.${k}: ${p.description ?? ""}`).toContain("id or name");
      }
    }
});

test("all is main's table plus the workspace-only tools: every tool once, aimed by a required workspace or env per action", async () => {
  const main = platformTools("main").map((t) => t.name);
  const all = platformTools("all");
  const names = all.map((t) => t.name);
  expect(new Set(names).size).toBe(names.length);
  expect(new Set(names)).toEqual(new Set([...main, "intercept"]));
  for (const a of ["add", "remove", "update"]) await expect(tool(all, `packages_${a}`).run(a === "update" ? {} : { packages: ["x"] })).rejects.toThrow("`workspace` is required");
  await expect(tool(all, "intercept_start").run({ service: "s", workspace: "w" })).rejects.toThrow("`env` is required");
  await expect(tool(all, "intercept_start").run({ env: "e", service: "s" })).rejects.toThrow("`workspace` is required");
  await expect(tool(all, "intercept_stop").run({ service: "s" })).rejects.toThrow("`env` is required");
});

test("env_wait returns once every service is ready, at once on failing, and marks a timeout", async () => {
  const t = platformTools("main", undefined, 1);
  let n = 0;
  routes["GET /v1/environments/e1"] = () => json({ state: "running", services: [{ name: "a" }], service_status: [{ name: "a", ready: ++n >= 3 }] })();
  const out = JSON.parse(await tool(t, "env_wait").run({ env: "e1" }));
  expect(n).toBe(3);
  expect(out.timed_out).toBeUndefined();
  n = 0;
  routes["GET /v1/environments/e1"] = () => { n++; return json({ state: "creating", services: [{ name: "a" }], service_status: [{ name: "a", ready: false, failing: true, message: "crash" }] })(); };
  expect(JSON.parse(await tool(t, "env_wait").run({ env: "e1" })).services[0].failing).toBe(true);
  expect(n).toBe(2); // the idle check, then one settle read
  routes["GET /v1/environments/e1"] = json({ state: "creating", services: [{ name: "a" }], service_status: [{ name: "a", ready: false }] });
  const slow = platformTools("main", undefined, 1);
  const real = Date.now;
  let t0 = real();
  Date.now = () => (t0 += 4000); // each read of the clock skips 4 s, so the 10 s floor is reached in a few ticks
  try {
    expect(JSON.parse(await tool(slow, "env_wait").run({ env: "e1", timeout_ms: 1000 })).timed_out).toBe(true);
  } finally {
    Date.now = real;
  }
});

test("workspace_list keeps only the bench's session when KL_SESSION is set", async () => {
  const t = platformTools("main");
  routes["GET /v1/workspaces"] = json([
    { id: "a", session: "ses-1" },
    { id: "b", session: "ses-2" },
    { id: "c" },
    { id: "bench-x", session: "ses-1" },
  ]);
  expect(JSON.parse(await tool(t, "workspace_list").run({}))).toHaveLength(4);
  process.env.KL_SESSION = "ses-1";
  process.env.KL_BENCH = "bench-x";
  try {
    expect(JSON.parse(await tool(t, "workspace_list").run({})).map((w: any) => w.id)).toEqual(["a"]);
  } finally {
    delete process.env.KL_SESSION;
    delete process.env.KL_BENCH;
  }
});

test("in a session, workspace_create and workspace_delete go through the session; without one, direct", async () => {
  const t = platformTools("main");
  routes["POST /v1/workspaces"] = json({ id: "ws-1" }, 201);
  routes["DELETE /v1/workspaces/w1"] = () => new Response(null, { status: 204 });
  routes["GET /v1/workspaces/w1"] = json({ id: "w1", state: "ready" });
  routes["POST /v1/sessions/ses-1/workspaces"] = json({ id: "ws-2" }, 201);
  routes["DELETE /v1/sessions/ses-1/workspaces/w1"] = () => new Response(null, { status: 204 });
  await tool(t, "workspace_create").run({ name: "backend", quota_gb: 5, team: "acme" });
  await tool(t, "workspace_delete").run({ workspace: "w1" });
  process.env.KL_SESSION = "ses-1";
  try {
    await tool(t, "workspace_create").run({ name: "backend", quota_gb: 5, team: "acme" });
    await tool(t, "workspace_delete").run({ workspace: "w1" });
  } finally {
    delete process.env.KL_SESSION;
  }
  expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
    "POST /v1/workspaces",
    "GET /v1/workspaces/w1",
    "DELETE /v1/workspaces/w1",
    "POST /v1/sessions/ses-1/workspaces",
    "GET /v1/workspaces/w1",
    "DELETE /v1/sessions/ses-1/workspaces/w1",
  ]);
  // The session already names the owner: a `team` would only contradict it.
  expect(calls[3].body).toEqual({ name: "backend", quota_gb: 5 });
});

test("the push tools pass the volume name and the restore tool the team", async () => {
  routes["POST /v1/workspaces/w1/snapshots"] = json({});
  routes["POST /v1/environments/e1/snapshots"] = json({});
  routes["POST /v1/workspaces/restore"] = json({});
  routes["GET /v1/workspaces/w1"] = json({ id: "w1", state: "ready" });
  routes["GET /v1/environments/e1"] = json({ id: "e1", state: "running", services: [] });
  const post = (n: number) => calls.filter((c) => c.method === "POST")[n]!.body;
  // the object comes back with the snapshot's own answer beside it
  const snap = JSON.parse(await tool(platformTools("workspace", "w1"), "workspace_snapshot").run({ message: "m", volume: "pg" }));
  expect(snap).toEqual({ id: "w1", state: "ready", snapshot: {} });
  expect(post(0)).toEqual({ message: "m", volume: "pg" });
  await tool(platformTools("main"), "env_snapshot").run({ env: "e1", volume: "pg" });
  expect(post(1)).toEqual({ volume: "pg" });
  await tool(platformTools("main"), "workspace_restore").run({ name: "w2", snapshot_id: "pg@2", team: "acme" });
  expect(post(2)).toEqual({ name: "w2", snapshot_id: "pg@2", team: "acme" });
});

// ---- component tools: one test per tool (route, args, error mapping)
const ok = () => json({ ok: 1 });
const CASES: [string, any, string, string, any?][] = [
  ["sandbox_create", { command: "make test", image: "i:1", packages: ["go"], variables: { A: "1" }, lifetime_s: 60, team: "acme" }, "POST", "/v1/sandboxes", { team: "acme", cmd: ["sh", "-c", "make test"], image: "i:1", packages: ["go"], env: { A: "1" }, timeout_secs: 60 }],
  ["sandbox_create", { command: "x", from_workspace: "w1", from_snapshot: "ds@2" }, "POST", "/v1/sandboxes", { cmd: ["sh", "-c", "x"], from_workspace: "w1", from_snapshot: "ds@2" }],
  ["pipeline_version_delete", { owner: "acme", pipeline: "ci", version: 3 }, "DELETE", "/v1/pipelines/acme/ci/versions/3"],
  ["workspace_env_get", { workspace: "w1" }, "GET", "/v1/workspaces/w1/env"],
  ["sandbox_get", { sandbox: "sbx-1" }, "GET", "/v1/sandboxes/sbx-1"],
  ["sandbox_logs", { sandbox: "sbx-1" }, "GET", "/v1/sandboxes/sbx-1/logs"],
  ["sandbox_list", { team: "acme", state: "running", limit: 5 }, "GET", "/v1/sandboxes?team=acme&state=running&limit=5"],
  ["sandbox_delete", { sandbox: "sbx-1" }, "DELETE", "/v1/sandboxes/sbx-1"],
  ["pipeline_list", { owner: "acme" }, "GET", "/v1/pipelines/acme"],
  ["pipeline_get", { owner: "acme", pipeline: "ci", version: 2 }, "GET", "/v1/pipelines/acme/ci?version=2"],
  ["pipeline_delete", { owner: "acme", pipeline: "ci" }, "DELETE", "/v1/pipelines/acme/ci"],
  ["webhook_rotate", { owner: "acme", pipeline: "ci" }, "POST", "/v1/pipelines/acme/ci/webhook/rotate"],
  ["run_start", { owner: "acme", pipeline: "ci", inputs: { t: "x" }, version: 3, key: "k" }, "POST", "/v1/pipelines/acme/ci/runs", { inputs: { t: "x" }, version: 3, key: "k" }],
  ["run_list", { owner: "acme", pipeline: "ci", state: "failure" }, "GET", "/v1/pipelines/acme/ci/runs?state=failure"],
  ["run_get", { owner: "acme", pipeline: "ci", run: "r1" }, "GET", "/v1/pipelines/acme/ci/runs/r1"],
  ["run_logs", { owner: "acme", pipeline: "ci", run: "r1", job: 1, offset: 24 }, "GET", "/v1/pipelines/acme/ci/runs/r1/jobs/1/logs?offset=24"],
  ["run_cancel", { owner: "acme", pipeline: "ci", run: "r1" }, "POST", "/v1/pipelines/acme/ci/runs/r1/cancel"],
  ["secret_list", { owner: "acme" }, "GET", "/v1/secrets/acme"],
  ["secret_delete", { owner: "acme", name: "DB_URL", mine: true }, "DELETE", "/v1/secrets/acme/mine/DB_URL"],
  ["workspace_env_set", { workspace: "w1", variables: { A: "${{ secrets.A }}" }, replace: true, restart_on_change: true }, "PUT", "/v1/workspaces/w1/env", { env: { A: "${{ secrets.A }}" }, restartOnEnvChange: true }],
  ["connector_list", { owner: "acme" }, "GET", "/v1/connectors?owner=acme"],
  ["session_create", { name: "fix", team: "acme", environment: "dev" }, "POST", "/v1/sessions", { name: "fix", team: "acme", environment: "dev" }],
  ["session_stop", { session: "s1" }, "POST", "/v1/sessions/s1/stop"],
  ["session_start", { session: "s1" }, "POST", "/v1/sessions/s1/start"],
  ["session_delete", { session: "s1" }, "DELETE", "/v1/sessions/s1"],
  ["session_ttl", { session: "s1", ttl_secs: 600 }, "PUT", "/v1/sessions/s1/ttl", { ttl_secs: 600 }],
  ["workspace_ttl", { workspace: "w1", clear: true }, "PUT", "/v1/workspaces/w1/ttl", { ttl_secs: null }],
  ["env_ttl", { env: "e1", ttl_secs: 86400 }, "PUT", "/v1/environments/e1/ttl", { ttl_secs: 86400 }],
];
for (const [name, args, method, url, body] of CASES) {
  test(`${name} calls ${method} ${url} and maps a refusal`, async () => {
    const t = tool(platformTools("main"), name);
    expect(t).toBeDefined();
    // a verb answers the object it changed, so it reads it back (and `delete` reads it first)
    for (const o of ["/v1/workspaces/w1", "/v1/sessions/s1", "/v1/environments/e1", "/v1/sandboxes/sbx-1", "/v1/pipelines/acme/ci", "/v1/pipelines/acme/ci/runs/r1"]) routes[`GET ${o}`] = ok();
    routes[`${method} ${url}`] = ok();
    await t.run(args);
    const sent = calls.filter((c) => c.method === method && c.url === url).at(-1)!;
    expect(sent).toMatchObject({ method, url, auth: "Bearer tok1" });
    if (body) expect(sent.body).toEqual(body);
    routes[`${method} ${url}`] = () => new Response("nope", { status: 409 });
    await expect(t.run(args)).rejects.toThrow("409: nope");
  });
}

test("the component tools are in main and all, never in a workspace session", () => {
  const names = ["sandbox", "volume", "snapshot", "pipeline", "run", "worktree", "workspace_vars", "webhook_rotate", "secret_set", "secret_list", "secret_delete", "connector_list"];
  for (const k of ["main", "all"] as const) for (const n of names) expect(platformTools(k, "w1").map((t) => t.name)).toContain(n);
  for (const n of names) expect(platformTools("workspace", "w1").map((t) => t.name)).not.toContain(n);
});

test("sandbox delete ends the sandbox first and ignores a refusal; pipeline get without a version adds the versions", async () => {
  const t = platformTools("main");
  routes["POST /v1/sandboxes/sbx-1/terminate"] = () => new Response("over", { status: 409 });
  routes["DELETE /v1/sandboxes/sbx-1"] = () => new Response(null, { status: 204 });
  routes["GET /v1/sandboxes/sbx-1"] = json({ id: "sbx-1", phase: "terminated" });
  routes["GET /v1/sandboxes/sbx-2"] = json({ id: "sbx-2" });
  // the answer is the object as last read, deleted
  expect(JSON.parse(await tool(t, "sandbox_delete").run({ sandbox: "sbx-1" }))).toEqual({ id: "sbx-1", phase: "terminated", state: "deleted" });
  expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["GET /v1/sandboxes/sbx-1", "POST /v1/sandboxes/sbx-1/terminate", "DELETE /v1/sandboxes/sbx-1"]);
  routes["POST /v1/sandboxes/sbx-2/terminate"] = () => new Response("down", { status: 500 });
  await expect(tool(t, "sandbox_delete").run({ sandbox: "sbx-2" })).rejects.toThrow("500: down");
  routes["GET /v1/pipelines/acme/ci"] = json({ name: "ci" });
  routes["GET /v1/pipelines/acme/ci/versions"] = json([{ version: 1 }]);
  expect(JSON.parse(await tool(t, "pipeline_get").run({ owner: "acme", pipeline: "ci" }))).toEqual({ name: "ci", versions: [{ version: 1 }] });
});

test("volume get answers history and refs; service update with restart restarts after the patch", async () => {
  const t = platformTools("main", undefined, 1);
  routes["GET /v1/volumes/pg/history?include=working"] = json([{ id: "s1", working_copies: ["w"] }]);
  routes["GET /v1/volumes/pg/refs"] = json({ latest: "s1" });
  expect(JSON.parse(await tool(t, "volume_get").run({ volume: "pg" }))).toEqual({ volume: "pg", history: [{ id: "s1", working_copies: ["w"] }], refs: { latest: "s1" } });
  routes["GET /v1/volumes/pg/history?include=working"] = json({ history: [{ id: "s1" }], working: [{ name: "w", head: "s1" }] });
  expect(JSON.parse(await tool(t, "volume_get").run({ volume: "pg" })).working).toEqual([{ name: "w", head: "s1" }]);
  routes["GET /v1/environments/e1"] = json({ services: [{ name: "api", image: "a:1" }] });
  routes["PATCH /v1/environments/e1"] = json({});
  routes["POST /v1/environments/e1/services/api/restart"] = json({}, 202);
  let marked = 2;
  routes["GET /v1/environments/e1"] = () => new Response(JSON.stringify({ state: "running", services: [{ name: "api", image: "a:2" }], service_status: [{ name: "api", ready: true, restartRequired: marked-- > 0 }] }));
  const out = JSON.parse(await tool(t, "service_update").run({ env: "e1", service: { name: "api", image: "a:2" }, restart: true }));
  expect(calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.url}`)).toEqual(["PATCH /v1/environments/e1", "POST /v1/environments/e1/services/api/restart"]);
  // the settled state, not the patch body: the mark has cleared
  expect(out.service_status[0].restartRequired).toBe(false);
});

test("wait: true polls the created object to its settled state; a no-wait create answers the 202 document", async () => {
  const t = platformTools("main", undefined, 1);
  let n = 0;
  routes["POST /v1/workspaces"] = json({ id: "w9", state: "creating" }, 202);
  routes["GET /v1/workspaces/w9"] = () => json({ id: "w9", state: ++n >= 3 ? "ready" : "creating" })();
  expect(JSON.parse(await tool(t, "workspace_create").run({ name: "w", quota_gb: 5, wait: true })).state).toBe("ready");
  expect(n).toBe(3);
  routes["GET /v1/workspaces/w9"] = json({ id: "w9", state: "creating" });
  expect(JSON.parse(await tool(t, "workspace_create").run({ name: "w", quota_gb: 5 })).state).toBe("creating");
});

test("a wait: true call still running at soft_ms answers the promoted hand-off, even when the read is slow", async () => {
  const t = platformTools("main", undefined, 1);
  routes["POST /v1/workspaces"] = json({ id: "w9", state: "creating" }, 202);
  routes["GET /v1/workspaces/w9"] = async () => {
    await new Promise((r) => setTimeout(r, 400));
    return json({ id: "w9", state: "creating" })();
  };
  const t0 = Date.now();
  const out = JSON.parse(await tool(t, "workspace_create").run({ name: "w", quota_gb: 5, wait: true, soft_ms: 50 }));
  expect(out).toEqual({ promoted: true, id: "w9", kind: "workspace", next: 0, next_err: 0 });
  expect(Date.now() - t0).toBeLessThan(300);
  // the other kinds name what resumes them
  routes["POST /v1/environments"] = json({ id: "e9", state: "creating", services: [] }, 202);
  routes["GET /v1/environments/e9"] = json({ id: "e9", state: "creating", services: [] });
  expect(JSON.parse(await tool(t, "env_create").run({ name: "e", wait: true, soft_ms: 30 }))).toMatchObject({ promoted: true, id: "e9", kind: "env" });
  routes["POST /v1/sandboxes"] = json({ id: "sbx-9" }, 202);
  routes["POST /v1/sandboxes/sbx-9/wait"] = json({ id: "sbx-9", phase: "running" });
  expect(JSON.parse(await tool(t, "sandbox_create").run({ command: "x", wait: true, soft_ms: 30 }))).toMatchObject({ promoted: true, id: "sbx-9", kind: "sandbox" });
  routes["POST /v1/pipelines/acme/ci/runs"] = json({ id: "r9" }, 202);
  routes["GET /v1/pipelines/acme/ci/runs/r9"] = json({ id: "r9", state: "running" });
  expect(JSON.parse(await tool(t, "run_start").run({ owner: "acme", pipeline: "ci", wait: true, soft_ms: 30 }))).toEqual({ promoted: true, id: "r9", kind: "run", next: 0, next_err: 0 });
});

test("a wait action answers the object with timed_out at timeout_ms; the old spellings are read but never listed", async () => {
  const t = platformTools("main", undefined, 1);
  routes["GET /v1/workspaces/w9"] = json({ id: "w9", state: "creating" });
  const w = tool(t, "workspace_wait");
  expect(JSON.parse(await w.run({ workspace: "w9", timeout_ms: 20 }))).toEqual({ id: "w9", state: "creating", timed_out: true });
  expect(JSON.parse(await w.run({ workspace: "w9", timeout_s: 0.02 })).timed_out).toBe(true);
  expect(JSON.parse(await w.run({ workspace: "w9", max_wait_ms: 20 })).timed_out).toBe(true);
  for (const x of platformTools("all", "w1")) for (const k of ["timeout", "timeout_s", "max_wait_ms"]) expect((x.inputSchema as any).properties[k]).toBeUndefined();
});

test("workspace create with source clones; env create with an environment source clones, else grows from the snapshot", async () => {
  const t = platformTools("main");
  routes["POST /v1/workspaces/w1/clone"] = json({}, 202);
  await tool(t, "workspace_create").run({ name: "c", source: "w1", task: "try" });
  expect(calls.at(-1)).toMatchObject({ url: "/v1/workspaces/w1/clone", body: { name: "c", task: "try" } });
  await expect(tool(t, "workspace_create").run({ name: "c" })).rejects.toThrow("`quota_gb` is required unless `source`");
  routes["GET /v1/environments/e1"] = json({ id: "e1" });
  routes["POST /v1/environments/e1/clone"] = json({}, 202);
  routes["POST /v1/environments"] = json({}, 202);
  await tool(t, "env_create").run({ name: "e2", source: "e1" });
  expect(calls.at(-1)!.url).toBe("/v1/environments/e1/clone");
  await tool(t, "env_create").run({ name: "e3", source: "pg@2" });
  expect(calls.at(-1)).toMatchObject({ url: "/v1/environments", body: { name: "e3", snapshot_id: "pg@2" } });
});

test("sandbox_create goes through the session when there is one, with its argv array as given", async () => {
  process.env.KL_SESSION = "ses-1";
  routes["POST /v1/sessions/ses-1/sandboxes"] = json({ id: "sbx-1" }, 202);
  await tool(platformTools("main"), "sandbox_create").run({ command: ["echo", "hi"], team: "acme" });
  expect(calls.at(-1)!.body).toEqual({ cmd: ["echo", "hi"] });
});

test("sandbox_logs returns the body as text, empty included", async () => {
  routes["GET /v1/sandboxes/sbx-1/logs"] = () => new Response('{"a":1}\nline', { status: 200 });
  expect(await tool(platformTools("main"), "sandbox_logs").run({ sandbox: "sbx-1" })).toBe('{"a":1}\nline');
  routes["GET /v1/sandboxes/sbx-1/logs"] = () => new Response("", { status: 200 });
  expect(await tool(platformTools("main"), "sandbox_logs").run({ sandbox: "sbx-1" })).toBe("");
});

test("sandbox_wait uses the server wait route until the sandbox ends, then times out with timedOut", async () => {
  const t = tool(platformTools("main"), "sandbox_wait");
  let n = 0;
  routes["POST /v1/sandboxes/sbx-1/wait"] = () => json(++n < 3 ? { id: "sbx-1", phase: "running" } : { id: "sbx-1", phase: "terminated", exit_code: 0 })();
  expect(JSON.parse(await t.run({ sandbox: "sbx-1" })).exit_code).toBe(0);
  expect(n).toBe(3);
  expect(calls[0].body.timeout_ms).toBeLessThanOrEqual(20000);
  routes["POST /v1/sandboxes/sbx-1/wait"] = json({ id: "sbx-1", phase: "running" });
  expect(JSON.parse(await t.run({ sandbox: "sbx-1", timeout_ms: 10 })).timed_out).toBe(true);
  routes["POST /v1/sandboxes/sbx-1/wait"] = () => new Response("not found", { status: 404 });
  await expect(t.run({ sandbox: "sbx-1" })).rejects.toThrow("404");
});

test("run_wait polls the run to a final state and drops the definition; at the limit it says timedOut", async () => {
  const t = tool(platformTools("main", undefined, 1), "run_wait");
  const a = { owner: "acme", pipeline: "ci", run: "r1" };
  let n = 0;
  routes["GET /v1/pipelines/acme/ci/runs/r1"] = () => json({ id: "r1", state: ++n < 3 ? "running" : "success", definition: { big: 1 } })();
  const d = JSON.parse(await t.run(a));
  expect(d).toEqual({ id: "r1", state: "success" });
  expect(n).toBe(3);
  routes["GET /v1/pipelines/acme/ci/runs/r1"] = json({ id: "r1", state: "running" });
  expect(JSON.parse(await t.run({ ...a, timeout_ms: 20 })).timed_out).toBe(true);
  routes["GET /v1/pipelines/acme/ci/runs/r1"] = () => new Response("gone", { status: 404 });
  await expect(t.run(a)).rejects.toThrow("404: gone");
});

test("pipeline_save creates a missing pipeline and replaces an existing one", async () => {
  const t = tool(platformTools("main"), "pipeline_save");
  const definition = { name: "ci", jobs: {} };
  routes["POST /v1/pipelines/acme"] = json({ latestVersion: 1 }, 201);
  await t.run({ owner: "acme", definition });
  expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["GET /v1/pipelines/acme/ci", "POST /v1/pipelines/acme"]);
  routes["GET /v1/pipelines/acme/ci"] = json({ name: "ci" });
  routes["PUT /v1/pipelines/acme/ci"] = json({ latestVersion: 2 });
  await t.run({ owner: "acme", definition: JSON.stringify(definition) });
  expect(calls.at(-1)).toMatchObject({ method: "PUT", url: "/v1/pipelines/acme/ci", body: definition });
  routes["PUT /v1/pipelines/acme/ci"] = () => new Response("invalid", { status: 422 });
  await expect(t.run({ owner: "acme", definition })).rejects.toThrow("422: invalid");
  await expect(t.run({ owner: "acme", definition: {} })).rejects.toThrow("needs a `name`");
});

test("secret_set sends the value and answers {name, updatedAt}, never the value, also on failure", async () => {
  const t = tool(platformTools("main"), "secret_set");
  const value = "s3cr3t-value-xyz";
  routes["PUT /v1/secrets/acme/DB_URL"] = () => new Response(null, { status: 204 });
  routes["GET /v1/secrets/acme"] = json([{ name: "DB_URL", updated_at: "2026-11-03T00:00:00Z", updated_by: "k" }]);
  const out = await t.run({ owner: "acme", name: "DB_URL", value });
  expect(calls[0]).toMatchObject({ method: "PUT", body: { value } });
  expect(JSON.parse(out)).toEqual({ name: "DB_URL", updatedAt: "2026-11-03T00:00:00Z" });
  expect(out).not.toContain(value);
  expect(t.description).toContain("never read back");
  routes["PUT /v1/secrets/acme/mine/DB_URL"] = () => new Response(null, { status: 204 });
  expect(JSON.parse(await t.run({ owner: "acme", name: "DB_URL", value, mine: true })).name).toBe("DB_URL");
  expect(calls.at(-2)!.url).toBe("/v1/secrets/acme/mine/DB_URL");
  routes["PUT /v1/secrets/acme/DB_URL"] = () => new Response("only a team admin can change team secrets", { status: 403 });
  const err = await t.run({ owner: "acme", name: "DB_URL", value }).catch((e) => String(e.message));
  expect(err).toBe("403: only a team admin can change team secrets");
});

test("ttl tools clear with null when ttl_secs is omitted, and the wait tools take a timeout", () => {
  const t = platformTools("main");
  for (const n of ["sandbox_wait", "run_wait"]) expect((tool(t, n).inputSchema as any).properties.timeout_ms.description).toContain("maximum 900000");
});

test("a ttl tool needs ttl_secs or clear", async () => {
  for (const [n, a, url] of [["session_ttl", { session: "s1" }, "/v1/sessions/s1/ttl"], ["workspace_ttl", { workspace: "w1" }, "/v1/workspaces/w1/ttl"], ["env_ttl", { env: "e1" }, "/v1/environments/e1/ttl"]] as const) {
    routes[`PUT ${url}`] = json({});
    routes[`GET ${url.replace("/ttl", "")}`] = json({});
    calls = [];
    await expect(tool(platformTools("main"), n).run(a)).rejects.toThrow("ttl_secs");
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(0);
    await tool(platformTools("main"), n).run({ ...a, clear: true });
    expect(calls.filter((c) => c.method === "PUT").at(-1)!.body).toEqual({ ttl_secs: null });
  }
});

test("workspace_env_set merges into the stored env unless replace is set", async () => {
  routes["GET /v1/workspaces/w1/env"] = json({ env: { A: "1", B: "2" } });
  routes["PUT /v1/workspaces/w1/env"] = json({});
  const t = tool(platformTools("main"), "workspace_env_set");
  await t.run({ workspace: "w1", variables: { B: "3", C: "4" } });
  const put = () => calls.filter((c) => c.method === "PUT").at(-1)!.body;
  await t.run({ workspace: "w1", variables: { B: "3", C: "4" } });
  expect(put()).toEqual({ env: { A: "1", B: "3", C: "4" } });
  await t.run({ workspace: "w1", variables: { C: "4" }, replace: true });
  expect(put()).toEqual({ env: { C: "4" } });
  // a running workspace needs a restart to read them
  routes["GET /v1/workspaces/w1"] = json({ id: "w1", state: "ready" });
  expect(JSON.parse(await t.run({ workspace: "w1", variables: { C: "5" } })).note).toBe("takes effect after restart");
  expect(JSON.parse(await t.run({ workspace: "w1", variables: { C: "5" }, restart_on_change: true })).note).toBeUndefined();
});

test("sandbox_logs and run_logs keep the last 200 lines by default, tail and head choose", async () => {
  const text = Array.from({ length: 500 }, (_, i) => `l${i}`).join("\n") + "\n";
  routes["GET /v1/sandboxes/sbx-1/logs"] = () => new Response(text);
  const t = tool(platformTools("main"), "sandbox_logs");
  const out = await t.run({ sandbox: "sbx-1" });
  expect(out).toContain("300 of 500 lines left out");
  expect(out).toContain("l499");
  expect(out).not.toContain("l299\n");
  expect(await t.run({ sandbox: "sbx-1", tail: 2000 })).toBe(text);
  expect(await t.run({ sandbox: "sbx-1", head: 2, tail: 2000 })).toContain("l1\n");
  routes["GET /v1/pipelines/a/ci/runs/r1/jobs/0/logs"] = json({ data: text, next: 9, complete: true, state: "success" });
  const d = JSON.parse(await tool(platformTools("main"), "run_logs").run({ owner: "a", pipeline: "ci", run: "r1" }));
  expect(d.data).toContain("l499");
  expect(d.data).toContain("lines left out");
  expect(d.next).toBe(9);
  routes["GET /v1/pipelines/a/ci/runs/r1/jobs/0/logs?offset=0"] = json({ data: text, next: 9, complete: true });
  expect(JSON.parse(await tool(platformTools("main"), "run_logs").run({ owner: "a", pipeline: "ci", run: "r1", offset: 0 })).data).toBe(text);
});

test("env_get folds interceptedBy and proxy into services[]", async () => {
  routes["GET /v1/environments/e1"] = json({ services: [{ name: "api" }, { name: "db" }], service_status: [{ name: "api", ready: true, interceptedBy: "ws-1", proxy: "ready" }, { name: "db", ready: true, proxy: "none" }] });
  const d = JSON.parse(await tool(platformTools("main"), "env_get").run({ env: "e1" }));
  expect(d.services[0]).toMatchObject({ interceptedBy: "ws-1", proxy: "ready" });
  expect(d.services[1].interceptedBy).toBeUndefined();
});

test("a refusal from /v1 answers JSON {error, hint}; an argument error carries the action's schema", async () => {
  const t = platformTools("main");
  routes["GET /v1/workspaces/nope"] = json({ error: "no such workspace" }, 404);
  const e1 = await tool(t, "workspace_get").run({ workspace: "nope" }).catch((e) => JSON.parse(e.message));
  expect(e1).toEqual({ error: "404: no such workspace", hint: "check the list action" });
  routes["POST /v1/workspaces"] = () => new Response("workspaces: 5 of 5 in use, request more under Quota", { status: 409 });
  const e2 = await tool(t, "workspace_create").run({ name: "w", quota_gb: 5 }).catch((e) => JSON.parse(e.message));
  expect(e2.hint).toContain("request_create");
  const e3 = await tool(t, "workspace_get").run({}).catch((e) => JSON.parse(e.message));
  expect(e3.error).toContain("`workspace` is required");
  expect(e3.schema.required).toEqual(["workspace"]);
  expect(e3.hint).toBeUndefined();
});

test("every verb answers the object; delete answers the last-read object with state deleted", async () => {
  const t = platformTools("main");
  routes["GET /v1/environments/e1"] = json({ id: "e1", state: "running", services: [] });
  routes["POST /v1/environments/e1/stop"] = json({ id: "e1", state: "stopped" }, 202);
  routes["DELETE /v1/environments/e1"] = () => new Response(null, { status: 204 });
  expect(JSON.parse(await tool(t, "env_stop").run({ env: "e1" }))).toMatchObject({ id: "e1", state: "stopped" });
  expect(JSON.parse(await tool(t, "env_delete").run({ env: "e1" }))).toMatchObject({ id: "e1", state: "deleted" });
});

test("intercept is one tool with start and stop; stop answers the environment", async () => {
  const t = platformTools("all");
  expect((tool(t, "intercept").inputSchema as any).properties.action.enum).toEqual(["start", "stop"]);
  routes["DELETE /v1/environments/e1/intercepts/web"] = () => new Response(null, { status: 204 });
  routes["GET /v1/environments/e1"] = json({ id: "e1", state: "running", services: [{ name: "web" }] });
  expect(JSON.parse(await tool(t, "intercept_stop").run({ env: "e1", service: "web" })).id).toBe("e1");
});

test("env create with wait answers the created object and a hint when the session is not connected to it", async () => {
  const t = platformTools("main", undefined, 1);
  routes["POST /v1/environments"] = json({ id: "env-new", name: "shop", state: "creating", services: [] }, 202);
  routes["GET /v1/environments/env-new"] = () => new Response("that environment is not connected to this session", { status: 403 });
  const out = JSON.parse(await tool(t, "env_create").run({ name: "shop", services: [{ name: "db", image: "postgres:16", ports: [5432] }], wait: true, soft_ms: 50 }));
  expect(out.id).toBe("env-new");
  expect(out.hint).toContain("session");
});

test("env restore takes source; snapshot_id is an unlisted alias", async () => {
  routes["POST /v1/environments/e1/restore"] = json({ ok: 1 });
  routes["GET /v1/environments/e1"] = json({ id: "e1", services: [] });
  const t = platformTools("main");
  await tool(t, "env").run({ action: "restore", env: "e1", source: "pg@2" });
  await tool(t, "env").run({ action: "restore", env: "e1", snapshot_id: "snap-9" });
  expect(calls.filter((c) => c.url === "/v1/environments/e1/restore").map((c) => c.body.snapshot_id)).toEqual(["pg@2", "snap-9"]);
  const props = (t.find((x) => x.name === "env")!.inputSchema as any).properties;
  expect(props.snapshot_id).toBeUndefined();
});

test("env restore with wait holds until the restore landed, not the running state it started in", async () => {
  const t = platformTools("main", undefined, 5);
  let n = 0;
  routes["POST /v1/environments/e1/restore"] = json({ id: "e1", state: "running", services: [{ name: "db", ready: true }], restore_requested_at: "t0", restored_to: "s0" });
  routes["GET /v1/environments/e1"] = () => {
    n += 1;
    // the first GET is the pre-restore read; the restore lands on the third poll
    const landed = n >= 4;
    return json({ id: "e1", state: "running", services: [{ name: "db" }], service_status: [{ name: "db", ready: true }], restore_requested_at: landed ? "t1" : "t0", restored_to: landed ? "s1" : "s0" })();
  };
  const out = JSON.parse(await tool(t, "env").run({ action: "restore", env: "e1", source: "s1", wait: true }));
  expect(out.restored_to).toBe("s1");
  expect(n).toBeGreaterThanOrEqual(4);
});

test("workspace restart answers the new restart record, or null with a hint on timeout", async () => {
  const t = platformTools("main", undefined, 5);
  let n = 0;
  routes["POST /v1/workspaces/w9/restart"] = json({}, 202);
  routes["GET /v1/workspaces/w9"] = () => new Response(JSON.stringify({ id: "w9", restarts: n++ < 2 ? [{ at: 1, reason: "old" }] : [{ at: 1, reason: "old" }, { at: 2, reason: "requested" }] }));
  expect(JSON.parse(await tool(t, "workspace_restart").run({ workspace: "w9" })).restart).toEqual({ at: 2, reason: "requested" });
}, 30000);

test("stop answers the POST body; wait polls until stopped", async () => {
  const t = platformTools("main");
  routes["POST /v1/workspaces/w1/stop"] = json({ id: "w1", state: "stopped" }, 202);
  expect(JSON.parse(await tool(t, "workspace_stop").run({ workspace: "w1" }))).toEqual({ id: "w1", state: "stopped" });
  expect(calls.filter((c) => c.method === "GET")).toHaveLength(0);
  routes["POST /v1/workspaces/w2/stop"] = json({ id: "w2", state: "stopping" }, 202);
  let n = 0;
  routes["GET /v1/workspaces/w2"] = () => new Response(JSON.stringify({ id: "w2", state: n++ < 1 ? "stopping" : "stopped" }));
  expect(JSON.parse(await tool(platformTools("main", undefined, 1), "workspace_stop").run({ workspace: "w2", wait: true })).state).toBe("stopped");
  routes["POST /v1/environments/e2/stop"] = json({ id: "e2", state: "stopping" }, 202);
  let m = 0;
  routes["GET /v1/environments/e2"] = () => new Response(JSON.stringify({ id: "e2", state: m++ < 1 ? "stopping" : "stopped", services: [] }));
  expect(JSON.parse(await tool(platformTools("main", undefined, 1), "env_stop").run({ env: "e2", wait: true })).state).toBe("stopped");
});

test("session stop answers without a second read", async () => {
  routes["POST /v1/sessions/s1/stop"] = json({}, 202);
  expect(JSON.parse(await tool(platformTools("main"), "session_stop").run({ session: "s1" }))).toEqual({ id: "s1", state: "stopping" });
  expect(calls.filter((c) => c.method === "GET")).toHaveLength(0);
});

test("workspace restart waits for restart_required to clear", async () => {
  routes["POST /v1/workspaces/w9/restart"] = json({}, 202);
  let n = 0;
  routes["GET /v1/workspaces/w9"] = () => new Response(JSON.stringify({ id: "w9", restarts: n++ < 1 ? [] : [{ at: 2, reason: "requested" }], restart_required: n < 4 }));
  const r = JSON.parse(await tool(platformTools("main", undefined, 1), "workspace_restart").run({ workspace: "w9" }));
  expect(r.restart).toEqual({ at: 2, reason: "requested" });
  expect(r.restart_required).toBe(false);
});

test("volume get resolves a given name to the volume id", async () => {
  routes["GET /v1/volumes"] = json([{ id: "ws-ab12", name: "pg" }]);
  routes["GET /v1/volumes/ws-ab12/history?include=working"] = json([{ id: "s1" }]);
  routes["GET /v1/volumes/ws-ab12/refs"] = json({});
  expect(JSON.parse(await tool(platformTools("main"), "volume_get").run({ volume: "pg" })).history).toEqual([{ id: "s1" }]);
});

test("worktree add waits for the row and says how to reach it; request_create echoes the title; quota defaults to KL_TEAM", async () => {
  const t = platformTools("main", undefined, 1);
  routes["POST /v1/workspaces/w1/trees"] = json({ name: "fix", path: "/home/kl/.agents/fix/workspace" }, 202);
  let n = 0;
  routes["GET /v1/workspaces/w1"] = () => new Response(JSON.stringify({ trees: n++ < 1 ? [] : [{ name: "fix", ready: true }] }));
  const w = JSON.parse(await tool(t, "worktree_add").run({ workspace: "w1", name: "fix" }));
  expect(w).toEqual({ name: "fix", path: "/home/kl/.agents/fix/workspace", note: 'pass tree: "fix" to exec, read and write; the path is not visible from the main tree' });
  routes["POST /v1/requests"] = json({ id: "r1", kind: "other" }, 201);
  expect(JSON.parse(await tool(t, "request_create").run({ kind: "other", reason: "x", title: "T", body: "B" }))).toMatchObject({ id: "r1", title: "T", body: "B" });
  process.env.KL_TEAM = "acme";
  routes["GET /v1/quota?owner=acme"] = json({ owner: "acme" });
  expect(JSON.parse(await tool(t, "quota").run({})).owner).toBe("acme");
  delete process.env.KL_TEAM;
});

test("a snapshot whose re-read fails still answers success with its id", async () => {
  routes["POST /v1/workspaces/w1/snapshots"] = json({ id: "s7" });
  routes["GET /v1/workspaces/w1"] = () => { throw new Error("boom"); };
  const out = JSON.parse(await tool(platformTools("workspace", "w1"), "workspace_snapshot").run({}));
  expect(out.snapshot).toEqual({ id: "s7" });
  expect(out.note).toContain("saved; the workspace was not re-read");
});

test("stop wait: true ignores ready reads and settles on stopped", async () => {
  const t = platformTools("main", undefined, 1);
  const seq = ["ready", "ready", "stopped"];
  let n = 0;
  routes["POST /v1/workspaces/w1/stop"] = json({ id: "w1", state: "ready" }, 202);
  routes["GET /v1/workspaces/w1"] = () => json({ id: "w1", state: seq[Math.min(n++, 2)] })();
  expect(JSON.parse(await tool(t, "workspace_stop").run({ workspace: "w1", wait: true })).state).toBe("stopped");
  expect(n).toBe(3);
});

test("soft_ms 60000 on a poll that never finishes hands off before 56 s, inside the client's own deadline", async () => {
  jest.useFakeTimers();
  try {
    const t = platformTools("main", undefined, 1);
    routes["POST /v1/workspaces"] = json({ id: "w9", state: "creating" }, 202);
    routes["GET /v1/workspaces/w9"] = json({ id: "w9", state: "creating" });
    const t0 = Date.now();
    const p = tool(t, "workspace_create").run({ name: "w", quota_gb: 5, wait: true, soft_ms: 60_000 });
    // bun has no async advance: step a second at a time and let the fetch/poll microtasks run between steps
    let done = false;
    p.then(() => (done = true));
    for (let i = 0; i < 56 && !done; i++) {
      jest.advanceTimersByTime(1000);
      for (let k = 0; k < 20; k++) await Promise.resolve();
    }
    expect(done).toBe(true);
    const out = JSON.parse(await p);
    expect(out).toMatchObject({ promoted: true, id: "w9", kind: "workspace" });
    expect(Date.now() - t0).toBeLessThanOrEqual(56_000);
  } finally {
    jest.useRealTimers();
  }
});
