import { expect, test } from "bun:test";
import { matchCommands } from "./slash.ts";

test("no menu for ordinary prompts", () => {
  expect(matchCommands("what is this repo")).toEqual([]);
  expect(matchCommands("")).toEqual([]);
});

test("bare slash lists everything, prefix narrows", () => {
  expect(matchCommands("/").length).toBeGreaterThan(1);
  expect(matchCommands("/cl").map((c) => c.name)).toEqual(["/clear"]);
  expect(matchCommands("/nope")).toEqual([]);
});
