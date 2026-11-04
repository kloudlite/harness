import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWatch, drainNotices, queueNotice, record, recentNotices } from "./crash.ts";
import { mcpServer } from "./mcp.ts";

const setup = (notifyOf = new Map<string, any>([["w1/p1", "on_failure"], ["w1/p2", "on_failure"], ["w1/s", "on_failure"]])) => {
  let procs: any[] = [];
  let ws: any = { name: "web", state: "ready", restarts: [] };
  let env: any = null;
  const out: string[] = [];
  const tick = createWatch({
    touched: new Map([["w1", 1000], ["old", 0]]),
    list: async (id) => { if (id === "old") throw new Error("must not be asked"); return procs; },
    stderr: async () => Array.from({ length: 30 }, (_, i) => `e${i}`).join("\n"),
    workspace: async () => ws,
    environment: async () => env,
    notify: (m) => out.push(m), notifyOf, now: () => 1000 + 60_000,
  });
  return { tick, out, set: (p: any[]) => (procs = p), ws: (w: any) => (ws = { ...ws, ...w }), env: (e: any) => (env = e) };
};

test("running -> exited 7 reports once with the last 20 stderr lines; a clean exit is silent", async () => {
  const w = setup();
  w.set([{ id: "p1", cmd: "sh -c 'exit 7'", state: "running", started_at: "1" }, { id: "p2", cmd: "true", state: "running", started_at: "1" }]);
  await w.tick();
  w.set([{ id: "p1", cmd: "sh -c 'exit 7'", state: "exited", exit_code: 7, started_at: "1" }, { id: "p2", cmd: "true", state: "exited", exit_code: 0, started_at: "1" }]);
  await w.tick();
  await w.tick();
  expect(w.out.length).toBe(1);
  expect(w.out[0]).toStartWith("[process p1 in web exited 7] sh -c 'exit 7'\ne10\n");
  expect(w.out[0]!.split("\n").length).toBe(21);
});

test("a plain exec that exited 1 (no registered key) is silent; never is silent; default and always report", async () => {
  const w = setup(new Map([["w1/a", "always"], ["w1/n", "never"], ["w1/q", "on_failure"]]));
  w.set([{ id: "plain", cmd: "false", state: "exited", exit_code: 1, started_at: "30" }, { id: "a", cmd: "ok", state: "exited", exit_code: 0, started_at: "30" }, { id: "n", cmd: "bad", state: "exited", exit_code: 1, started_at: "30" }, { id: "q", cmd: "bad", state: "exited", exit_code: 2, started_at: "30" }]);
  await w.tick();
  expect(w.out.map((m) => m.split("]")[0])).toEqual(["[process a in web exited 0", "[process q in web exited 2"]);
});

test("one exit is one notice: a process seen exited, running and exited again with the same started_at", async () => {
  const w = setup();
  const p = (state: string) => [{ id: "s", cmd: "x", state, exit_code: 7, started_at: "30" }];
  w.set(p("exited"));
  await w.tick();
  w.set(p("running"));
  await w.tick();
  w.set(p("exited"));
  await w.tick();
  expect(w.out.length).toBe(1);
});

test("killed_by_restart alone is reported once with the reason; a new restart folds it in with the process ids", async () => {
  const w = setup();
  w.ws({ restarts: [{ at: "2026-11-04T10:00:00Z", reason: "env-changed" }] });
  w.set([{ id: "k", cmd: "make", state: "killed_by_restart", restarted_at: "2026-11-04T10:00:00Z" }]);
  await w.tick();
  await w.tick();
  expect(w.out).toEqual(["[process k in web killed by a workspace restart at 2026-11-04T10:00:00Z, env-changed] make"]);
  w.out.length = 0;
  w.set([{ id: "k", cmd: "make", state: "killed_by_restart", restarted_at: "2026-11-04T10:05:00Z" }]);
  w.ws({ restarts: [{ at: "2026-11-04T10:00:00Z", reason: "env-changed" }, { at: "2026-11-04T10:05:00Z", reason: "requested", by: "agent", detail: "vars" }] });
  await w.tick();
  expect(w.out).toEqual(["[workspace web requested (by agent) at 2026-11-04T10:05:00Z: vars; killed processes: k]"]);
});

