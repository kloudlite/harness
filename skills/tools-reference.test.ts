import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mcpTools } from "../packages/backend/src/local.ts";

// served by the laptop door itself (mcp.rs) and not by mcpTools
const DOOR = ["session_current", "session_use", "session_pick"];
// bench-only tools: no skill teaches them
const NOT_FOR_SKILLS = ["workspace_ask", "task_add", "task_update", "task_list", "workspace_tasks", "scratch_bash", "scratch_read", "scratch_write"];
// spec section 9 names that may be listed before they are served
const PLANNED = ["sandbox_create", "sandbox_get", "sandbox_wait", "sandbox_logs", "sandbox_list", "sandbox_terminate", "sandbox_delete",
  "pipeline_list", "pipeline_get", "pipeline_save", "pipeline_versions", "pipeline_delete", "run_start", "run_list", "run_get", "run_wait", "run_logs", "run_cancel", "webhook_rotate",
  "secret_set", "secret_list", "secret_delete", "workspace_env_set", "connector_list", "session_create", "session_stop", "session_start", "session_delete", "session_ttl", "workspace_ttl", "env_ttl", "workspace_restart", "service_restart"];

test("references/tools.md lists exactly the served tools, plus the planned ones of the spec", async () => {
  const deps = { live: new Map(), busy: new Set<string>(), open: async () => null as never, permit: async () => ({}), tasks: mkdtempSync(join(tmpdir(), "kl-ref-")) };
  const served = new Set([...(await mcpTools(deps)).map((t) => t.name), ...DOOR]);
  const doc = readFileSync(join(import.meta.dir, "kloudlite/references/tools.md"), "utf8");
  const named = new Set<string>();
  for (const l of doc.split("\n")) if (l.startsWith("| `") && !l.startsWith("| ---")) for (const m of l.split("|")[1]!.matchAll(/`([a-z_]+)`/g)) named.add(m[1]!);
  for (const n of named) expect(served.has(n) || PLANNED.includes(n) ? n : `unknown tool: ${n}`).toBe(n);
  for (const n of served) if (!NOT_FOR_SKILLS.includes(n)) expect(named.has(n) ? n : `not in tools.md: ${n}`).toBe(n);
  for (const n of PLANNED) expect(named.has(n) ? n : `planned but not in tools.md: ${n}`).toBe(n);
});

test("every tool a skill names in backticks with an underscore is in tools.md", () => {
  const doc = readFileSync(join(import.meta.dir, "kloudlite/references/tools.md"), "utf8");
  for (const s of ["kloudlite", "kloudlite-develop", "kloudlite-verify", "kloudlite-automate"]) {
    const t = readFileSync(join(import.meta.dir, s, "SKILL.md"), "utf8");
    for (const m of t.matchAll(/`((?:workspace|env|service|sandbox|pipeline|run|secret|session|volume|snapshot|process|packages|container|worktree|connector|webhook|request)_[a-z_]+)`/g))
      if (!/^(env_var|run_number)/.test(m[1]!)) expect(doc.includes(`\`${m[1]}\``) ? m[1] : `${s}: ${m[1]} not in tools.md`).toBe(m[1]!);
  }
});
