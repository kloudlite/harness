import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { anyPodTools, podGet, podHold, sessionHold, inflight, podTools, touched, processNotify, retryDelays } from "./pod.ts";

const realFetch = globalThis.fetch;
let log: { url: string; auth: string | null }[] = [];
let handler: (url: string, init: any) => Response | Promise<Response>;

beforeEach(() => {
  log = [];
  const f = join(mkdtempSync(join(tmpdir(), "kl-tok-")), "t");
  writeFileSync(f, "bench");
  process.env.KL_API_URL = "http://api.test";
  process.env.KL_TOOL_KEY_FILE = f;
  globalThis.fetch = (async (url: string, init: any = {}) => {
    log.push({ url: String(url), auth: init.headers?.authorization ?? null });
    return handler(String(url), init);
  }) as any;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const j = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });

test("schema comes from the pod, only for fixed names, token is sent", async () => {
  handler = (u) =>
    u.endsWith("/v1/workspaces/w1/tools") ? j({ address: "10.0.0.5:7788", token: "pt" })
    : u.endsWith("/tools") ? j({ tools: [{ name: "read", description: "Read a file", schema: { type: "object", properties: { path: {} } } }, { name: "bogus", schema: {} }] })
    : j({ ok: 1 });
  const t = await podTools("w1");
  expect(t.map((x) => x.name)).toEqual(["read"]);
  expect(t[0]!.description).toContain("Read a file");
  expect((t[0]!.inputSchema as any).properties.path).toBeDefined();
  expect(log.find((l) => l.url === "http://10.0.0.5:7788/tools")!.auth).toBe("Bearer pt");
  expect(await t[0]!.run({ path: "a" })).toBe('{\n  "ok": 1\n}');
  expect(log.at(-1)!.auth).toBe("Bearer pt");
});

test("pod not ready falls back to the permissive schema and call says not ready", async () => {
  handler = () => j({ error: "workspace not ready" }, 409);
  const t = await podTools("w1");
  expect(t.length).toBe(10);
  expect(t[0]!.inputSchema).toEqual({ type: "object", additionalProperties: true });
  await expect(t[0]!.run({})).rejects.toThrow("workspace not ready");
});

test("a network error re-fetches the address once and retries once", async () => {
  let addr = 0;
  handler = (u) => {
    if (u.endsWith("/v1/workspaces/w1/tools")) return j({ address: `10.0.0.${++addr}:7788` });
    if (u.endsWith("/tools")) return j({ tools: [] });
    if (u.startsWith("http://10.0.0.1")) throw new TypeError("connection refused");
    return j({ done: true });
  };
  const t = await podTools("w1");
  expect(await t.find((x) => x.name === "exec")!.run({ cmd: "ls" })).toContain("done");
  expect(addr).toBe(2);
  // a persistent failure gives up after the backoff is spent
  const saved = retryDelays.splice(0, 4, 0, 0, 0, 0);
  handler = () => {
    throw new TypeError("down");
  };
  await expect(t[0]!.run({})).rejects.toThrow("down");
  retryDelays.splice(0, 4, ...saved);
});

test("a restarting tool server is retried with a fresh address until it answers", async () => {
  const saved = retryDelays.splice(0, 4, 0, 0, 0, 0);
  let posts = 0;
  handler = (u) => {
    if (u.endsWith("/v1/workspaces/w1")) return j({ id: "w1" });
    if (u.endsWith("/v1/workspaces/w1/tools")) return j({ address: "10.0.0.1:7788" });
    if (u.endsWith("/tools")) return j({ tools: [] });
    if (++posts <= 2) throw new TypeError("Unable to connect");
    return j({ done: true });
  };
  const t = await podTools("w1");
  expect(await t.find((x) => x.name === "exec")!.run({ cmd: "ls" })).toContain("done");
  expect(posts).toBe(3);
  retryDelays.splice(0, 4, ...saved);
});

test("exec lists notify even when the pod gave no schema", async () => {
  handler = () => j({ error: "workspace not ready" }, 409);
  const t = await podTools("w1");
  expect((t.find((x) => x.name === "exec")!.inputSchema as any).properties.notify.enum).toEqual(["never", "on_failure", "always"]);
});