test("workspace and environment lifecycle: the first read baselines, later changes report", async () => {
  const w = setup();
  w.env({ name: "stage", state: "running" });
  await w.tick();
  expect(w.out).toEqual([]);
  w.ws({ state: "stopped" });
  w.env({ name: "stage", state: "stopped" });
  await w.tick();
  await w.tick();
  expect(w.out).toEqual(["[workspace web stopped]", "[environment stage stopped]"]);
  w.ws({ state: "ready", restarts: [{ at: "2026-11-04T11:00:00Z", reason: "idle-resume" }] });
  await w.tick();
  expect(w.out.at(-1)).toBe("[workspace web idle-resume at 2026-11-04T11:00:00Z]");
});

test("record keeps a delivered notice read, an undelivered one unread", () => {
  drainNotices();
  record("[delivered]", true);
  record("[queued]", false);
  expect(recentNotices()).toEqual(["[queued]"]);
  expect(recentNotices(true)).toContain("[delivered]");
});

test("queued notices ride on the next MCP tool answer, then clear", async () => {
  drainNotices();
  queueNotice("[process p in w exited 7] x");
  const mcp = mcpServer(async () => [{ name: "echo", description: "", inputSchema: { type: "object" }, run: async () => "hi" }]);
  const call = () => mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "echo" } }) as any;
  expect((await call()).result.content).toEqual([{ type: "text", text: "hi" }, { type: "text", text: 'notices: ["[process p in w exited 7] x"]' }]);
  expect((await call()).result.content).toEqual([{ type: "text", text: "hi" }]);
  queueNotice("[n]");
  const bad = mcpServer(async () => [{ name: "boom", description: "", inputSchema: { type: "object" }, run: async () => { throw new Error("409 busy"); } }]);
  const r = (await bad({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "boom" } })) as any;
  expect(r.result.content).toEqual([{ type: "text", text: "409 busy" }, { type: "text", text: 'notices: ["[n]"]' }]);
  expect(r.result.isError).toBe(true);
});

test("a queued notice appears in status once; all re-lists it", async () => {
  const { statusTool } = await import("./status.ts");
  drainNotices();
  record("[process p in w exited 9] y", false);
  queueNotice("[process p in w exited 9] y");
  const notices = async (a: object) => JSON.parse(await statusTool.run(a)).notices;
  expect(await notices({})).toEqual(["[process p in w exited 9] y"]);
  expect(await notices({})).toEqual([]);
  expect(await notices({ all: true })).toContain("[process p in w exited 9] y");
});

