import { expect, test } from "bun:test";
import { INSTRUCTIONS } from "./instructions.ts";

test("instructions stay small enough to copy into both doors", () => {
  expect(INSTRUCTIONS.length).toBeLessThan(1200);
});
