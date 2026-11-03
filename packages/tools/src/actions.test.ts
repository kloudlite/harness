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
