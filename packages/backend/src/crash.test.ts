import { expect, test } from "bun:test";
import { createWatch, drainNotices, queueNotice } from "./crash.ts";
import { mcpServer } from "./mcp.ts";

const setup = (notifyOf = new Map<string, any>()) => {
  let procs: any[] = [];
  const out: string[] = [];
  const tick = createWatch({
    touched: new Map([["w1", 1000], ["old", 0]]),
    list: async (ws) => { if (ws === "old") throw new Error("must not be asked"); return procs; },
    stderr: async () => Array.from({ length: 30 }, (_, i) => `e${i}`).join("\n"),
    restarts: async () => [{ at: "2026-11-04T10:00:30Z", reason: "env-changed" }],
    notify: (m) => out.push(m), notifyOf, now: () => 1000 + 60_000,
  });
  return { tick, out, set: (p: any[]) => (procs = p) };
};

test("running -> exited 7 reports once with the last 20 stderr lines; a clean exit is silent", async () => {
  const w = setup();
  w.set([{ id: "p1", cmd: "sh -c 'exit 7'", state: "running" }, { id: "p2", cmd: "true", state: "running" }]);
  await w.tick();
  w.set([{ id: "p1", cmd: "sh -c 'exit 7'", state: "exited", exit_code: 7 }, { id: "p2", cmd: "true", state: "exited", exit_code: 0 }]);
  await w.tick();
  await w.tick();
  expect(w.out.length).toBe(1);
  expect(w.out[0]).toStartWith("[process p1 in w1 exited 7] sh -c 'exit 7'\ne10\n");
  expect(w.out[0]!.split("\n").length).toBe(21);
});

test("notify always reports a clean exit, never stays silent; an exec seen first when already exited still reports", async () => {
  const w = setup(new Map([["w1/a", "always"], ["w1/n", "never"], ["w1/q", "on_failure"]]));
  w.set([{ id: "a", cmd: "ok", state: "exited", exit_code: 0 }, { id: "n", cmd: "bad", state: "exited", exit_code: 1 }, { id: "q", cmd: "bad", state: "exited", exit_code: 2 }]);
  await w.tick();
  expect(w.out.map((m) => m.split("]")[0])).toEqual(["[process a in w1 exited 0", "[process q in w1 exited 2"]);
});

test("killed_by_restart is reported once, with the reason when within a minute", async () => {
  const w = setup();
  w.set([{ id: "k", cmd: "make", state: "killed_by_restart", restarted_at: "2026-11-04T10:00:00Z" }]);
  await w.tick();
  await w.tick();
  expect(w.out).toEqual(["[process k in w1 killed by a workspace restart at 2026-11-04T10:00:00Z, env-changed] make"]);
});

test("queued notices ride on the next MCP tool answer, then clear", async () => {
  drainNotices();
  queueNotice("[process p in w exited 7] x");
  const mcp = mcpServer(async () => [{ name: "echo", description: "", inputSchema: { type: "object" }, run: async () => "hi" }]);
  const call = () => mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "echo" } }) as any;
  expect((await call()).result.content[0].text).toBe('notices: ["[process p in w exited 7] x"]\nhi');
  expect((await call()).result.content[0].text).toBe("hi");
});
