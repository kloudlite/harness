import { expect, test } from "bun:test";
import { parseCard } from "./card.ts";

test("parses kind, main desk and drops the board line", () => {
  expect(parseCard("[from w1] question: which db?\nboard: T1")).toEqual({ from: "w1", kind: "question", body: "which db?" });
  expect(parseCard("[from main desk] do T2")).toEqual({ from: "main", kind: undefined, body: "do T2" });
  expect(parseCard("hello [from x]")).toBeNull();
});
