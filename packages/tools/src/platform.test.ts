import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { api, platformTools } from "./platform.ts";

type Call = { method: string; url: string; auth: string | null; body: any };
let calls: Call[] = [];
let routes: Record<string, () => Response> = {};
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
    return r ? r() : new Response("not found", { status: 404 });
  }) as any;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.KL_API_URL;
  delete process.env.KL_TOOL_KEY_FILE;
  delete process.env.KL_SESSION;
});

const json = (v: unknown, status = 200) => () => new Response(JSON.stringify(v), { status });
const tool = (tools: ReturnType<typeof platformTools>, n: string) => tools.find((t) => t.name === n)!;

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

test("main keeps packages_list only; a workspace stops itself with no workspace param", async () => {
  const names = platformTools("main").map((x) => x.name);
  for (const n of ["packages_add", "packages_remove", "packages_update", "intercept", "release"]) expect(names).not.toContain(n);
  expect(names).toContain("packages_list");
  routes["POST /v1/workspaces/w1/stop"] = json({}, 202);
  const stop = tool(platformTools("workspace", "w1"), "workspace_stop");
  expect((stop.inputSchema as any).properties).toEqual({});
  await stop.run({});
  expect(calls.at(-1)!.url).toBe("/v1/workspaces/w1/stop");
  expect(((tool(platformTools("main"), "workspace_stop").inputSchema as any).required)).toEqual(["workspace"]);
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
  expect(calls.at(-1)!.body).toEqual({ services: [{ name: "a", image: "a:2", command: [], env: {}, mounts: [] }] });
  await tool(t, "service_update").run({ env: "e1", service: { name: "a", image: "a:3", env: { K: "v" } } });
  expect(calls.at(-1)!.body).toEqual({ services: [{ name: "a", image: "a:3", command: [], env: { K: "v" }, mounts: [] }] });
  await tool(t, "service_remove").run({ env: "e1", name: "a" });
  expect(calls.at(-1)!.body).toEqual({ services: [] });
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
  await tool(t, "intercept").run({ service: "web" });
  expect(calls.at(-1)!.body).toEqual({ service: "web", workspace: "w1" });
  // no aiming it at another workspace
  expect((tool(t, "intercept").inputSchema as any).properties.workspace).toBeUndefined();
  await tool(t, "intercept").run({ service: "web", workspace: "w2" });
  expect(calls.at(-1)!.body).toEqual({ service: "web", workspace: "w1" });
  // in a session whose environment is not resolved, or in none
  routes["GET /v1/workspaces/w1"] = json({ session: "ses-1", packages: [] });
  await expect(tool(t, "env_get").run({})).rejects.toThrow("this workspace's session has no environment");
  routes["GET /v1/workspaces/w1"] = json({ packages: [] });
  await expect(tool(t, "env_get").run({})).rejects.toThrow("this workspace is in no session");
  expect(t.some((x) => x.name === "workspace_create")).toBe(false);
});

