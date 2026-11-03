import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mcpTools } from "./local.ts";

const PLUGIN = join(import.meta.dir, "../../../laptop-plugin/plugin");
const SOURCES = join(import.meta.dir, "../../../skills");
// the skills the plugin ships, copied by laptop-plugin/sync-skills.sh (a symlink out of the plugin root does not load)
const SHIPPED = ["kloudlite", "kloudlite-automate", "kloudlite-develop", "kloudlite-verify"];
// the laptop door (`kloudlite mcp`, mcp.rs) answers these itself; the bench never serves session_use
const LAPTOP_DOOR = ["session"];
const LAPTOP_NEVER = ["workspace_ask", "task"];

const served = async () => {
  const deps = { live: new Map(), busy: new Set<string>(), open: async () => null as never, permit: async () => ({}), tasks: mkdtempSync(join(tmpdir(), "kl-plugin-")) };
  return new Set([...(await mcpTools(deps)).map((t) => t.name), ...LAPTOP_DOOR]);
};
const skills = () => readdirSync(join(PLUGIN, "skills")).map((d) => readFileSync(join(PLUGIN, "skills", d, "SKILL.md"), "utf8"));

test("the plugin ships exactly its skills, each equal to its source in skills/ (run laptop-plugin/sync-skills.sh)", () => {
  expect(readdirSync(join(PLUGIN, "skills")).sort()).toEqual(SHIPPED);
  for (const d of SHIPPED) expect(readFileSync(join(PLUGIN, "skills", d, "SKILL.md"), "utf8")).toBe(readFileSync(join(SOURCES, d, "SKILL.md"), "utf8"));
});

// Skipped until Stream C rewrites the skills to the folded tool names (plan 2026-11-04-mcp-tool-surface, Stream C step 2); re-enable there.
test.skip("every tool a laptop skill lists is one the bench serves, and none is a bench-session tool", async () => {
  const names = await served();
  // tool tables are headed `| Tool | ..` or `| Group | Tools |`; a row lists one or more tools in its first backticked cell
  // (Agent, SendMessage and `subagent_type: ..` are not bench tools; state tables are not tool tables)
  const rows = skills().flatMap((s) => {
    let tools = false;
    return s.split("\n").filter((l) => l.startsWith("|")).flatMap((l) => {
      if (l.includes("---")) return [];
      if (!l.includes("`")) tools = /^\| (Tool|Group) \|/.test(l);
      const cell = l.split("|").slice(1).find((c) => c.includes("`")) ?? "";
      return tools ? [...cell.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]!) : [];
    });
  });
  expect(rows.length).toBeGreaterThan(40);
  for (const n of rows) expect(names.has(n) ? n : `missing: ${n}`).toBe(n);
  for (const n of rows) expect(LAPTOP_NEVER).not.toContain(n);
});

test("every mcp__plugin_kloudlite_kl__ name in the plugin is one the bench serves", async () => {
  const names = await served();
  for (const text of skills())
    for (const m of text.matchAll(/mcp__plugin_kloudlite_kl__([a-z_]+)/g)) expect(names.has(m[1]!) ? m[1] : `missing: ${m[1]}`).toBe(m[1]!);
});

test("the root marketplace names the plugin, its source is the plugin dir, and the names match", () => {
  const root = join(import.meta.dir, "../../..");
  const market = JSON.parse(readFileSync(join(root, ".claude-plugin/marketplace.json"), "utf8"));
  const manifest = JSON.parse(readFileSync(join(PLUGIN, ".claude-plugin/plugin.json"), "utf8"));
  expect(market.name).toBe("kloudlite");
  expect(market.plugins.length).toBe(1);
  const entry = market.plugins[0];
  expect(entry.source.startsWith("./")).toBe(true);
  expect(join(root, entry.source)).toBe(PLUGIN);
  expect(entry.name).toBe(manifest.name);
  expect(entry.version).toBe(manifest.version);
  for (const k of ["version", "description", "author", "homepage", "repository", "keywords"]) expect(manifest[k]).toBeTruthy();
  // one marketplace only: a second file with another source would drift
  expect(existsSync(join(root, "laptop-plugin/.claude-plugin"))).toBe(false);
});
