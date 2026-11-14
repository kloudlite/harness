import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const DIR = import.meta.dir;
const PLUGIN = join(DIR, "../laptop-plugin/plugin/skills");
const TASK = ["kode-develop", "kode-verify", "kode-automate"];
const USER = ["kode", ...TASK];
const read = (...p: string[]) => readFileSync(join(DIR, ...p), "utf8");
const rows = (file: string) => read("evals", file).split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| ---") && !l.startsWith("|---")).slice(1);
const cells = (l: string) => l.slice(2, -2).split(" | ");

test("every scenario heading of the three task skills is in evals/scenarios.md", () => {
  const sc = read("evals", "scenarios.md");
  let n = 0;
  for (const s of TASK)
    for (const m of read(s, "SKILL.md").matchAll(/^### (\d+\. .+)$/gm)) {
      n++;
      expect(sc.includes(`${s} ${m[1]}`) ? m[1] : `missing: ${s} ${m[1]}`).toBe(m[1]!);
    }
  expect(n).toBe(18 + 7 + 17);
});

test("every row of routing.md names one of the four skills or base, and about sixty prompts", () => {
  const r = rows("routing.md");
  expect(r.length).toBeGreaterThanOrEqual(60);
  for (const l of r) {
    const c = cells(l);
    expect(c.length).toBe(3);
    expect(["base", ...TASK]).toContain(c[1]!);
    expect(c[2]!.length).toBeGreaterThan(0);
  }
  for (const s of TASK) expect(r.some((l) => cells(l)[1] === s)).toBe(true);
});

test("every task skill scenario is reachable from a routing row of its skill", () => {
  const r = rows("routing.md");
  expect(r.filter((l) => cells(l)[1] === "base").length).toBeGreaterThanOrEqual(10);
});

test("the first trigger phrase of every task skill scenario is a routing prompt of that skill", () => {
  const r = rows("routing.md").map(cells);
  const missing: string[] = [];
  for (const s of TASK)
    for (const sec of read(s, "SKILL.md").split(/^### /m).slice(1)) {
      const head = sec.split("\n")[0]!;
      const first = sec.match(/\*\*Trigger:\*\*[^"]*"([^"]+)"/)?.[1]?.toLowerCase();
      if (!first) continue;
      if (!r.some((c) => c[1] === s && (c[0]!.toLowerCase().includes(first) || first.includes(c[0]!.toLowerCase())))) missing.push(`${s} ${head}: "${first}"`);
    }
  expect(missing).toEqual([]);
});

test("each user-facing skill has name, a description under 1024 chars with a Not for clause, and the size budget", () => {
  const budget: Record<string, number> = { kode: 220 };
  for (const s of USER) {
    const t = read(s, "SKILL.md");
    const fm = t.match(/^---\nname: (.+)\ndescription: (.+)\n---\n/)!;
    expect(fm[1]).toBe(s);
    expect(fm[2]!.length).toBeLessThan(1024);
    expect(fm[2]).toContain("Not for");
    expect(t.split("\n").length).toBeLessThanOrEqual(budget[s] ?? 300);
    if (s !== "kode") expect(t).toContain("Read the `kode` skill first");
  }
});

test("only the base skill defines a component", () => {
  for (const s of TASK) expect(read(s, "SKILL.md")).not.toMatch(/^\d\. \*\*(Workspace|Environment|Desk|Intercept|Capsule|Volume|Pipeline|Connector)\.\*\*/m);
});

test("the plugin copies every shipped skill folder, references included, equal to its source", () => {
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)).map((x) => join(f, x)) : [f]));
  for (const s of readdirSync(PLUGIN)) {
    const src = join(DIR, s);
    expect(existsSync(src)).toBe(true);
    expect(walk(join(PLUGIN, s)).sort()).toEqual(walk(src).sort());
    for (const f of walk(src)) expect(readFileSync(join(PLUGIN, s, f), "utf8")).toBe(readFileSync(join(src, f), "utf8"));
  }
});