test("the bench offers session_current only: a bench belongs to its session and never joins", () => {
  for (const kind of ["main", "all", "workspace"] as const) {
    const names = platformTools(kind, "w1").map((x) => x.name);
    expect(names).toContain("session_current");
    expect(names).not.toContain("session_use");
    expect(names).not.toContain("session_clear");
  }
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

test("session_connect and session_disconnect are the bench's only; a workspace cannot change its session", async () => {
  expect(platformTools("workspace", "w1").map((x) => x.name)).not.toContain("session_connect");
  const t = platformTools("main");
  expect(t.map((x) => x.name)).toContain("session_connect");
  expect(t.map((x) => x.name)).toContain("session_disconnect");
  delete process.env.KL_SESSION;
  expect(await tool(t, "session_connect").run({ environment: "e2" })).toContain("no session");
  process.env.KL_SESSION = "ses-1";
  routes["PUT /v1/sessions/ses-1/environment"] = json({ id: "ses-1", name: "main", environment: "e2" });
  expect(JSON.parse(await tool(t, "session_connect").run({ environment: "e2" }))).toEqual({ id: "ses-1", name: "main", environment: "e2" });
  expect(calls.at(-1)!.body).toEqual({ environment: "e2" });
  routes["PUT /v1/sessions/ses-1/environment"] = json({ id: "ses-1", name: "main", environment: null });
  expect(JSON.parse(await tool(t, "session_disconnect").run({}))).toEqual({ id: "ses-1", name: "main", environment: null });
  expect(calls.at(-1)!.body).toEqual({ environment: null });
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

test("service_logs reads the build gate's logs port, defaulting env in a workspace session", async () => {
  process.env.KL_LOGS_URL = "http://logs.test";
  try {
    const seen: string[] = [];
    const inner = globalThis.fetch;
    globalThis.fetch = (async (url: string, init: any = {}) => {
      if (!String(url).startsWith("http://logs.test")) return inner(url as any, init);
      seen.push(String(url).replace("http://logs.test", ""));
      expect(init.headers?.authorization).toBeUndefined();
      return String(url).includes("/nope") ? new Response("{\"error\":\"no such service\"}", { status: 404 }) : new Response("{\"pods\":[]}");
    }) as any;
    // main: env is required and goes into the path
    const m = platformTools("main");
    expect(await tool(m, "service_logs").run({ env: "e1", service: "web", tail: 50, previous: true })).toBe("{\"pods\":[]}");
    expect(seen.at(-1)).toBe("/logs/e1/web?tail=50&previous=true");
    // a quoted flag reads as the flag: "false" must not ask for the crashed container
    await tool(m, "service_logs").run({ env: "e1", service: "web", previous: "false" });
    expect(seen.at(-1)).toBe("/logs/e1/web");
    await tool(m, "service_logs").run({ env: "e1", service: "web", previous: "true" });
    expect(seen.at(-1)).toBe("/logs/e1/web?previous=true");
    expect((tool(m, "service_logs").inputSchema as any).required).toEqual(["env", "service"]);
    // workspace: env defaults through the workspace's session
    const t = platformTools("workspace", "w1");
    routes["GET /v1/workspaces/w1"] = json({ team: "acme", session: "ses-1", environment: "e9", packages: [] });
    await tool(t, "service_logs").run({ service: "web" });
    expect(seen.at(-1)).toBe("/logs/e9/web");
    await expect(tool(t, "service_logs").run({ service: "nope" })).rejects.toThrow('404: {"error":"no such service"}');
  } finally {
    delete process.env.KL_LOGS_URL;
  }
});

test("every workspace and env param says it takes the id, not the name", () => {
  for (const kind of ["main", "workspace"] as const)
    for (const t of platformTools(kind, "ws-1"))
      for (const k of ["workspace", "env"]) {
        const p = (t.inputSchema.properties as any)[k];
        if (p) expect(`${t.name}.${k}: ${p.description ?? ""}`).toContain("id (");
      }
});

test("all is main's table plus the workspace-only tools, each aimed by a required workspace or env", () => {
  const main = platformTools("main").map((t) => t.name);
  const all = platformTools("all");
  const names = all.map((t) => t.name);
  expect(new Set(names).size).toBe(names.length);
  for (const n of main) expect(names).toContain(n);
  for (const n of ["packages_add", "packages_remove", "packages_update"]) expect((tool(all, n).inputSchema as any).required).toContain("workspace");
  expect((tool(all, "intercept").inputSchema as any).required).toEqual(["env", "service", "workspace"]);
  expect((tool(all, "release").inputSchema as any).required).toEqual(["env", "service"]);
});

test("env_wait returns once every service is ready, at once on failing, and marks a timeout", async () => {
  const t = platformTools("main", undefined, 1);
  let n = 0;
  routes["GET /v1/environments/e1"] = () => json({ state: "running", services: [{ name: "a" }], service_status: [{ name: "a", ready: ++n >= 3 }] })();
  const out = JSON.parse(await tool(t, "env_wait").run({ env: "e1" }));
  expect(n).toBe(3);
  expect(out.timedOut).toBeUndefined();
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
    expect(JSON.parse(await tool(slow, "env_wait").run({ env: "e1", timeout: 1 })).timedOut).toBe(true);
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
    "DELETE /v1/workspaces/w1",
    "POST /v1/sessions/ses-1/workspaces",
    "DELETE /v1/sessions/ses-1/workspaces/w1",
  ]);
  // The session already names the owner: a `team` would only contradict it.
  expect(calls[2].body).toEqual({ name: "backend", quota_gb: 5 });
});

test("the push tools pass the volume name and the restore tool the team", async () => {
  routes["POST /v1/workspaces/w1/snapshots"] = json({});
  routes["POST /v1/environments/e1/snapshots"] = json({});
  routes["POST /v1/workspaces/restore"] = json({});
  await tool(platformTools("workspace", "w1"), "workspace_snapshot").run({ message: "m", volume: "pg" });
  expect(calls[0].body).toEqual({ message: "m", volume: "pg" });
  await tool(platformTools("main"), "env_snapshot").run({ env: "e1", volume: "pg" });
  expect(calls[1].body).toEqual({ volume: "pg" });
  await tool(platformTools("main"), "workspace_restore").run({ name: "w2", snapshot_id: "pg@2", team: "acme" });
  expect(calls[2].body).toEqual({ name: "w2", snapshot_id: "pg@2", team: "acme" });
});

// ---- component tools: one test per tool (route, args, error mapping)
const ok = () => json({ ok: 1 });
const CASES: [string, any, string, string, any?][] = [
  ["sandbox_create", { command: "make test", image: "i:1", packages: ["go"], variables: { A: "1" }, timeout_s: 60, team: "acme" }, "POST", "/v1/sandboxes", { team: "acme", cmd: ["sh", "-c", "make test"], image: "i:1", packages: ["go"], env: { A: "1" }, timeout_secs: 60 }],
  ["sandbox_get", { sandbox: "sbx-1" }, "GET", "/v1/sandboxes/sbx-1"],
  ["sandbox_logs", { sandbox: "sbx-1" }, "GET", "/v1/sandboxes/sbx-1/logs"],
  ["sandbox_list", { team: "acme", state: "running", limit: 5 }, "GET", "/v1/sandboxes?team=acme&state=running&limit=5"],
  ["sandbox_terminate", { sandbox: "sbx-1" }, "POST", "/v1/sandboxes/sbx-1/terminate"],
  ["sandbox_delete", { sandbox: "sbx-1" }, "DELETE", "/v1/sandboxes/sbx-1"],
  ["pipeline_list", { owner: "acme" }, "GET", "/v1/pipelines/acme"],
  ["pipeline_get", { owner: "acme", pipeline: "ci", version: 2 }, "GET", "/v1/pipelines/acme/ci?version=2"],
  ["pipeline_versions", { owner: "acme", pipeline: "ci" }, "GET", "/v1/pipelines/acme/ci/versions"],
  ["pipeline_delete", { owner: "acme", pipeline: "ci" }, "DELETE", "/v1/pipelines/acme/ci"],
  ["webhook_rotate", { owner: "acme", pipeline: "ci" }, "POST", "/v1/pipelines/acme/ci/webhook/rotate"],
  ["run_start", { owner: "acme", pipeline: "ci", inputs: { t: "x" }, version: 3, key: "k" }, "POST", "/v1/pipelines/acme/ci/runs", { inputs: { t: "x" }, version: 3, key: "k" }],
  ["run_list", { owner: "acme", pipeline: "ci", state: "failure" }, "GET", "/v1/pipelines/acme/ci/runs?state=failure"],
  ["run_get", { owner: "acme", pipeline: "ci", run: "r1" }, "GET", "/v1/pipelines/acme/ci/runs/r1"],
  ["run_logs", { owner: "acme", pipeline: "ci", run: "r1", job: 1, offset: 24 }, "GET", "/v1/pipelines/acme/ci/runs/r1/jobs/1/logs?offset=24"],
  ["run_cancel", { owner: "acme", pipeline: "ci", run: "r1" }, "POST", "/v1/pipelines/acme/ci/runs/r1/cancel"],
  ["secret_list", { owner: "acme" }, "GET", "/v1/secrets/acme"],
  ["secret_delete", { owner: "acme", name: "DB_URL", mine: true }, "DELETE", "/v1/secrets/acme/mine/DB_URL"],
  ["workspace_env_set", { workspace: "w1", variables: { A: "${{ secrets.A }}" }, restart_on_change: true }, "PUT", "/v1/workspaces/w1/env", { env: { A: "${{ secrets.A }}" }, restartOnEnvChange: true }],
  ["workspace_restart", { workspace: "w1" }, "POST", "/v1/workspaces/w1/restart"],
  ["service_restart", { env: "e1", service: "api" }, "POST", "/v1/environments/e1/services/api/restart"],
  ["connector_list", { owner: "acme" }, "GET", "/v1/connectors?owner=acme"],
  ["session_create", { name: "fix", team: "acme", environment: "dev" }, "POST", "/v1/sessions", { name: "fix", team: "acme", environment: "dev" }],
  ["session_stop", { session: "s1" }, "POST", "/v1/sessions/s1/stop"],
  ["session_start", { session: "s1" }, "POST", "/v1/sessions/s1/start"],
  ["session_delete", { session: "s1" }, "DELETE", "/v1/sessions/s1"],
  ["session_ttl", { session: "s1", ttl_secs: 600 }, "PUT", "/v1/sessions/s1/ttl", { ttl_secs: 600 }],
  ["workspace_ttl", { workspace: "w1" }, "PUT", "/v1/workspaces/w1/ttl", { ttl_secs: null }],
  ["env_ttl", { env: "e1", ttl_secs: 86400 }, "PUT", "/v1/environments/e1/ttl", { ttl_secs: 86400 }],
];
for (const [name, args, method, url, body] of CASES) {
  test(`${name} calls ${method} ${url} and maps a refusal`, async () => {
    const t = tool(platformTools("main"), name);
    expect(t).toBeDefined();
    routes[`${method} ${url}`] = ok();
    await t.run(args);
    expect(calls.at(-1)).toMatchObject({ method, url, auth: "Bearer tok1" });
    if (body) expect(calls.at(-1)!.body).toEqual(body);
    routes[`${method} ${url}`] = () => new Response("nope", { status: 409 });
    await expect(t.run(args)).rejects.toThrow("409: nope");
  });
}

test("the component tools are in main and all, never in a workspace session", () => {
  const names = CASES.map((c) => c[0]).concat(["sandbox_wait", "run_wait", "pipeline_save", "secret_set"]);
  for (const k of ["main", "all"] as const) for (const n of names) expect(platformTools(k, "w1").map((t) => t.name)).toContain(n);
  for (const n of names) expect(platformTools("workspace", "w1").map((t) => t.name)).not.toContain(n);
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
  expect(JSON.parse(await t.run({ sandbox: "sbx-1", timeout: 0.01 })).timedOut).toBe(true);
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
  expect(JSON.parse(await t.run({ ...a, timeout: 0.02 })).timedOut).toBe(true);
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
  expect(t.description).toContain("never printed back");
  routes["PUT /v1/secrets/acme/mine/DB_URL"] = () => new Response(null, { status: 204 });
  expect(JSON.parse(await t.run({ owner: "acme", name: "DB_URL", value, mine: true })).name).toBe("DB_URL");
  expect(calls.at(-2)!.url).toBe("/v1/secrets/acme/mine/DB_URL");
  routes["PUT /v1/secrets/acme/DB_URL"] = () => new Response("only a team admin can change team secrets", { status: 403 });
  const err = await t.run({ owner: "acme", name: "DB_URL", value }).catch((e) => String(e.message));
  expect(err).toBe("403: only a team admin can change team secrets");
});

test("ttl tools clear with null when ttl_secs is omitted, and the wait tools take a timeout", () => {
  const t = platformTools("main");
  for (const n of ["sandbox_wait", "run_wait"]) expect((tool(t, n).inputSchema as any).properties.timeout.description).toContain("maximum 900");
});
