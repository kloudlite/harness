import { expect, test } from "bun:test";
import { INSTRUCTIONS } from "@kloudlite-tui/tools";
import { annotations, isDestructive, isReadOnly, mcpServer } from "./mcp.ts";

const echo = { name: "echo", description: "Say it back", inputSchema: { type: "object" }, run: async (i: any) => `said ${i.text}` };
const boom = { name: "boom", description: "Fails", inputSchema: { type: "object" }, run: async () => { throw new Error("no such workspace"); } };

test("initialize, list, call, failures and notifications", async () => {
  const mcp = mcpServer(async () => [echo, boom]);
  expect(await mcp({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } })).toEqual({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "kl", version: "1" }, instructions: INSTRUCTIONS } });
  expect(await mcp({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
  expect(((await mcp({ jsonrpc: "2.0", id: 2, method: "tools/list" })) as any).result.tools.map((t: any) => t.name)).toEqual(["echo", "boom"]);
  expect(await mcp({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "echo", arguments: { text: "hi" } } })).toEqual({ jsonrpc: "2.0", id: 3, result: { content: [{ type: "text", text: "said hi" }] } });
  expect(await mcp({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "boom" } })).toEqual({ jsonrpc: "2.0", id: 4, result: { content: [{ type: "text", text: "no such workspace" }], isError: true } });
  expect(((await mcp({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "nope" } })) as any).error.code).toBe(-32602);
  expect(((await mcp({ jsonrpc: "2.0", id: 6, method: "resources/list" })) as any).error.code).toBe(-32601);
});

const resource = (name: string, actions: string[]) => ({ ...echo, name, inputSchema: { type: "object", properties: { action: { enum: actions } } } });

test("tools/list carries annotations per tool, folded over its actions", async () => {
  const mcp = mcpServer(async () => [{ ...echo, name: "read" }, resource("workspace", ["list", "get", "delete"]), resource("env", ["list", "get", "wait"]), { ...echo, name: "workspace_vars" }, { ...echo, name: "secret_delete" }]);
  const tools = ((await mcp({ jsonrpc: "2.0", id: 1, method: "tools/list" })) as any).result.tools;
  expect(tools.map((t: any) => t.annotations)).toEqual([
    { readOnlyHint: true, destructiveHint: false },
    { readOnlyHint: false, destructiveHint: true },
    { readOnlyHint: true, destructiveHint: false },
    { readOnlyHint: false, destructiveHint: false },
    { readOnlyHint: false, destructiveHint: true },
  ]);
  expect(annotations({ name: "anything-new", inputSchema: {} })).toEqual({ readOnlyHint: false, destructiveHint: false });
});

test("the predicates read the action: delete, kill, cancel and restore are destructive, none of them read-only", () => {
  for (const [n, a] of [["workspace", "delete"], ["env", "delete"], ["env", "restore"], ["volume", "delete"], ["snapshot", "delete"], ["service", "remove"], ["worktree", "drop"], ["process", "kill"], ["sandbox", "delete"], ["pipeline", "delete"], ["session", "delete"], ["run", "cancel"]] as const) {
    expect(isDestructive(n, a)).toBe(true);
    expect(isReadOnly(n, a)).toBe(false);
  }
  expect(isDestructive("secret_delete")).toBe(true);
  expect(isDestructive("workspace", "stop")).toBe(false);
  expect(isReadOnly("process", "wait")).toBe(true);
});
