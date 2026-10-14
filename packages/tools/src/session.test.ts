import { expect, test } from "bun:test";
import { decide } from "./session.ts";

const a = { id: "s-a", name: "a", environment: "env-1" };
const b = { id: "s-b", name: "b", environment: "env-2" };
const e1 = { id: "env-1", name: "one" };
const e2 = { id: "env-2", name: "two" };

test("saved wins when it is still mine", () => expect(decide([a, b], "s-b", [], [])).toEqual({ use: "s-b", how: "saved" }));
test("saved but gone falls through to the only session", () => expect(decide([a], "s-zzz", [], [])).toEqual({ use: "s-a", how: "only" }));
test("saved but gone with several asks", () => expect(decide([a, b], "s-zzz", [], [])).toEqual({ choose: [a, b] }));
test("one session is used", () => expect(decide([a], undefined, [], [])).toEqual({ use: "s-a", how: "only" }));
test("several sessions ask", () => expect(decide([a, b], undefined, [], [])).toEqual({ choose: [a, b] }));
test("none: create on the followed environment of the team", () =>
  expect(decide([], undefined, [{ team: "t", environment: "env-2" }, { team: "u", environment: "env-1" }], [], "t")).toEqual({ create: "env-2" }));
test("none, nothing followed, one environment: create there", () => expect(decide([], undefined, [], [e1])).toEqual({ create: "env-1" }));
test("none, nothing followed, several environments: choose_environment", () =>
  expect(decide([], undefined, [], [e1, e2])).toEqual({ choose_environment: [e1, e2] }));
