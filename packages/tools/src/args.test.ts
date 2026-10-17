import { expect, test } from "bun:test";
import { checkArgs } from "./args.ts";
import { def, httpError, platformTools } from "./platform.ts";
import { scratchTools } from "./scratch.ts";
import { webFetch } from "./web.ts";

const schema = {
  type: "object",
  properties: {
    workspace: { type: "string" },
    packages: { type: "array", items: { type: "string" } },
    service: { type: "object" },
    n: { type: "integer" },
    on: { type: "boolean" },
    state: { type: "string", enum: ["open", "closed"] },
    cmd: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
  },
  required: ["workspace"],
};

test("absent, wrong type and unknown keys each get their own sentence", () => {
  expect(checkArgs(schema, {})).toEqual({ error: "`workspace` is required" });
  expect(checkArgs(schema, { workspace: 5 })).toEqual({ error: "`workspace` must be string; got number" });
  expect(checkArgs(schema, { workspace: "w", packages: "x y" })).toEqual({ error: "`packages` must be array; got string" });
  expect(checkArgs(schema, { workspace: "w", state: "all" })).toEqual({ error: '`state` must be one of open, closed; got "all"' });
  const e = checkArgs(schema, { id: "ws-1" }) as { error: string };
  expect(e.error).toContain("unknown argument `id`; this tool takes workspace, packages");
  expect(e.error).toContain("`workspace` required");
});

test("a JSON-encoded array or object, a numeric string and a quoted flag are coerced", () => {
  const c = checkArgs(schema, { workspace: "w", packages: '["a","b"]', service: '{"name":"x"}', n: "5", on: "true" }) as { args: any };
  expect(c.args).toEqual({ workspace: "w", packages: ["a", "b"], service: { name: "x" }, n: 5, on: true });
  expect((checkArgs(schema, { workspace: "w", cmd: "ls -la" }) as any).args.cmd).toBe("ls -la");
  expect((checkArgs(schema, { workspace: "w", n: "2m" }) as any).error).toBe("`n` must be integer; got string");
});

test("a platform tool refuses before its handler runs", async () => {
  let ran = false;
  const t = def("t", "d", { workspace: { type: "string" } }, ["workspace"], async () => ((ran = true), "ok"));
  await expect(t.run({ id: "ws-1" })).rejects.toThrow("unknown argument `id`");
  await expect(t.run({})).rejects.toThrow("`workspace` is required");
  expect(ran).toBe(false);
  expect(await t.run({ workspace: "w" })).toBe("ok");
});

test("service tools say what a flat call lacked, and take a JSON-string array", async () => {
  const tools = platformTools("all");
  const upd = tools.find((t) => t.name === "service_update")!;
  await expect(upd.run({ env: "env-1", name: "api", image: "x:1" })).rejects.toThrow("unknown argument `name`, `image`");
  const add = tools.find((t) => t.name === "packages_add")!;
  // past the check (a string became an array) the call fails only on the missing api url
  await expect(add.run({ workspace: "ws-1", packages: '["git"]' })).rejects.toThrow("platform tools unavailable");
  const pr = tools.find((t) => t.name === "pr_list")!;
  await expect(pr.run({ owner: "o", name: "n", state: "all" })).rejects.toThrow("must be one of open, merged, closed");
});

test("env_wait takes seconds or milliseconds", () => {
  const w = platformTools("main").find((t) => t.name === "env_wait")!;
  expect(Object.keys((w.inputSchema as any).properties)).toEqual(expect.arrayContaining(["timeout", "timeout_ms"]));
});

test("an HTML error page is a status line and plain text, not markup", () => {
  const html = "<!DOCTYPE html><html><head><title>x</title><style>a{}</style></head><body><h1>Not  Found</h1><p>nope</p></body></html>";
  expect(httpError(404, html)).toBe("404 Not Found: x Not Found nope");
  expect(httpError(404, "<html>" + "y".repeat(500)).length).toBe("404 Not Found: ".length + 200);
  expect(httpError(409, '{"error":"busy"}')).toBe('409: {"error":"busy"}');
  expect(httpError(502, "<html></html>")).toBe("502 Bad Gateway");
});

test("scratch bash without a command is refused, not run empty", async () => {
  const bash = scratchTools("/tmp/kl-args-test").find((t) => t.name === "bash")!;
  expect(await bash.run({})).toBe("error: `command` is required");
  expect(await bash.run({ cmd: "ls" })).toContain("unknown argument `cmd`");
});

test("web_fetch names a missing url and takes max_chars", async () => {
  expect(await webFetch.run({})).toBe("error: `url` is required");
  expect(await webFetch.run({ url: "ftp://x", max_chars: 3 })).toContain("not an http(s) URL");
});

test("a minimum is held", () => {
  expect((checkArgs({ type: "object", properties: { p: { type: "integer", minimum: 0 } } }, { p: -1 }) as any).error).toBe("`p` must be at least 0; got -1");
});