test("a timeout is never resent: the pod may still be running the first call", async () => {
  let posts = 0;
  handler = (u) => {
    if (u.endsWith("/v1/workspaces/w1")) return j({ id: "w1" });
    if (u.endsWith("/v1/workspaces/w1/tools")) return j({ address: "10.0.0.1:7788" });
    if (u.endsWith("/tools")) return j({ tools: [] });
    posts++;
    throw new DOMException("The operation timed out.", "TimeoutError");
  };
  const t = await podTools("w1");
  await expect(t.find((x) => x.name === "exec")!.run({ cmd: "go test" })).rejects.toThrow("exec: The operation timed out.");
  expect(posts).toBe(1);
});

test("a quoted timeout_ms is a number: \"300000\" + 15000 must not concatenate", async () => {
  handler = (u) => {
    if (u.endsWith("/v1/workspaces/w1/tools")) return j({ address: "10.0.0.1:7788" });
    if (u.endsWith("/tools")) return j({ tools: [] });
    return j({ exit_code: 0, stdout: "", stderr: "" });
  };
  const seen: number[] = [];
  const orig = AbortSignal.timeout;
  AbortSignal.timeout = (ms: number) => (seen.push(ms), orig.call(AbortSignal, ms));
  try {
    const t = await podTools("w1");
    await t.find((x) => x.name === "exec")!.run({ cmd: "true", timeout_ms: "300000" });
  } finally {
    AbortSignal.timeout = orig;
  }
  expect(seen).toContain(315_000);
});

test("a 4xx from a pod tool throws with tool name and status; a non-zero exit stays a result", async () => {
  handler = (u) => {
    if (u.endsWith("/v1/workspaces/w1/tools")) return j({ address: "10.0.0.1:7788" });
    if (u.endsWith("/tools")) return j({ tools: [] });
    if (u.endsWith("/tools/read")) return j({ error: "no such file" }, 404);
    return j({ exit_code: 3, stdout: "", stderr: "boom" });
  };
  const t = await podTools("w1");
  await expect(t.find((x) => x.name === "read")!.run({ path: "x" })).rejects.toThrow('read 404: no such file');
  expect(await t.find((x) => x.name === "exec")!.run({ cmd: "false" })).toContain('"exit_code": 3');
});

test("anyPodTools: schemas from the sample, each call reaches the named workspace, a stopped one says not ready", async () => {
  handler = (u) =>
    u.endsWith("/v1/workspaces/w1/tools") ? j({ address: "10.0.0.1:7788" })
    : u.endsWith("/v1/workspaces/w2/tools") ? j({ address: "10.0.0.2:7788" })
    : u.endsWith("/v1/workspaces/off/tools") ? j({ error: "workspace not ready" }, 409)
    : u.endsWith("/v1/workspaces/off") ? j({ state: "stopped" })
    : u.endsWith(":7788/tools") ? j({ tools: [{ name: "read", description: "Read a file", schema: { type: "object", properties: { path: {} }, required: ["path"] } }] })
    : j({ at: u });
  const t = await anyPodTools("w1");
  expect(t.length).toBe(10);
  const read = t.find((x) => x.name === "read")!;
  expect(read.inputSchema).toEqual({ type: "object", properties: { workspace: { type: "string", description: "The workspace id or name." }, path: {} }, required: ["workspace", "path"] });
  expect(read.description).toBe("Read a file");
  expect(await read.run({ workspace: "w2", path: "a" })).toContain("http://10.0.0.2:7788/tools/read");
  const posted = log.filter((l) => l.url.endsWith("/tools/read")).map((l) => l.url);
  expect(posted).toEqual(["http://10.0.0.2:7788/tools/read"]);
  await expect(read.run({ workspace: "off", path: "a" })).rejects.toThrow("stopped; start it with `workspace` action start");
  await expect(read.run({ path: "a" })).rejects.toThrow("workspace is required");
});

