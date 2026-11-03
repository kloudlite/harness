import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mcpTools } from "../packages/backend/src/local.ts";
import { platformTools } from "../packages/tools/src/platform.ts";

// served by the laptop door itself (mcp.rs) and not by mcpTools
const DOOR = ["session_current", "session_use", "session_pick"];
// bench-only tools: no skill teaches them
const NOT_FOR_SKILLS = ["workspace_ask", "task_add", "task_update", "task_list", "workspace_tasks", "scratch_bash", "scratch_read", "scratch_write"];
test("references/tools.md lists exactly the served tools, and no other", async () => {
  const deps = { live: new Map(), busy: new Set<string>(), open: async () => null as never, permit: async () => ({}), tasks: mkdtempSync(join(tmpdir(), "kl-ref-")) };
  const tools = await mcpTools(deps);
  const served = new Set([...tools.map((t) => t.name), ...DOOR]);
  const doc = readFileSync(join(import.meta.dir, "kloudlite/references/tools.md"), "utf8");
  const named = new Set<string>();
  for (const l of doc.split("\n")) if (l.startsWith("| `") && !l.startsWith("| ---")) for (const m of l.split("|")[1]!.matchAll(/`([a-z_]+)`/g)) named.add(m[1]!);
  for (const n of named) expect(served.has(n) ? n : `unknown tool: ${n}`).toBe(n);
  // the argument names of every row are the tool's own: a name the schema lacks, or a required one the row omits, is a drift
  for (const l of doc.split("\n")) {
    if (!l.startsWith("| `") || l.startsWith("| ---")) continue;
    const cols = l.split("|");
    const args = [...(cols[2] ?? "").matchAll(/`([a-z_]+)(\?)?`/g)].map((m) => ({ name: m[1]!, optional: !!m[2] }));
    const row = [...cols[1]!.matchAll(/`([a-z_]+)`/g)].map((m) => platformTools("all").find((x) => x.name === m[1])).filter((t) => t !== undefined);
    if (!row.length) continue;
    const props = row.flatMap((t) => Object.keys((t!.inputSchema as any)?.properties ?? {})).filter((k) => k !== "because");
    for (const a of args) expect(props.includes(a.name) ? a.name : `${row[0]!.name}: tools.md lists \`${a.name}\`, the schema has ${props.join(", ")}`).toBe(a.name);
    // a row of several tools shares its arguments, so only a single-tool row must list every required one
    if (row.length === 1) for (const r of ((row[0]!.inputSchema as any)?.required ?? []).filter((k: string) => k !== "because")) expect(args.some((a) => a.name === r) ? r : `${row[0]!.name}: required \`${r}\` is not in tools.md`).toBe(r);
  }
  for (const n of served) if (!NOT_FOR_SKILLS.includes(n)) expect(named.has(n) ? n : `not in tools.md: ${n}`).toBe(n);
});

test("every tool a skill names in backticks with an underscore is in tools.md", () => {
  const doc = readFileSync(join(import.meta.dir, "kloudlite/references/tools.md"), "utf8");
  for (const s of ["kloudlite", "kloudlite-develop", "kloudlite-verify", "kloudlite-automate"]) {
    const t = readFileSync(join(import.meta.dir, s, "SKILL.md"), "utf8");
    for (const m of t.matchAll(/`((?:workspace|env|service|sandbox|pipeline|run|secret|session|volume|snapshot|process|packages|container|worktree|connector|webhook|request)_[a-z_]+)`/g))
      if (!/^(env_var|run_number)/.test(m[1]!)) expect(doc.includes(`\`${m[1]}\``) ? m[1] : `${s}: ${m[1]} not in tools.md`).toBe(m[1]!);
  }
});
