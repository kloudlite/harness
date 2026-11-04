import { expect, test } from "bun:test";
import { resource } from "./actions.ts";

const t = resource("thing", "A thing.", {
  get: { properties: { id: { type: "string" } }, required: ["id"], run: async (a) => `got ${a.id}` },
  use: { properties: { env: { type: "string" } }, required: [], nulls: ["env"], run: async (a) => JSON.stringify({ env: a.env === undefined ? "kept" : a.env }) },
});

test("schema is the union with action required", () => {
  expect((t.inputSchema as any).required).toEqual(["action"]);
  expect(Object.keys((t.inputSchema as any).properties)).toEqual(["action", "id", "env"]);
});
test("unknown action names the valid ones", async () => {
  await expect(t.run({ action: "nope" })).rejects.toThrow("one of get, use");
});
test("missing required carries the action's schema", async () => {
  await expect(t.run({ action: "get" })).rejects.toThrow(/`id` is required.*"required":\["id"\]/);
});
test("good call, and null kept only where declared", async () => {
  expect(await t.run({ action: "get", id: "x" })).toBe("got x");
  expect(await t.run({ action: "use", env: null })).toBe('{"env":null}');
  expect(await t.run({ action: "use" })).toBe('{"env":"kept"}');
});
test("conflicting property schemas throw at build", () => {
  expect(() => resource("x", "d", { a: { properties: { k: { type: "string" } }, required: [], run: async () => "" }, b: { properties: { k: { type: "number" } }, required: [], run: async () => "" } })).toThrow("two schemas");
});

test("an unlisted alias is read as its key, and a 403 with missing_scope keeps both fields and says where to go", async () => {
  const a = resource("al", "x", { go: { properties: { source: { type: "string" } }, required: ["source"], alias: { snapshot_id: "source" }, run: async (x) => `src ${x.source}` } });
  expect(await a.run({ action: "go", snapshot_id: "s1" })).toBe("src s1");
  expect(Object.keys((a.inputSchema as any).properties)).not.toContain("snapshot_id");
  const b = resource("al", "x", { go: { properties: {}, required: [], run: async () => { throw new Error('403: {"error":"not in this token","missing_scope":"snapshots:delete"}'); } } });
  expect(JSON.parse((await b.run({ action: "go" }).catch((e) => e)).message)).toEqual({ error: "not in this token", missing_scope: "snapshots:delete", hint: "use the console or the CLI as yourself" });
});
