import { expect, test } from "bun:test";
import { INSTRUCTIONS } from "./instructions.ts";

test("instructions stay small enough to copy into both doors", () => {
  expect(INSTRUCTIONS.length).toBeLessThan(1200);
});

test("instructions name the one wait vocabulary", () => {
  for (const w of ["timeout_ms", "soft_ms", "promoted", "kind", "timed_out", "scratch:"]) expect(INSTRUCTIONS).toContain(w);
});
