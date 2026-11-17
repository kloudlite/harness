import { expect, test } from "bun:test";
import { askFor, baseOf, workerKeys } from "./desks.ts";

const a = (key: string, n: number) => ({ key, n });

test("baseOf names the conversation a key belongs to", () => {
  expect(baseOf("main")).toBe("main");
  expect(baseOf("main:x")).toBe("main");
  expect(baseOf("fix-login")).toBe("fix-login");
  expect(baseOf("ws-a")).toBe("ws-a");
  expect(baseOf("ws-a:agent-1f")).toBe("ws-a");
});

test("an ask shows only in its own workspace's view, oldest first", () => {
  const asks = [a("ws-a", 1), a("main", 2), a("ws-a:agent-1", 3)];
  expect(askFor(asks, "main")?.n).toBe(2);
  expect(askFor([a("ws-a", 1), a("ws-a:agent-1", 3)], "main")).toBeUndefined();
  expect(askFor(asks, "ws-a")?.n).toBe(1);
  expect(askFor(asks.slice(1), "ws-a")?.n).toBe(3);
  expect(askFor(asks, "ws-a:other")?.n).toBe(1);
});

test("workers are every key but the coordinator's, old workspace and agent keys included", () => {
  expect(workerKeys(["main", "main:b", "fix-login", "api-tests", "fix-login", "ws-a", "ws-a:agent-1f", ""])).toEqual([
    "api-tests",
    "fix-login",
    "ws-a",
    "ws-a:agent-1f",
  ]);
  expect(workerKeys(["main"])).toEqual([]);
});
