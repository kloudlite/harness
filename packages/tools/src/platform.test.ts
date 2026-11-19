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
  process.env.KD_API_URL = "http://api.test";
  process.env.KD_TOOL_KEY_FILE = tokenFile;
  delete process.env.KD_DESK;
  globalThis.fetch = (async (url: string, init: any = {}) => {
    const u = String(url).replace("http://api.test", "");
    calls.push({ method: init.method ?? "GET", url: u, auth: init.headers?.authorization ?? null, body: init.body ? JSON.parse(init.body) : undefined });
    const r = routes[`${init.method ?? "GET"} ${u}`];
    return r ? await r() : new Response("not found", { status: 404 });
  }) as any;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.KD_API_URL;
  delete process.env.KD_TOOL_KEY_FILE;
  delete process.env.KD_DESK;
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
    desk_connect: (i) => ({ action: "connect", environment: i.environment }),
    desk_disconnect: () => ({ action: "connect", environment: null }),
    workspace_fork_live: ({ workspace, ...i }) => ({ action: "fork", source: workspace, ...i }),
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
  delete process.env.KD_API_URL;
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

test("the workspace slice is what a workspace token reaches, folded; main keeps today's subset and all adds the workspace-only tools", async () => {
  const slice = platformTools("workspace", "w1");
  expect(slice.map((x) => x.name)).toEqual(["workspace", "env", "desk", "service", "packages", "intercept"]);
  const actions = (t: ReturnType<typeof platformTools>, n: string) => (tool(t, n).inputSchema as any).properties.action.enum;
  expect(actions(slice, "workspace")).toEqual(["stop", "snapshot"]);
  expect(actions(slice, "env")).toEqual(["get", "wait"]);
  expect(actions(slice, "desk")).toEqual(["list"]);
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

test("the workspace slice defaults env through the workspace's desk", async () => {
  const t = platformTools("workspace", "w1");
  routes["GET /v1/workspaces/w1"] = json({ team: "acme", desk: "desk-1", environment: "e9", packages: [] });
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
  // in a desk whose environment is not resolved, or in none
  routes["GET /v1/workspaces/w1"] = json({ desk: "desk-1", packages: [] });
  await expect(tool(t, "env_get").run({})).rejects.toThrow("this workspace's desk has no environment");
  routes["GET /v1/workspaces/w1"] = json({ packages: [] });
  await expect(tool(t, "env_get").run({})).rejects.toThrow("this workspace is in no desk");
  expect(t.some((x) => x.name === "workspace_create")).toBe(false);
});

test("the bench offers desk list, create and connect: a bench belongs to its desk and never joins another", () => {
  for (const kind of ["main", "all"] as const) {
    const e = (tool(platformTools(kind, "w1"), "desk").inputSchema as any).properties.action.enum;
    expect(e).toEqual(expect.arrayContaining(["list", "create", "connect"]));
    expect(e).not.toContain("use");
    expect(e).not.toContain("current");
  }
  expect((tool(platformTools("workspace", "w1"), "desk").inputSchema as any).properties.action.enum).toEqual(["list"]);
});

test("desk_list in a workspace shows its own desk and environment", async () => {
  routes["GET /v1/workspaces/w1"] = json({ desk: "desk-1", environment: "e9" });
  expect(JSON.parse(await tool(platformTools("workspace", "w1"), "desk_list").run({}))).toEqual({ desk: "desk-1", environment: "e9" });
});

test("desk connect sets or clears an environment (null disconnects); desk defaults to the thread's own", async () => {
  const t = platformTools("main");
  delete process.env.KD_DESK;
  expect(await tool(t, "desk_connect").run({ environment: "e2" })).toContain("no desk");
  process.env.KD_DESK = "desk-1";
  routes["GET /v1/desks/desk-1"] = json({ id: "desk-1", name: "main", environment: "e2" });
  routes["PUT /v1/desks/desk-1/environment"] = json({ id: "desk-1", name: "main", environment: "e2" });
  expect(JSON.parse(await tool(t, "desk_connect").run({ environment: "e2" }))).toEqual({ id: "desk-1", name: "main", environment: "e2" });
  expect(calls.filter((c) => c.method === "PUT").at(-1)!.body).toEqual({ environment: "e2" });
  routes["PUT /v1/desks/desk-1/environment"] = json({ id: "desk-1", name: "main", environment: null });
  routes["GET /v1/desks/desk-1"] = json({ id: "desk-1", name: "main", environment: null });
  expect(JSON.parse(await tool(t, "desk_connect").run({ environment: null }))).toEqual({ id: "desk-1", name: "main", environment: null });
  expect(calls.filter((c) => c.method === "PUT").at(-1)!.body).toEqual({ environment: null });
  // an explicit desk wins over KD_DESK
  routes["PUT /v1/desks/other/environment"] = json({});
  routes["GET /v1/desks/other"] = json({ id: "other", name: "other", environment: "e3" });
  expect(JSON.parse(await tool(t, "desk").run({ action: "connect", desk: "other", environment: "e3" })).id).toBe("other");
  routes["PUT /v1/desks/desk-1/environment"] = json({ error: "no such desk" }, 404);
  expect(await tool(t, "desk_connect").run({ environment: "e2" })).toContain("ended");
});

test("env_get folds service_status readiness into services[]; a live workspace fork sends task only when given", async () => {
  const t = platformTools("main");
  routes["GET /v1/environments/e1"] = json({ services: [{ name: "a" }, { name: "b" }], service_status: [{ name: "a", ready: true }, { name: "b", ready: false, message: "pulling" }] });
  const out = JSON.parse(await tool(t, "env_get").run({ env: "e1" }));
  expect(out.services).toEqual([{ name: "a", ready: true }, { name: "b", ready: false, message: "pulling" }]);
  expect(out.service_status.length).toBe(2);
  routes["POST /v1/workspaces/w1/clone"] = json({}, 202);
  await tool(t, "workspace_fork_live").run({ workspace: "w1", name: "c" });
  expect(calls.at(-1)!.body).toEqual({ name: "c" });
  await tool(t, "workspace_fork_live").run({ workspace: "w1", name: "c", task: "try x" });
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

test("service_logs reads the api route, defaulting env in the workspace slice", async () => {
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
  // workspace: env defaults through the workspace's desk
  const t = platformTools("workspace", "w1");
  routes["GET /v1/workspaces/w1"] = json({ team: "acme", desk: "desk-1", environment: "e9", packages: [] });
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

test("workspace_list keeps only the bench's desk when KD_DESK is set", async () => {
  const t = platformTools("main");
  routes["GET /v1/workspaces"] = json([
    { id: "a", desk: "desk-1" },
    { id: "b", desk: "desk-2" },
    { id: "c" },
    { id: "bench-x", desk: "desk-1" },
  ]);
  expect(JSON.parse(await tool(t, "workspace_list").run({}))).toHaveLength(4);
  process.env.KD_DESK = "desk-1";
  process.env.KD_BENCH = "bench-x";
  try {
    expect(JSON.parse(await tool(t, "workspace_list").run({})).map((w: any) => w.id)).toEqual(["a"]);
  } finally {
    delete process.env.KD_DESK;
    delete process.env.KD_BENCH;
  }
});

test("in a desk, workspace_create and workspace_delete go through the desk; without one, direct", async () => {
  const t = platformTools("main");
  routes["POST /v1/workspaces"] = json({ id: "ws-1" }, 201);
  routes["DELETE /v1/workspaces/w1"] = () => new Response(null, { status: 204 });
  routes["GET /v1/workspaces/w1"] = json({ id: "w1", state: "ready" });
  routes["POST /v1/desks/desk-1/workspaces"] = json({ id: "ws-2" }, 201);
  routes["DELETE /v1/desks/desk-1/workspaces/w1"] = () => new Response(null, { status: 204 });
  await tool(t, "workspace_create").run({ name: "backend", team: "acme" });
  await tool(t, "workspace_delete").run({ workspace: "w1", skip_snapshot: true });
  process.env.KD_DESK = "desk-1";
  try {
    await tool(t, "workspace_create").run({ name: "backend", team: "acme" });
    await tool(t, "workspace_delete").run({ workspace: "w1", skip_snapshot: true });
  } finally {
    delete process.env.KD_DESK;
  }
  expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
    "POST /v1/workspaces",
    "GET /v1/workspaces/w1",
    "DELETE /v1/workspaces/w1",
    "POST /v1/desks/desk-1/workspaces",
    "GET /v1/workspaces/w1",
    "DELETE /v1/desks/desk-1/workspaces/w1",
  ]);
  // The desk already names the owner: a `team` would only contradict it.
  expect(calls[3].body).toEqual({ name: "backend" });
});

test("workspace delete saves only with save: true (onto the checked-out branch or `branch`), and deletes nothing it could not save", async () => {
  const t = tool(platformTools("main"), "workspace");
  const del = (extra: any = {}) => t.run({ action: "delete", workspace: "w1", ...extra });
  const deletes = () => calls.filter((c) => c.method === "DELETE").length;
  const posts = () => calls.filter((c) => c.method === "POST");
  routes["GET /v1/workspaces/w1"] = json({ id: "w1", name: "shop", volume: "vol-1", branch: "base" });
  routes["GET /v1/volumes"] = json([{ id: "vol-1", name: "shop", branches: { base: 2 } }]);
  routes["GET /v1/volumes/vol-1/history"] = json([]);
  routes["DELETE /v1/workspaces/w1"] = () => new Response(null, { status: 204 });
  routes["POST /v1/workspaces/w1/snapshots"] = json({ id: "s3", phase: "ready", volume: "vol-1", name: "shop", version: 3, branch: "base" }, 202);
  // the default: no snapshot (this workspace has no base commit, so nothing to compare)
  expect(JSON.parse(await del()).saved).toBe("nothing: delete takes a snapshot only with `save: true`");
  expect(posts()).toEqual([]);
  expect(deletes()).toBe(1);
  // save: a plain push (no `branch`), which advances the checkout, then the delete
  const out = JSON.parse(await del({ save: true }));
  expect(posts().map((c) => c.body)).toEqual([{ message: "before delete of shop" }]);
  expect(out.saved).toBe('base is now v3 (was v2) of volume shop; the next session forks it with snapshot_id "shop@base"');
  expect(deletes()).toBe(2);
  // `branch` saves elsewhere, and implies save
  routes["POST /v1/workspaces/w1/snapshots"] = json({ id: "s4", phase: "ready", volume: "vol-1", name: "shop", version: 4, branch: "deps" }, 202);
  expect(JSON.parse(await del({ branch: "deps" })).saved).toStartWith("deps is now v4 of volume shop");
  expect(posts().at(-1)!.body).toEqual({ message: "before delete of shop", branch: "deps" });
  // a moved branch: detached, said plainly with the one call that fixes it, still deleted once ready
  routes["POST /v1/workspaces/w1/snapshots"] = json({ id: "s6", phase: "ready", volume: "vol-1", name: "shop", version: 6, branch: null, detached: "branch base moved to v5 since this workspace was made from v2" }, 202);
  const moved = JSON.parse(await del({ save: true })).saved;
  expect(moved).toStartWith("branch base moved to v5 since this workspace was made from v2, so v6 of volume shop is detached, NOT on base");
  expect(moved).toEndWith('volume branch (volume "shop", branch "base", version 6)');
  expect(deletes()).toBe(4);
  // skip_snapshot: nothing saved; with a place to save it is refused; message without save is refused
  const n = posts().length;
  expect(JSON.parse(await del({ skip_snapshot: true })).saved).toBe("nothing (skip_snapshot)");
  await expect(del({ skip_snapshot: true, branch: "x" })).rejects.toThrow("saves nothing");
  await expect(del({ skip_snapshot: true, save: true })).rejects.toThrow("saves nothing");
  await expect(del({ message: "m" })).rejects.toThrow("describe a save");
  // a failed snapshot deletes nothing
  routes["POST /v1/workspaces/w1/snapshots"] = json({ error: "snapshots: 5 of 5 in use; request more under Quota" }, 409);
  await expect(del({ save: true })).rejects.toThrow("snapshots: 5 of 5 in use; request more under Quota; nothing was deleted; drop `save`");
  // save with no branch checked out: refused, nothing saved or deleted
  routes["GET /v1/workspaces/w1"] = json({ id: "w1", name: "shop", volume: "vol-1", branch: null });
  await expect(del({ save: true })).rejects.toThrow("has no branch checked out");
  expect(posts().length).toBe(n + 1);
  expect(deletes()).toBe(5);
  // a capsule is deleted as before
  routes["GET /v1/workspaces/cap-1"] = json({ id: "cap-1" });
  routes["DELETE /v1/workspaces/cap-1"] = () => new Response(null, { status: 204 });
  expect(JSON.parse(await t.run({ action: "delete", workspace: "cap-1" })).state).toBe("deleted");
});

test("a plain delete refuses when packages or variables drifted from the base commit; skip_snapshot overrides", async () => {
  const t = tool(platformTools("main"), "workspace");
  const del = (extra: any = {}) => t.run({ action: "delete", workspace: "w1", ...extra });
  const deletes = () => calls.filter((c) => c.method === "DELETE").length;
  routes["GET /v1/workspaces/w1"] = json({ id: "w1", name: "web", volume: "vol-1", branch: "base", based_on_version: 2, image: "img", packages: ["git", "ripgrep"] });
  routes["GET /v1/volumes"] = json([{ id: "vol-1", name: "kode-web", branches: { base: 2 } }]);
  routes["GET /v1/volumes/vol-1/history"] = json([{ id: "s2", version: 2, state: { kind: "workspace", image: "img", packages: ["git", "jq"], env: { GH_PUSH_PAT: "${{ secrets.A }}" } } }]);
  routes["GET /v1/workspaces/w1/env"] = json({ env: { GH_PUSH_PAT: "${{ secrets.B }}" } });
  routes["DELETE /v1/workspaces/w1"] = () => new Response(null, { status: 204 });
  await expect(del()).rejects.toThrow("workspace web changed since kode-web@base v2: packages (+ripgrep, -jq); variables (GH_PUSH_PAT); nothing was deleted: pass `save: true` to keep them on base, or `skip_snapshot: true` to drop them");
  expect(deletes()).toBe(0);
  expect(JSON.parse(await del({ skip_snapshot: true })).state).toBe("deleted");
  // unchanged: a plain delete deletes
  routes["GET /v1/workspaces/w1/env"] = json({ env: { GH_PUSH_PAT: "${{ secrets.A }}" } });
  routes["GET /v1/workspaces/w1"] = json({ id: "w1", name: "web", volume: "vol-1", branch: "base", based_on_version: 2, image: "img", packages: ["git", "jq"] });
  expect(JSON.parse(await del()).saved).toBe("nothing: delete takes a snapshot only with `save: true`");
  // an unreadable base does not block: it deletes and says the comparison was skipped
  routes["GET /v1/volumes/vol-1/history"] = json({ error: "boom" }, 500);
  expect(JSON.parse(await del()).saved).toContain("the comparison with its base commit was skipped");
  expect(deletes()).toBe(3);
});

test("a snapshot without a message is refused with nothing saved", async () => {
  routes["POST /v1/workspaces/w1/snapshots"] = json({});
  routes["POST /v1/environments/e1/snapshots"] = json({});
  for (const [tl, args] of [["workspace_snapshot", { workspace: "w1" }], ["env_snapshot", { env: "e1" }]] as const) {
    await expect(tool(platformTools("main"), tl).run(args)).rejects.toThrow("`message`");
    await expect(tool(platformTools("main"), tl).run({ ...args, message: "  " })).rejects.toThrow("a snapshot needs a `message`");
  }
  expect(calls.filter((c) => c.method === "POST")).toEqual([]);
});

test("a delete handed back while its snapshot is written is finished by the next call with no second snapshot", async () => {
  const t = tool(platformTools("main"), "workspace");
  routes["GET /v1/workspaces/w1"] = json({ id: "w1", name: "shop", volume: "vol-1", branch: "base" });
  routes["GET /v1/volumes"] = json([{ id: "vol-1", name: "shop", branches: { base: 2 } }]);
  routes["GET /v1/volumes/vol-1/history"] = json([]);
  routes["DELETE /v1/workspaces/w1"] = () => new Response(null, { status: 204 });
  routes["POST /v1/workspaces/w1/snapshots"] = json({ id: "s3", phase: "writing", volume: "vol-1", name: "shop", version: 3, branch: "base" }, 202);
  const first = JSON.parse(await t.run({ action: "delete", workspace: "w1", save: true, soft_ms: 1500 }));
  expect([first.promoted, first.deleted, first.snapshot.id]).toEqual([true, false, "s3"]);
  routes["GET /v1/volumes/vol-1/history"] = json([{ id: "s3", phase: "ready", version: 3, message: "before delete of shop", createdAt: new Date().toISOString(), branches: ["base"] }]);
  const second = JSON.parse(await t.run({ action: "delete", workspace: "w1", save: true, soft_ms: 1500 }));
  expect(second.saved).toStartWith("base is now v3 (was v2) of volume shop");
  expect(calls.filter((c) => c.method === "POST").length).toBe(1);
  expect(calls.filter((c) => c.method === "DELETE").length).toBe(1);
});

test("the push tools pass the volume name and a fork from a commit the team", async () => {
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
  await tool(platformTools("main"), "env_snapshot").run({ env: "e1", message: "m", volume: "pg" });
  expect(post(1)).toEqual({ message: "m", volume: "pg" });
  await tool(platformTools("main"), "workspace_fork").run({ name: "w2", snapshot_id: "pg@2", team: "acme" });
  expect(post(2)).toEqual({ name: "w2", snapshot_id: "pg@2", team: "acme" });
  // a fork from a commit takes its own ttl in the same call, as a create does
  await tool(platformTools("main"), "workspace_fork").run({ name: "w3", snapshot_id: "pg@2", ttl_secs: 3600 });
  expect(post(3)).toEqual({ name: "w3", snapshot_id: "pg@2", ttl_secs: 3600 });
});

// ---- component tools: one test per tool (route, args, error mapping)
const ok = () => json({ ok: 1 });
const CASES: [string, any, string, string, any?][] = [
  ["capsule_create", { command: "make test", image: "i:1", packages: ["go"], variables: { A: "1" }, lifetime_s: 60, team: "acme" }, "POST", "/v1/capsules", { team: "acme", cmd: ["sh", "-c", "make test"], image: "i:1", packages: ["go"], env: { A: "1" }, timeout_secs: 60 }],
  ["capsule_create", { command: "x", from_workspace: "w1", from_snapshot: "ds@2" }, "POST", "/v1/capsules", { cmd: ["sh", "-c", "x"], from_workspace: "w1", from_snapshot: "ds@2" }],
  ["pipeline_version_delete", { owner: "acme", pipeline: "ci", version: 3 }, "DELETE", "/v1/pipelines/acme/ci/versions/3"],
  ["workspace_env_get", { workspace: "w1" }, "GET", "/v1/workspaces/w1/env"],
  ["capsule_get", { capsule: "cap-1" }, "GET", "/v1/capsules/cap-1"],
  ["capsule_logs", { capsule: "cap-1" }, "GET", "/v1/capsules/cap-1/logs"],
  ["capsule_list", { team: "acme", state: "running", limit: 5 }, "GET", "/v1/capsules?team=acme&state=running&limit=5"],
  ["capsule_delete", { capsule: "cap-1" }, "DELETE", "/v1/capsules/cap-1"],
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
  ["desk_create", { name: "fix", team: "acme", environment: "dev" }, "POST", "/v1/desks", { name: "fix", team: "acme", environment: "dev" }],
  ["desk_stop", { desk: "s1" }, "POST", "/v1/desks/s1/stop"],
  ["desk_start", { desk: "s1" }, "POST", "/v1/desks/s1/start"],
  ["desk_delete", { desk: "s1" }, "DELETE", "/v1/desks/s1"],
  ["desk_ttl", { desk: "s1", ttl_secs: 600 }, "PUT", "/v1/desks/s1/ttl", { ttl_secs: 600 }],
  ["workspace_ttl", { workspace: "w1", clear: true }, "PUT", "/v1/workspaces/w1/ttl", { ttl_secs: null }],
  ["env_ttl", { env: "e1", ttl_secs: 86400 }, "PUT", "/v1/environments/e1/ttl", { ttl_secs: 86400 }],
];
for (const [name, args, method, url, body] of CASES) {
  test(`${name} calls ${method} ${url} and maps a refusal`, async () => {
    const t = tool(platformTools("main"), name);
    expect(t).toBeDefined();
    // a verb answers the object it changed, so it reads it back (and `delete` reads it first)
    for (const o of ["/v1/workspaces/w1", "/v1/desks/s1", "/v1/environments/e1", "/v1/capsules/cap-1", "/v1/pipelines/acme/ci", "/v1/pipelines/acme/ci/runs/r1"]) routes[`GET ${o}`] = ok();
    routes[`${method} ${url}`] = ok();
    await t.run(args);
    const sent = calls.filter((c) => c.method === method && c.url === url).at(-1)!;
    expect(sent).toMatchObject({ method, url, auth: "Bearer tok1" });
    if (body) expect(sent.body).toEqual(body);
    routes[`${method} ${url}`] = () => new Response("nope", { status: 409 });
    await expect(t.run(args)).rejects.toThrow("409: nope");
  });
}

test("the component tools are in main and all, never in the workspace slice", () => {
  const names = ["capsule", "volume", "snapshot", "pipeline", "run", "workspace_vars", "webhook_rotate", "secret_set", "secret_list", "secret_delete", "connector_list"];
  for (const k of ["main", "all"] as const) for (const n of names) expect(platformTools(k, "w1").map((t) => t.name)).toContain(n);
  for (const n of names) expect(platformTools("workspace", "w1").map((t) => t.name)).not.toContain(n);
});

test("capsule delete ends the capsule first and ignores a refusal; pipeline get without a version adds the versions", async () => {
  const t = platformTools("main");
  routes["POST /v1/capsules/cap-1/terminate"] = () => new Response("over", { status: 409 });
  routes["DELETE /v1/capsules/cap-1"] = () => new Response(null, { status: 204 });
  routes["GET /v1/capsules/cap-1"] = json({ id: "cap-1", phase: "terminated" });
  routes["GET /v1/capsules/cap-2"] = json({ id: "cap-2" });
  // the answer is the object as last read, deleted
  expect(JSON.parse(await tool(t, "capsule_delete").run({ capsule: "cap-1" }))).toEqual({ id: "cap-1", phase: "terminated", state: "deleted" });
  expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["GET /v1/capsules/cap-1", "POST /v1/capsules/cap-1/terminate", "DELETE /v1/capsules/cap-1"]);
  routes["POST /v1/capsules/cap-2/terminate"] = () => new Response("down", { status: 500 });
  await expect(tool(t, "capsule_delete").run({ capsule: "cap-2" })).rejects.toThrow("500: down");
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
  expect(JSON.parse(await tool(t, "workspace_create").run({ name: "w", wait: true })).state).toBe("ready");
  expect(n).toBe(3);
  routes["GET /v1/workspaces/w9"] = json({ id: "w9", state: "creating" });
  expect(JSON.parse(await tool(t, "workspace_create").run({ name: "w" })).state).toBe("creating");
});

test("a wait: true call still running at soft_ms answers the promoted hand-off, even when the read is slow", async () => {
  const t = platformTools("main", undefined, 1);
  routes["POST /v1/workspaces"] = json({ id: "w9", state: "creating" }, 202);
  routes["GET /v1/workspaces/w9"] = async () => {
    await new Promise((r) => setTimeout(r, 400));
    return json({ id: "w9", state: "creating" })();
  };
  const t0 = Date.now();
  const out = JSON.parse(await tool(t, "workspace_create").run({ name: "w", wait: true, soft_ms: 50 }));
  expect(out).toEqual({ promoted: true, id: "w9", kind: "workspace", next: 0, next_err: 0, poll_after_ms: 2000 });
  expect(Date.now() - t0).toBeLessThan(300);
  // the other kinds name what resumes them
  routes["POST /v1/environments"] = json({ id: "e9", state: "creating", services: [] }, 202);
  routes["GET /v1/environments/e9"] = json({ id: "e9", state: "creating", services: [] });
  expect(JSON.parse(await tool(t, "env_create").run({ name: "e", wait: true, soft_ms: 30 }))).toMatchObject({ promoted: true, id: "e9", kind: "env" });
  routes["POST /v1/capsules"] = json({ id: "cap-9" }, 202);
  routes["POST /v1/capsules/cap-9/wait"] = json({ id: "cap-9", phase: "running" });
  expect(JSON.parse(await tool(t, "capsule_create").run({ command: "x", wait: true, soft_ms: 30 }))).toMatchObject({ promoted: true, id: "cap-9", kind: "capsule" });
  routes["POST /v1/pipelines/acme/ci/runs"] = json({ id: "r9" }, 202);
  routes["GET /v1/pipelines/acme/ci/runs/r9"] = json({ id: "r9", state: "running" });
  expect(JSON.parse(await tool(t, "run_start").run({ owner: "acme", pipeline: "ci", wait: true, soft_ms: 30 }))).toEqual({ promoted: true, id: "r9", kind: "run", next: 0, next_err: 0, poll_after_ms: 2000 });
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

test("workspace create sends `device` to make a device workspace, and fork with `source` and `snapshot` forks a device snapshot", async () => {
  const t = platformTools("main");
  routes["POST /v1/workspaces"] = json({}, 202);
  await tool(t, "workspace_create").run({ name: "d1", device: "dev-1" });
  expect(calls.at(-1)).toMatchObject({ url: "/v1/workspaces", body: { name: "d1", device: "dev-1" } });
  process.env.KD_DESK = "s1";
  routes["POST /v1/desks/s1/workspaces"] = json({}, 202);
  await tool(t, "workspace_create").run({ name: "d2", device: "dev-1" });
  expect(calls.at(-1)).toMatchObject({ url: "/v1/desks/s1/workspaces", body: { name: "d2", device: "dev-1" } });
  delete process.env.KD_DESK;
  routes["POST /v1/workspaces/w1/clone"] = json({}, 202);
  await tool(t, "workspace_fork").run({ name: "d3", source: "w1", snapshot: "dsnap-1" });
  expect(calls.at(-1)).toMatchObject({ url: "/v1/workspaces/w1/clone", body: { name: "d3", snapshot: "dsnap-1" } });
});

test("fork: `source` forks a live workspace or environment, `snapshot_id` a storage commit, exactly one of them", async () => {
  const t = platformTools("main");
  routes["POST /v1/workspaces/w1/clone"] = json({}, 202);
  routes["POST /v1/workspaces/restore"] = json({}, 202);
  await tool(t, "workspace_fork").run({ name: "c", source: "w1", task: "try" });
  expect(calls.at(-1)).toMatchObject({ url: "/v1/workspaces/w1/clone", body: { name: "c", task: "try" } });
  await tool(t, "workspace_fork").run({ name: "d", snapshot_id: "pg@base" });
  expect(calls.at(-1)).toMatchObject({ url: "/v1/workspaces/restore", body: { name: "d", snapshot_id: "pg@base" } });
  routes["POST /v1/environments/e1/clone"] = json({}, 202);
  routes["POST /v1/environments"] = json({}, 202);
  await tool(t, "env_fork").run({ name: "e2", source: "e1" });
  expect(calls.at(-1)!.url).toBe("/v1/environments/e1/clone");
  await tool(t, "env_fork").run({ name: "e3", snapshot_id: "pg@2" });
  expect(calls.at(-1)).toMatchObject({ url: "/v1/environments", body: { name: "e3", snapshot_id: "pg@2" } });
  const n = calls.length;
  for (const [tn, args] of [["workspace_fork", { name: "x" }], ["workspace_fork", { name: "x", source: "w1", snapshot_id: "pg@2" }], ["env_fork", { name: "x" }]] as const) {
    await expect(tool(t, tn).run(args)).rejects.toThrow("fork takes one of `source`");
  }
  expect(calls.length).toBe(n);
  // create makes an empty one: it no longer takes a source
  for (const tn of ["workspace", "env"]) expect((t.find((x) => x.name === tn)!.inputSchema as any).properties.source.description).not.toMatch(/\(create\)/);
});

test("capsule_create goes through the desk when there is one, with its argv array as given", async () => {
  process.env.KD_DESK = "desk-1";
  routes["POST /v1/desks/desk-1/capsules"] = json({ id: "cap-1" }, 202);
  await tool(platformTools("main"), "capsule_create").run({ command: ["echo", "hi"], team: "acme" });
  expect(calls.at(-1)!.body).toEqual({ cmd: ["echo", "hi"] });
});

test("capsule_logs returns the body as text, empty included", async () => {
  routes["GET /v1/capsules/cap-1/logs"] = () => new Response('{"a":1}\nline', { status: 200 });
  expect(await tool(platformTools("main"), "capsule_logs").run({ capsule: "cap-1" })).toBe('{"a":1}\nline');
  routes["GET /v1/capsules/cap-1/logs"] = () => new Response("", { status: 200 });
  expect(await tool(platformTools("main"), "capsule_logs").run({ capsule: "cap-1" })).toBe("");
});

test("capsule_wait uses the server wait route until the capsule ends, then times out with timedOut", async () => {
  const t = tool(platformTools("main"), "capsule_wait");
  let n = 0;
  routes["POST /v1/capsules/cap-1/wait"] = () => json(++n < 3 ? { id: "cap-1", phase: "running" } : { id: "cap-1", phase: "terminated", exit_code: 0 })();
  expect(JSON.parse(await t.run({ capsule: "cap-1" })).exit_code).toBe(0);
  expect(n).toBe(3);
  expect(calls[0].body.timeout_ms).toBeLessThanOrEqual(20000);
  routes["POST /v1/capsules/cap-1/wait"] = json({ id: "cap-1", phase: "running" });
  expect(JSON.parse(await t.run({ capsule: "cap-1", timeout_ms: 10 })).timed_out).toBe(true);
  routes["POST /v1/capsules/cap-1/wait"] = () => new Response("not found", { status: 404 });
  await expect(t.run({ capsule: "cap-1" })).rejects.toThrow("404");
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
  for (const n of ["capsule_wait", "run_wait"]) expect((tool(t, n).inputSchema as any).properties.timeout_ms.description).toContain("maximum 900000");
});

test("a ttl tool needs ttl_secs or clear", async () => {
  for (const [n, a, url] of [["desk_ttl", { desk: "s1" }, "/v1/desks/s1/ttl"], ["workspace_ttl", { workspace: "w1" }, "/v1/workspaces/w1/ttl"], ["env_ttl", { env: "e1" }, "/v1/environments/e1/ttl"]] as const) {
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

test("capsule_logs and run_logs keep the last 200 lines by default, tail and head choose", async () => {
  const text = Array.from({ length: 500 }, (_, i) => `l${i}`).join("\n") + "\n";
  routes["GET /v1/capsules/cap-1/logs"] = () => new Response(text);
  const t = tool(platformTools("main"), "capsule_logs");
  const out = await t.run({ capsule: "cap-1" });
  expect(out).toContain("300 of 500 lines left out");
  expect(out).toContain("l499");
  expect(out).not.toContain("l299\n");
  expect(await t.run({ capsule: "cap-1", tail: 2000 })).toBe(text);
  expect(await t.run({ capsule: "cap-1", head: 2, tail: 2000 })).toContain("l1\n");
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
  const e2 = await tool(t, "workspace_create").run({ name: "w" }).catch((e) => JSON.parse(e.message));
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

test("env create with wait answers the created object and a hint when the desk is not connected to it", async () => {
  const t = platformTools("main", undefined, 1);
  routes["POST /v1/environments"] = json({ id: "env-new", name: "shop", state: "creating", services: [] }, 202);
  routes["GET /v1/environments/env-new"] = () => new Response("that environment is not connected to this desk", { status: 403 });
  const out = JSON.parse(await tool(t, "env_create").run({ name: "shop", services: [{ name: "db", image: "postgres:16", ports: [5432] }], wait: true, soft_ms: 50 }));
  expect(out.id).toBe("env-new");
  expect(out.hint).toContain("desk");
});

test("env restore takes source; snapshot_id is its alias there, and listed only as fork's", async () => {
  routes["POST /v1/environments/e1/restore"] = json({ ok: 1 });
  routes["GET /v1/environments/e1"] = json({ id: "e1", services: [] });
  const t = platformTools("main");
  await tool(t, "env").run({ action: "restore", env: "e1", source: "pg@2" });
  await tool(t, "env").run({ action: "restore", env: "e1", snapshot_id: "snap-9" });
  expect(calls.filter((c) => c.url === "/v1/environments/e1/restore").map((c) => c.body.snapshot_id)).toEqual(["pg@2", "snap-9"]);
  const props = (t.find((x) => x.name === "env")!.inputSchema as any).properties;
  expect(props.snapshot_id.description).toMatch(/\(fork\)\.$/);
  expect(props.snapshot_id.description).not.toContain("restore");
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

test("desk stop answers without a second read", async () => {
  routes["POST /v1/desks/s1/stop"] = json({}, 202);
  expect(JSON.parse(await tool(platformTools("main"), "desk_stop").run({ desk: "s1" }))).toEqual({ id: "s1", state: "stopping" });
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

test("no worktree tool and no tree argument; request_create echoes the title; quota defaults to KD_TEAM", async () => {
  const t = platformTools("main", undefined, 1);
  // a workspace has one tree: a second working copy is a fork
  for (const k of ["main", "all", "workspace"] as const) {
    const tools = platformTools(k, "w1");
    expect(tools.map((x) => x.name)).not.toContain("worktree");
    for (const x of tools) expect(JSON.stringify(x.inputSchema)).not.toContain('"tree"');
  }
  await expect(tool(t, "download").run({ workspace: "w1", path: "a", tree: "fix" })).rejects.toThrow();
  routes["POST /v1/requests"] = json({ id: "r1", kind: "other" }, 201);
  expect(JSON.parse(await tool(t, "request_create").run({ kind: "other", reason: "x", title: "T", body: "B" }))).toMatchObject({ id: "r1", title: "T", body: "B" });
  process.env.KD_TEAM = "acme";
  routes["GET /v1/quota?owner=acme"] = json({ owner: "acme" });
  expect(JSON.parse(await tool(t, "quota").run({})).owner).toBe("acme");
  delete process.env.KD_TEAM;
});

test("a snapshot whose re-read fails still answers success with its id", async () => {
  routes["POST /v1/workspaces/w1/snapshots"] = json({ id: "s7" });
  routes["GET /v1/workspaces/w1"] = () => { throw new Error("boom"); };
  const out = JSON.parse(await tool(platformTools("workspace", "w1"), "workspace_snapshot").run({ message: "m" }));
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
    const p = tool(t, "workspace_create").run({ name: "w", wait: true, soft_ms: 60_000 });
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

test("snapshot delete takes the volume's display name, an id, and refuses an unknown or ambiguous name", async () => {
  routes["GET /v1/volumes"] = json([{ id: "env-1", name: "data" }, { id: "env-2", name: "twin" }, { id: "env-3", name: "twin" }]);
  routes["DELETE /v1/volumes/env-1/snapshots/s1"] = () => new Response(null, { status: 204 });
  const t = platformTools("main");
  await tool(t, "snapshot").run({ action: "delete", volume: "data", snapshot: "s1" });
  await tool(t, "snapshot").run({ action: "delete", volume: "env-1", snapshot: "s1" });
  expect(calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual(["/v1/volumes/env-1/snapshots/s1", "/v1/volumes/env-1/snapshots/s1"]);
  await expect(tool(t, "snapshot").run({ action: "delete", volume: "nope", snapshot: "s1" })).rejects.toThrow("no volume named nope; volume list shows names and ids");
  await expect(tool(t, "snapshot").run({ action: "delete", volume: "twin", snapshot: "s1" })).rejects.toThrow(/env-2.*env-3/);
});

test("capsule wait on a pending view with exit_code null keeps waiting to the bound", async () => {
  const t = platformTools("main");
  routes["POST /v1/capsules/c1/wait"] = json({ phase: "running", exit_code: null });
  const out = JSON.parse(await tool(t, "capsule_wait").run({ capsule: "c1", timeout_ms: 1 }));
  expect(out.timed_out).toBe(true);
  routes["POST /v1/capsules/c1/wait"] = json({ phase: "terminated", exit_code: 0 });
  expect(JSON.parse(await tool(t, "capsule_wait").run({ capsule: "c1" })).exit_code).toBe(0);
});

test("memory write is a patch and refuses anything but one of edits, content, delete", async () => {
  const t = platformTools("main").find((x) => x.name === "memory")!;
  routes["PUT /v1/memory/acme/run"] = json({ version: 2 });
  await t.run({ action: "write", owner: "acme", section: "run", if_version: 1, edits: [{ find: "a", replace: "b" }] });
  expect(calls.at(-1)).toMatchObject({ method: "PUT", url: "/v1/memory/acme/run", body: { if_version: 1, edits: [{ find: "a", replace: "b" }] } });
  await expect(t.run({ action: "write", owner: "acme", section: "run", if_version: 1 })).rejects.toThrow("exactly one");
  await expect(t.run({ action: "read", project: "a", owner: "b" })).rejects.toThrow("same thing");
});

test("the push tools pass description, labels and a branch, and leave out what was not given", async () => {
  routes["POST /v1/workspaces/w1/snapshots"] = json({});
  routes["POST /v1/environments/e1/snapshots"] = json({});
  routes["GET /v1/workspaces/w1"] = json({ id: "w1", state: "ready" });
  routes["GET /v1/environments/e1"] = json({ id: "e1", state: "running", services: [] });
  const post = (n: number) => calls.filter((c) => c.method === "POST")[n]!.body;
  await tool(platformTools("main"), "workspace_snapshot").run({ workspace: "w1", message: "m", volume: "pg", description: "Postgres 16 with the seed data", labels: ["shop", "test"], branch: "base" });
  // `labels` are the volume's, `branch` is where this push's commit goes: two fields of the body
  expect(post(0)).toEqual({ message: "m", volume: "pg", description: "Postgres 16 with the seed data", labels: ["shop", "test"], branch: "base" });
  await tool(platformTools("workspace", "w1"), "workspace_snapshot").run({ message: "m", branch: "wip-auth" });
  expect(post(1)).toEqual({ message: "m", branch: "wip-auth" });
  await tool(platformTools("main"), "env_snapshot").run({ env: "e1", message: "m", volume: "pg", description: "d", labels: [], branch: "green" });
  expect(post(2)).toEqual({ message: "m", volume: "pg", description: "d", labels: [], branch: "green" });
  await tool(platformTools("main"), "env_snapshot").run({ env: "e1", message: "m" });
  expect(post(3)).toEqual({ message: "m" });
  // the old list is no argument any more
  await expect(tool(platformTools("main"), "workspace_snapshot").run({ workspace: "w1", tags: ["base"] })).rejects.toThrow();
  for (const t of ["workspace", "env"]) {
    const p = (platformTools("main").find((x) => x.name === t)!.inputSchema as any).properties;
    expect(p.labels.description).toContain("labels on the volume");
    expect(p.branch).toMatchObject({ type: "string" });
    expect(p.branch.description).toContain("The branch this storage commit goes on");
    expect(p.tags).toBeUndefined();
  }
});

test("a push answers the branch it moved and why a fast-forward was refused", async () => {
  routes["POST /v1/workspaces/w1/snapshots"] = json({ id: "s9", volume: "pg", version: 4, branch: null, detached: "branch base moved to v5 since this workspace was made from v3" });
  // the history row arrives later and carries the commit's own branches, never the push's verdict
  routes["GET /v1/volumes/pg/history"] = json([{ id: "s9", version: 4, branches: [] }]);
  routes["GET /v1/workspaces/w1"] = json({ id: "w1", state: "ready" });
  const out = JSON.parse(await tool(platformTools("main"), "workspace_snapshot").run({ workspace: "w1", message: "m" }));
  expect(out.snapshot).toMatchObject({ id: "s9", version: 4, branch: null, detached: "branch base moved to v5 since this workspace was made from v3", branches: [], phase: "ready" });
}, 10_000);

test("workspace and env create set ttl_secs on the new object in the same call", async () => {
  const t = platformTools("main");
  routes["POST /v1/workspaces"] = json({ id: "w9", state: "creating" }, 201);
  routes["PUT /v1/workspaces/w9/ttl"] = json({});
  routes["POST /v1/environments"] = json({ id: "e9", state: "creating" }, 201);
  routes["PUT /v1/environments/e9/ttl"] = json({});
  routes["POST /v1/environments/src/clone"] = json({ id: "e8" }, 201);
  routes["PUT /v1/environments/e8/ttl"] = json({});
  expect(JSON.parse(await tool(t, "workspace_create").run({ name: "a", ttl_secs: 3600 }))).toEqual({ id: "w9", state: "creating" });
  await tool(t, "env_create").run({ name: "b", ttl_secs: 600 });
  await tool(t, "env_fork").run({ name: "c", source: "src", ttl_secs: 7200 });
  const puts = calls.filter((c) => c.method === "PUT").map((c) => [c.url, c.body]);
  expect(puts).toEqual([["/v1/workspaces/w9/ttl", { ttl_secs: 3600 }], ["/v1/environments/e9/ttl", { ttl_secs: 600 }], ["/v1/environments/e8/ttl", { ttl_secs: 7200 }]]);
  // the create body never carries it, and no ttl means no second call
  expect(calls.find((c) => c.method === "POST" && c.url === "/v1/workspaces")!.body).toEqual({ name: "a" });
  await tool(t, "workspace_create").run({ name: "d" });
  expect(calls.filter((c) => c.method === "PUT").length).toBe(3);
  // a refused ttl fails the answer and names what was made
  routes["PUT /v1/workspaces/w9/ttl"] = json({ error: "ttl_secs: 600 to 2592000" }, 422);
  await expect(tool(t, "workspace_create").run({ name: "a", ttl_secs: 3600 })).rejects.toThrow("created w9, but `ttl_secs` was refused");
  expect((t.find((x) => x.name === "workspace")!.inputSchema as any).properties.ttl_secs.description).toContain("(create, fork, ttl)");
});

test("every argument that names a snapshot says it takes a name, name@N, name@<branch> or an id", () => {
  const props = (n: string) => (platformTools("main").find((x) => x.name === n)!.inputSchema as any).properties;
  const ref = "a volume name (its `base` branch, else its newest commit), `name@N`, `name@<branch>` or a snapshot id";
  for (const d of [props("workspace").snapshot_id.description, props("env").source.description, props("capsule").from_snapshot.description]) expect(d).toContain(ref);
});

test("volume list filters by label; get adds the description, labels and branches of the list row", async () => {
  const t = platformTools("main");
  routes["GET /v1/volumes?owner=acme&label=shop"] = json([{ id: "ws-ab12", name: "pg" }]);
  expect(JSON.parse(await tool(t, "volume_list").run({ owner: "acme", label: "shop" }))).toEqual([{ id: "ws-ab12", name: "pg" }]);
  // the old filter is no argument any more: it must not reach the query as `tag`
  await expect(tool(t, "volume_list").run({ owner: "acme", tag: "base" })).rejects.toThrow();
  routes["GET /v1/volumes"] = json([{ id: "ws-ab12", name: "pg", description: "Postgres 16", labels: ["shop", "test"], branches: { base: 1 } }, { id: "ws-cd34", name: null, description: null, labels: [], branches: {} }]);
  for (const id of ["ws-ab12", "ws-cd34"]) {
    // each history entry's own branches come from the api untouched
    routes[`GET /v1/volumes/${id}/history?include=working`] = json([{ id: "s1", version: 1, branches: ["base"] }]);
    routes[`GET /v1/volumes/${id}/refs`] = json({});
  }
  // by name and by id alike: the row is the same one
  for (const volume of ["pg", "ws-ab12"]) expect(JSON.parse(await tool(t, "volume_get").run({ volume }))).toEqual({ volume, description: "Postgres 16", labels: ["shop", "test"], branches: { base: 1 }, history: [{ id: "s1", version: 1, branches: ["base"] }], refs: {} });
  expect(JSON.parse(await tool(t, "volume_get").run({ volume: "ws-cd34" }))).toMatchObject({ description: null, labels: [], branches: {} });
});

test("volume describe PATCHes the name under its owner, sends only what was given, and refuses neither", async () => {
  const t = platformTools("main");
  const doc = { id: "ws-ab12", name: "pg", description: "Postgres 16", labels: ["shop"], branches: {} };
  routes["PATCH /v1/volumes/acme/pg"] = json(doc);
  routes["PATCH /v1/volumes/alice/pg"] = json(doc);
  const patches = () => calls.filter((c) => c.method === "PATCH").map((c) => [c.url, c.body]);
  process.env.KD_TEAM = "acme";
  try {
    // the owner defaults to the desk's team, as the pipeline tools' does
    expect(JSON.parse(await tool(t, "volume_describe").run({ volume: "pg", description: "Postgres 16", labels: ["shop"] }))).toEqual(doc);
    await tool(t, "volume_describe").run({ volume: "pg", owner: "alice", labels: ["wip"] });
    // "" and [] clear, so they are sent
    await tool(t, "volume_describe").run({ volume: "pg", description: "" });
    await tool(t, "volume_describe").run({ volume: "pg", labels: [] });
    expect(patches()).toEqual([
      ["/v1/volumes/acme/pg", { description: "Postgres 16", labels: ["shop"] }],
      ["/v1/volumes/alice/pg", { labels: ["wip"] }],
      ["/v1/volumes/acme/pg", { description: "" }],
      ["/v1/volumes/acme/pg", { labels: [] }],
    ]);
    await expect(tool(t, "volume_describe").run({ volume: "pg" })).rejects.toThrow("give `description` or `labels`");
    await expect(tool(t, "volume_describe").run({ volume: "pg", description: null })).rejects.toThrow("give `description` or `labels`");
    // describe sets labels only: a branch is `volume branch`'s, so `branches` is no argument here
    await expect(tool(t, "volume_describe").run({ volume: "pg", branches: ["base"] })).rejects.toThrow();
    expect(patches().length).toBe(4);
  } finally {
    delete process.env.KD_TEAM;
  }
  await expect(tool(t, "volume_describe").run({ volume: "pg", labels: ["wip"] })).rejects.toThrow("`owner` is required");
  routes["PATCH /v1/volumes/acme/pg"] = json({ error: "labels: at most 8" }, 422);
  await expect(tool(t, "volume_describe").run({ volume: "pg", owner: "acme", labels: ["a"] })).rejects.toThrow("422: labels: at most 8");
  const v = t.find((x) => x.name === "volume")!;
  expect((v.inputSchema as any).properties.action.enum).toEqual(["list", "get", "describe", "branch", "delete_branch", "rename", "delete"]);
  expect(v.description).toBe("Volumes: the stored state of workspaces and environments, each with a name, a description, labels and numbered storage commits; a branch is a movable name on one commit (`name@<branch>`) that a snapshot advances. Actions: list (filter by `label`), get (history with each commit's branches, and the newest commit), describe (set `description` and `labels`), branch (create a branch or move it onto a commit), delete_branch, rename (give the volume another name `to`: every commit, branch and the history stay, the old name stops resolving, so update references to it such as `old@base` in notes or scripts), delete a detached volume.");
});

test("volume branch PUTs one target under the owner and the name; delete_branch DELETEs the same path", async () => {
  const t = platformTools("main");
  const doc = { id: "ws-ab12", name: "pg", labels: ["shop"], branches: { base: 3 } };
  routes["PUT /v1/volumes/acme/pg/branches/base"] = json(doc);
  routes["PUT /v1/volumes/alice/pg/branches/green"] = json(doc);
  routes["DELETE /v1/volumes/acme/pg/branches/base"] = () => new Response(null, { status: 204 });
  const sent = (m: string) => calls.filter((c) => c.method === m).map((c) => [c.url, c.body]);
  process.env.KD_TEAM = "acme";
  try {
    // the owner defaults to the desk's team; the answer is the named volume the api answers
    expect(JSON.parse(await tool(t, "volume_branch").run({ volume: "pg", branch: "base", version: 3 }))).toEqual(doc);
    await tool(t, "volume_branch").run({ volume: "pg", owner: "alice", branch: "green", snapshot: "snap-9f" });
    expect(sent("PUT")).toEqual([
      ["/v1/volumes/acme/pg/branches/base", { version: 3 }],
      ["/v1/volumes/alice/pg/branches/green", { snapshot: "snap-9f" }],
    ]);
    // exactly one target: neither and both are refused before any request
    for (const extra of [{}, { version: 3, snapshot: "snap-9f" }, { version: null }]) await expect(tool(t, "volume_branch").run({ volume: "pg", branch: "base", ...extra })).rejects.toThrow("exactly one of `version` or `snapshot`");
    await expect(tool(t, "volume_branch").run({ volume: "pg", version: 3 })).rejects.toThrow("branch");
    expect(sent("PUT").length).toBe(2);
    expect(JSON.parse(await tool(t, "volume_delete_branch").run({ volume: "pg", branch: "base" }))).toEqual({ volume: "pg", branch: "base", state: "deleted" });
    expect(sent("DELETE")).toEqual([["/v1/volumes/acme/pg/branches/base", undefined]]);
    // the api's sentences come back as written
    routes["PUT /v1/volumes/acme/pg/branches/base"] = json({ error: "volume pg has no commit 9" }, 404);
    await expect(tool(t, "volume_branch").run({ volume: "pg", branch: "base", version: 9 })).rejects.toThrow("404: volume pg has no commit 9");
    routes["DELETE /v1/volumes/acme/pg/branches/base"] = json({ error: "volume pg has no branch base" }, 404);
    await expect(tool(t, "volume_delete_branch").run({ volume: "pg", branch: "base" })).rejects.toThrow("404: volume pg has no branch base");
    // the old actions are gone
    for (const action of ["tag", "untag"]) await expect(t.find((x) => x.name === "volume")!.run({ action, volume: "pg", tag: "base", version: 3 })).rejects.toThrow("`action` must be one of");
  } finally {
    delete process.env.KD_TEAM;
  }
  await expect(tool(t, "volume_branch").run({ volume: "pg", branch: "base", version: 1 })).rejects.toThrow("`owner` is required");
  await expect(tool(t, "volume_delete_branch").run({ volume: "pg", branch: "base" })).rejects.toThrow("`owner` is required");
});

test("volume rename POSTs `to` under the owner and the name, and says so when the api has no such route", async () => {
  const t = platformTools("main");
  const doc = { id: "ws-ab12", name: "kode-platform-base", branches: { base: 3 }, latest_version: 3 };
  routes["POST /v1/volumes/acme/kode-rust/rename"] = json(doc);
  process.env.KD_TEAM = "acme";
  try {
    // the answer is the renamed volume the api answers, under the owner defaulting to the desk's team
    expect(JSON.parse(await tool(t, "volume_rename").run({ volume: "kode-rust", to: "kode-platform-base" }))).toEqual(doc);
    expect(calls.filter((c) => c.method === "POST").map((c) => [c.url, c.body])).toEqual([["/v1/volumes/acme/kode-rust/rename", { to: "kode-platform-base" }]]);
    await expect(tool(t, "volume_rename").run({ volume: "kode-rust" })).rejects.toThrow("to");
    // the api's sentences come back as written
    routes["POST /v1/volumes/acme/kode-rust/rename"] = json({ error: "volume name kode-ops is taken" }, 409);
    await expect(tool(t, "volume_rename").run({ volume: "kode-rust", to: "kode-ops" })).rejects.toThrow("409: volume name kode-ops is taken");
    routes["POST /v1/volumes/acme/kode-rust/rename"] = () => new Response("volume kode-rust does not exist", { status: 404 });
    await expect(tool(t, "volume_rename").run({ volume: "kode-rust", to: "x-base" })).rejects.toThrow("404: volume kode-rust does not exist");
    // an api from before the route: its router's bare 404 is not "no such volume"
    routes["POST /v1/volumes/acme/kode-rust/rename"] = () => new Response("", { status: 404 });
    await expect(tool(t, "volume_rename").run({ volume: "kode-rust", to: "x-base" })).rejects.toThrow("not available on this platform's api yet");
  } finally {
    delete process.env.KD_TEAM;
  }
});