test("podFetch marks itself a watcher", async () => {
  let seen: any;
  handler = (u, init) => {
    if (u.endsWith("/tools")) return j({ address: "10.0.0.5:7788" });
    seen = init.headers;
    return j({ ok: 1 });
  };
  await podGet("w1", "/healthz");
  expect(seen["x-kl-watch"]).toBe("1");
});

test("a tool call that hits NotReady wakes and retries once", async () => {
  let lookups = 0;
  handler = (u) => {
    if (u.endsWith("/v1/workspaces/w1/tools")) return ++lookups <= 2 ? j({ error: "idle" }, 409) : j({ address: "10.0.0.5:7788" });
    return j({ ok: 1 });
  };
  let woke = 0;
  const t = await podTools("w1", { ensure: (async () => void woke++) as any });
  expect(await t[0]!.run({})).toBe('{\n  "ok": 1\n}');
  expect(woke).toBe(1);
  expect(touched.has("w1")).toBe(true);
});

test("podHold never wakes", async () => {
  handler = () => j({ error: "idle" }, 409);
  await podHold("w1");
  expect(log.some((l) => l.url.includes("/hold"))).toBe(false);
});

test("podHold posts /hold to a ready workspace", async () => {
  handler = (u) => (u.endsWith("/tools") && u.includes("/v1/") ? j({ address: "10.0.0.5:7788" }) : new Response(null, { status: 204 }));
  await podHold("w1");
  expect(log.at(-1)!.url).toBe("http://10.0.0.5:7788/hold");
});

test("sessionHold posts the session's hold and nothing for a bench-less process", async () => {
  handler = () => new Response(null, { status: 204 });
  await sessionHold("ses-1");
  expect(log.at(-1)!.url).toBe("http://api.test/v1/sessions/ses-1/hold");
  log = [];
  await sessionHold(undefined);
  expect(log).toEqual([]);
  handler = () => j({ error: "no" }, 500);
  await sessionHold("ses-1"); // best effort: a failure is dropped, never thrown
});

test("a second NotReady after the wake throws: one retry only", async () => {
  handler = () => j({ error: "idle" }, 409);
  let woke = 0;
  const t = await podTools("w1", { ensure: (async () => void woke++) as any });
  await expect(t[0]!.run({})).rejects.toThrow("workspace not ready");
  expect(woke).toBe(1);
});

test("an ensure failure surfaces instead of the NotReady", async () => {
  handler = () => j({ error: "idle" }, 409);
  const t = await podTools("w1", { ensure: (async () => { throw new Error("w1 is stopped; start it with `workspace` action start"); }) as any });
  await expect(t[0]!.run({})).rejects.toThrow("action start");
});

test("call() is activity: no x-kl-watch header, and inflight returns to empty", async () => {
  let seen: any;
  handler = (u, init) => {
    if (u.endsWith("/v1/workspaces/w1/tools")) return j({ address: "10.0.0.5:7788" });
    if (u.includes("/tools/")) seen = init.headers;
    return j({ ok: 1 });
  };
  const t = await podTools("w1");
  await t[0]!.run({});
  expect(seen["x-kl-watch"]).toBeUndefined();
  expect(inflight.has("w1")).toBe(false);
});

test("the client waits longer than the tool, whichever spelling the timeout has", async () => {
  const { waitMs } = await import("./pod.ts");
  expect(waitMs({ timeout_ms: "600000" }, 1)).toBe(600_000);
  expect(waitMs({ timeout: 300 }, 1)).toBe(300_000);
  expect(waitMs({ timeout_s: 30 }, 1)).toBe(30_000);
  expect(waitMs({ max_wait_ms: 7000 }, 1)).toBe(7000);
  expect(waitMs({ timeout_ms: "2m" }, 120_000)).toBe(120_000);
  expect(waitMs({}, 120_000)).toBe(120_000);
});

