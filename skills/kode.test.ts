import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const DIR = import.meta.dir;
const PLUGIN = join(DIR, "../laptop-plugin/plugin/skills");
// the one skill an agent installs; the other folders here are the runtime's role skills
const USER = ["kode"];
const read = (...p: string[]) => readFileSync(join(DIR, ...p), "utf8");

test("the kode skill has its name, a description under 1024 chars with a Not for clause, and the size budget", () => {
  const t = read("kode", "SKILL.md");
  const fm = t.match(/^---\nname: (.+)\ndescription: (.+)\n---\n/)!;
  expect(fm[1]).toBe("kode");
  expect(fm[2]!.length).toBeLessThan(1024);
  expect(fm[2]).toContain("Not for");
  expect(t.split("\n").length).toBeLessThanOrEqual(220);
});

test("the kode skill names no skill that does not exist, and every reference file it names exists", () => {
  const t = read("kode", "SKILL.md");
  expect(t).not.toMatch(/kode-(develop|verify|automate)/);
  for (const m of t.matchAll(/`(?:references\/)?([a-z-]+\.md)`/g)) expect(existsSync(join(DIR, "kode/references", m[1]!)) ? m[1] : `missing: ${m[1]}`).toBe(m[1]!);
});

test("the plugin copies every shipped skill folder, references included, equal to its source", () => {
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)).map((x) => join(f, x)) : [f]));
  expect(readdirSync(PLUGIN).sort()).toEqual(USER);
  for (const s of readdirSync(PLUGIN)) {
    const src = join(DIR, s);
    expect(existsSync(src)).toBe(true);
    expect(walk(join(PLUGIN, s)).sort()).toEqual(walk(src).sort());
    for (const f of walk(src)) expect(readFileSync(join(PLUGIN, s, f), "utf8")).toBe(readFileSync(join(src, f), "utf8"));
  }
});
