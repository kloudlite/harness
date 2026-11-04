// Prints the tool schemas the agent runtime (bins/runtime/src/tools) serves, as JSON on stdout:
// `bun scripts/dump-schemas.ts > ../bins/runtime/tests/fixtures/tool-schemas.json`. The runtime's
// conformance test holds its registry to this file, so the skills' tool tables stay true.
// The set is the laptop door's (`mcpTools` in packages/backend/src/local.ts) without its
// backend-bound tools (status, task, delegate): every platform tool aimed by `workspace`/`env`,
// every pod tool aimed by `workspace`, the scratch shell, and `read`/`write` that also take a
// `scratch:` path. Pod schemas are the offline fallback (no workspace to sample), as `anyPodTools()` builds them.
import { anyPodTools, platformTools, scratchRoot, scratchTools, webFetch, webSearch, type ToolDef } from "../packages/tools/src/index.ts";

const pod = await anyPodTools();
const scratch = scratchTools(scratchRoot("main"));
const withScratch = (t: ToolDef): ToolDef => {
  const s: any = t.inputSchema;
  return { ...t, description: `${t.description} A \`scratch:\` path is the session's scratch folder.`, inputSchema: { ...s, required: (s.required ?? []).filter((n: string) => n !== "workspace") } };
};
const tools: ToolDef[] = [
  webFetch,
  webSearch,
  ...pod.map((t) => (t.name === "read" || t.name === "write" ? withScratch(t) : t)),
  ...platformTools("all"),
  ...scratch.filter((t) => t.name === "bash").map((t) => ({ ...t, name: "scratch_bash", description: "Run a shell command in this session's scratch folder, not a workspace. The network works; no credentials. Returns { output, exit_code } (last 50 KiB)." })),
];
console.log(JSON.stringify(tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })), null, 2));
