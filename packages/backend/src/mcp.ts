//! The laptop MCP door (`kloudlite mcp`): any MCP client on the laptop gets every tool the bench
//! can reach, for every workspace and environment, with no workspace chosen up front. The client
//! sends one JSON-RPC message per `mcp` wire op (serve.ts) and gets the reply back, null for a
//! notification. Hand-rolled, not the SDK's `Server`: three methods, and the SDK wants a transport
//! this door does not have.
//!
//! No bench permission cards and no `because` here: the client's own approvals stand in for them.
import { INSTRUCTIONS, type ToolDef } from "@kloudlite-tui/tools";
import { drainNotices } from "./crash.ts";

/** Tool annotations (MCP `annotations`): hosted clients decide on them. ChatGPT asks for confirmation on
 * every tool that is not `readOnlyHint`, and Claude shows the hint beside the tool. One table of
 * (tool, action), so a tool or action added without a line here is a write that is not destructive, the
 * safe-to-ask default. A rename fails the test beside this file. */
const READ_ACTIONS: Record<string, string[]> = {
  workspace: ["list", "get", "wait"], env: ["list", "get", "wait"], session: ["current", "list"], sandbox: ["get", "list", "wait", "logs"],
  service: ["logs"], volume: ["list", "get"], pipeline: ["list", "get"], run: ["list", "get", "wait", "logs"], packages: ["list"],
  workspace_vars: ["get"], process: ["list", "output", "wait"], watch: ["poll"], task: ["list"],
};
const READ_PLAIN = new Set(["read", "glob", "grep", "builder_status", "quota", "regions", "requests_list", "request_get", "connector_list", "secret_list"]);
const DESTRUCTIVE_ACTIONS: Record<string, string[]> = {
  workspace: ["delete"], env: ["delete", "restore"], volume: ["delete"], snapshot: ["delete"], service: ["remove"], worktree: ["drop"],
  process: ["kill"], sandbox: ["delete"], pipeline: ["delete"], session: ["delete"], run: ["cancel"],
};
export const isReadOnly = (name: string, action?: string): boolean => (action === undefined ? READ_PLAIN.has(name) : !!READ_ACTIONS[name]?.includes(action));
export const isDestructive = (name: string, action?: string): boolean => (action === undefined ? name === "secret_delete" : !!DESTRUCTIVE_ACTIONS[name]?.includes(action));
/** A tool's hints cover all its actions: read-only only if every action is, destructive if any one is. */
export const annotations = (t: Pick<ToolDef, "name" | "inputSchema">) => {
  const acts: (string | undefined)[] = (t.inputSchema as any)?.properties?.action?.enum ?? [undefined];
  return { readOnlyHint: acts.every((a) => isReadOnly(t.name, a)), destructiveHint: acts.some((a) => isDestructive(t.name, a)) };
};

type Msg = { jsonrpc?: string; id?: string | number | null; method?: string; params?: any };

/** `tools()` is read on every `tools/list`; `tools/call` runs against the last list. */
export function mcpServer(tools: () => Promise<ToolDef[]>): (msg: Msg) => Promise<unknown> {
  let last: Promise<ToolDef[]> | undefined;
  const list = () => (last = tools());
  const reply = (id: Msg["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
  const fail = (id: Msg["id"], code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

  return async (msg) => {
    const { id, method, params } = msg ?? {};
    if (id === undefined || id === null) return null; // a notification (`notifications/initialized`, a cancel)
    switch (method) {
      case "initialize":
        return reply(id, { protocolVersion: params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "kl", version: "1" }, instructions: INSTRUCTIONS });
      case "ping":
        return reply(id, {});
      case "tools/list":
        return reply(id, { tools: (await list()).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: annotations(t) })) });
      case "tools/call": {
        const t = (await (last ?? list())).find((t) => t.name === params?.name);
        if (!t) return fail(id, -32602, `unknown tool: ${params?.name}`);
        // notices queued since the last answer ride on this one as a second content item, so the first is the answer or the error alone (no server push on this door)
        const content = (text: string) => {
          const n = t.name === "status" ? [] : drainNotices();
          return [{ type: "text", text }, ...(n.length ? [{ type: "text", text: `notices: ${JSON.stringify(n)}` }] : [])];
        };
        try {
          return reply(id, { content: content(await t.run(params?.arguments ?? {})) });
        } catch (e: any) {
          return reply(id, { content: content(String(e?.message ?? e)), isError: true });
        }
      }
      default:
        return fail(id, -32601, `method not found: ${method}`);
    }
  };
}