test("process and watch fold the pod's per-verb tools; patch and process_close_stdin are not tools of the harness", async () => {
  const obj = (properties: object, required: string[] = []) => ({ type: "object", properties, required });
  handler = (u) =>
    u.endsWith("/v1/workspaces/w1/tools") ? j({ address: "10.0.0.5:7788" })
    : u.endsWith("/tools") ? j({ tools: [
        { name: "patch", description: "p", schema: obj({ diff: {} }) },
        { name: "process_wait", description: "w", schema: obj({ id: { type: "string", description: "wait id" }, since: { type: "integer" } }, ["id"]) },
        { name: "process_output", description: "o", schema: obj({ id: { type: "string", description: "output id" } }, ["id"]) },
        { name: "process_close_stdin", description: "c", schema: obj({ id: { type: "string" } }, ["id"]) },
        { name: "watch", description: "s", schema: obj({ paths: {} }) },
        { name: "watch_poll", description: "p", schema: obj({ id: { type: "string" } }, ["id"]) },
      ] })
    : j({ ok: 1 });
  const t = await podTools("w1");
  expect(t.map((x) => x.name)).toEqual(["process", "watch"]);
  const proc = t[0]!;
  expect((proc.inputSchema as any).properties.action.enum).toEqual(["output", "wait", "close_stdin"]);
  await proc.run({ action: "wait", id: "p1", since: 3 });
  expect(log.at(-1)!.url).toBe("http://10.0.0.5:7788/tools/process_wait");
  await expect(proc.run({ action: "wait" })).rejects.toThrow("`id` is required");
  await t[1]!.run({ action: "poll", id: "w1" });
  expect(log.at(-1)!.url).toBe("http://10.0.0.5:7788/tools/watch_poll");
});

test("exec takes notify, keeps it per process id and does not forward it; container_build maps a missing registry", async () => {
  const bodies: any[] = [];
  let stderr = "";
  handler = (u, init) => {
    if (u.endsWith("/v1/workspaces/w1/tools")) return j({ address: "10.0.0.5:7788" });
    if (u.endsWith("/tools")) return j({ tools: [{ name: "exec", schema: { type: "object", properties: { cmd: {} } } }, { name: "container_build", schema: { type: "object" } }] });
    if (u.endsWith("/v1/connectors")) return j([{ name: "hub", kind: "registry" }, { name: "gh", kind: "git" }]);
    bodies.push(JSON.parse(init.body));
    return u.endsWith("/tools/exec") ? j({ id: "p7" }) : j({ exit_code: 1, stderr });
  };
  const t = await podTools("w1");
  const exec = t.find((x) => x.name === "exec")!;
  expect((exec.inputSchema as any).properties.notify.enum).toEqual(["never", "on_failure", "always"]);
  await exec.run({ cmd: "sleep 3", detach: true, notify: "always" });
  expect(bodies[0]).toEqual({ cmd: "sleep 3", detach: true });
  expect(processNotify.get("w1/p7")).toBe("always");
  const build = t.find((x) => x.name === "container_build")!;
  stderr = "kl: no registry is configured";
  expect(JSON.parse((await build.run({}).catch((e) => e)).message)).toEqual({ error: "no_registry", hint: "connect one in the console under Connectors", registries: ["hub"] });
  stderr = "kl: no registry named nope; connected: hub";
  expect(JSON.parse((await build.run({}).catch((e) => e)).message)).toEqual({ error: "unknown_registry", registry: "nope", registries: ["hub"] });
});

test("a workspace spelled by name is keyed by its id; a detached exec defaults to on_failure; a killed process goes quiet", async () => {
  handler = (u) => {
    if (u.endsWith("/v1/workspaces/web-app")) return j({ id: "w9" });
    if (u.endsWith("/v1/workspaces/web-app/tools")) return j({ address: "10.0.0.5:7788" });
    if (u.endsWith("/tools")) return j({ tools: [] });
    return u.endsWith("/tools/exec") ? j({ id: "p1" }) : j({});
  };
  const t = await podTools("web-app");
  await t.find((x) => x.name === "exec")!.run({ cmd: "sleep 9", detach: true });
  expect(touched.has("w9")).toBe(true);
  expect(touched.has("web-app")).toBe(false);
  expect(processNotify.get("w9/p1")).toBe("on_failure");
  await t.find((x) => x.name === "process")!.run({ action: "kill", id: "p1" });
  expect(processNotify.get("w9/p1")).toBe("never");
});