test("status lists the session's workspaces and their running processes by name, unioned with touched ones", async () => {
  const { statusTool } = await import("./status.ts");
  const { touched } = await import("@kloudlite-tui/tools");
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const f = join(mkdtempSync("/tmp/kl-st-"), "t");
  writeFileSync(f, "tok");
  const saved = { fetch: globalThis.fetch, url: process.env.KL_API_URL, key: process.env.KL_TOOL_KEY_FILE, ses: process.env.KL_SESSION };
  process.env.KL_API_URL = "http://api.test";
  process.env.KL_TOOL_KEY_FILE = f;
  process.env.KL_SESSION = "s1";
  touched.set("w3", Date.now());
  const j = (v: unknown) => new Response(JSON.stringify(v));
  globalThis.fetch = (async (url: string, init: any = {}) => {
    const u = String(url);
    if (u.endsWith("/v1/workspaces")) return j([{ id: "w1", name: "web", state: "ready", session: "s1" }, { id: "w2", name: "other", state: "ready", session: "s2" }]);
    if (u.endsWith("/v1/sessions/s1")) return j({ environment: null });
    const m = /\/v1\/workspaces\/(w\d)\/tools$/.exec(u);
    if (m) return j({ address: `${m[1]}:7788` });
    if (u.startsWith("http://w1:7788/tools/process_list")) return j({ processes: [{ id: "a", cmd: "dev", state: "running" }, { id: "b", state: "exited" }] });
    if (u.startsWith("http://w3:7788/tools/process_list")) return j({ processes: [{ id: "c", cmd: "q", state: "running" }] });
    return new Response("no", { status: 404 });
  }) as any;
  try {
    const r = JSON.parse(await statusTool.run({}));
    expect(r.workspaces).toEqual([{ name: "web", state: "ready" }]);
    expect(r.processes).toEqual([{ workspace: "web", id: "a", cmd: "dev" }, { workspace: "w3", id: "c", cmd: "q" }]);
  } finally {
    globalThis.fetch = saved.fetch;
    touched.delete("w3");
    for (const [k, v] of [["KL_API_URL", saved.url], ["KL_TOOL_KEY_FILE", saved.key], ["KL_SESSION", saved.ses]] as const) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
});

test("the watch persists: a restarted watch reports restarts and stops newer than the saved set", async () => {
  const { mkdtempSync, existsSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const file = join(mkdtempSync(join(tmpdir(), "kl-watch-")), ".kl", "watch.json");
  let ws: any = { name: "web", state: "ready", restarts: [{ at: "2026-11-04T10:00:00Z" }] };
  const out: string[] = [];
  const make = (touched: Map<string, number>) =>
    createWatch({ touched, list: async () => [], stderr: async () => "", workspace: async () => ws, environment: async () => null, notify: (m) => out.push(m), notifyOf: new Map(), now: () => 70_000, file });
  await make(new Map([["w1", 1000]]))();
  expect(existsSync(file)).toBe(true);
  // a new process (empty touched): the file seeds touched and the baseline, so the offline restart and stop are reported
  ws = { name: "web", state: "stopped", restarts: [{ at: "2026-11-04T10:00:00Z" }, { at: "2026-11-04T11:00:00Z", reason: "idle" }] };
  const touched = new Map<string, number>();
  await make(touched)();
  expect(touched.get("w1")).toBe(1000);
  expect(out).toEqual(["[workspace web idle at 2026-11-04T11:00:00Z]"]);
  ws = { ...ws, restarts: ws.restarts.slice(0, 2) };
  out.length = 0;
  await make(new Map())();
  expect(out).toEqual([]);
  // state change with no new restart: stopped after a persisted ready
  const f2 = join(mkdtempSync(join(tmpdir(), "kl-watch-")), "watch.json");
  const mk2 = () => createWatch({ touched: new Map([["w1", 1000]]), list: async () => [], stderr: async () => "", workspace: async () => ws, environment: async () => null, notify: (m) => out.push(m), notifyOf: new Map(), now: () => 70_000, file: f2 });
  ws = { name: "web", state: "ready", restarts: [] };
  await mk2()();
  ws = { name: "web", state: "stopped", restarts: [] };
  await mk2()();
  expect(out).toEqual(["[workspace web stopped]"]);
});

test("a session member nobody touched within the hour still gets its idle stop reported", async () => {
  const out: string[] = [];
  let members: any[] = [{ id: "w9", name: "quiet", state: "ready", restarts: [] }];
  const tick = createWatch({
    touched: new Map([["w9", 0]]),
    list: async () => { throw new Error("process_list must not be asked for an untouched member"); },
    stderr: async () => "",
    workspace: async () => { throw new Error("workspace() is only for touched members"); },
    environment: async () => null,
    members: async () => members,
    notify: (m) => out.push(m), notifyOf: new Map(), now: () => 10 * 3_600_000,
  });
  await tick(); // baseline
  members = [{ id: "w9", name: "quiet", state: "stopped", restarts: [{ at: "2026-11-04T13:48:23Z", reason: "idle", by: "system", detail: "its session was idle 30 min; starts on next use" }] }];
  await tick();
  expect(out).toEqual(["[workspace quiet idle (by system) at 2026-11-04T13:48:23Z: its session was idle 30 min; starts on next use]"]);
  await tick();
  expect(out.length).toBe(1);
});

test("the notice ring survives a daemon restart: a new createWatch lists it under all", () => {
  const dir = mkdtempSync(join(tmpdir(), "kl-notices-"));
  const deps = { touched: new Map(), list: async () => [], stderr: async () => "", workspace: async () => undefined, environment: async () => null, notify: () => {}, notifyOf: new Map(), now: () => 0, file: join(dir, "watch.json") } as any;
  createWatch(deps);
  record("[before restart]", false);
  recentNotices(); // read, so only `all` shows it after the restart
  createWatch(deps);
  expect(recentNotices()).toEqual([]);
  expect(recentNotices(true)).toContain("[before restart]");
  expect(JSON.parse(readFileSync(join(dir, "notices.json"), "utf8")).length).toBeGreaterThan(0);
});
