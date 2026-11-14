import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PLUGIN = join(import.meta.dir, "plugin");
const SOURCES = join(import.meta.dir, "../skills");
// the skills the plugin ships, copied by laptop-plugin/sync-skills.sh (a symlink out of the plugin root does not load)
const SHIPPED = ["kode", "kode-automate", "kode-develop", "kode-verify"];

test("the plugin ships exactly its skills, each equal to its source in skills/ (run laptop-plugin/sync-skills.sh)", () => {
  expect(readdirSync(join(PLUGIN, "skills")).sort()).toEqual(SHIPPED);
  for (const d of SHIPPED) expect(readFileSync(join(PLUGIN, "skills", d, "SKILL.md"), "utf8")).toBe(readFileSync(join(SOURCES, d, "SKILL.md"), "utf8"));
});

test("the root marketplace names the plugin, its source is the plugin dir, and the names match", () => {
  const root = join(import.meta.dir, "..");
  const market = JSON.parse(readFileSync(join(root, ".claude-plugin/marketplace.json"), "utf8"));
  const manifest = JSON.parse(readFileSync(join(PLUGIN, ".claude-plugin/plugin.json"), "utf8"));
  expect(market.name).toBe("kode");
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
