import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { DiffLine, FileDiff } from "./diff.ts";

export type ChangeStatus = "M" | "A" | "D";
export type Change = { path: string; status: ChangeStatus; added: number; removed: number };

export type TreeNode = {
  name: string;
  path: string; // relative to root
  dir: boolean;
  ignored?: boolean;
  children?: TreeNode[]; // loaded lazily for dirs
};

const IGNORED = new Set(["node_modules", ".git", "dist", ".turbo", ".next", "target"]);

function run(root: string, args: string[]): string {
  const p = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  return p.exitCode === 0 ? p.stdout.toString() : "";
}

export function isGitRepo(root: string): boolean {
  return run(root, ["rev-parse", "--is-inside-work-tree"]).trim() === "true";
}

/** Changed files vs HEAD: tracked modifications/deletions + untracked as added. */
export function changes(root: string): Change[] {
  if (!isGitRepo(root)) return [];
  const out: Change[] = [];
  const stat = run(root, ["diff", "--numstat", "--relative", "HEAD", "--"]);
  for (const line of stat.split("\n")) {
    const [a, r, path] = line.split("\t");
    if (!path) continue;
    let status: ChangeStatus = "M";
    try {
      statSync(join(root, path));
    } catch {
      status = "D";
    }
    out.push({ path, status, added: Number(a) || 0, removed: Number(r) || 0 });
  }
  const untracked = run(root, ["ls-files", "--others", "--exclude-standard"]);
  for (const path of untracked.split("\n").filter(Boolean)) {
    let added = 0;
    try {
      added = readFileSync(join(root, path), "utf8").split("\n").length;
    } catch {}
    out.push({ path, status: "A", added, removed: 0 });
  }
  const order = { M: 0, A: 1, D: 2 };
  return out.sort((x, y) => order[x.status] - order[y.status] || x.path.localeCompare(y.path));
}

/** Parse `git diff` unified output into DiffLines (original-file numbering). */
function parseUnified(text: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldNo = 0;
  let first = true;
  for (const raw of text.split("\n")) {
    if (raw.startsWith("@@")) {
      const m = /@@ -(\d+)/.exec(raw);
      oldNo = m ? Number(m[1]) : 0;
      if (!first) lines.push({ no: "", sign: " ", text: "⋯" });
      first = false;
      continue;
    }
    if (raw.startsWith("diff ") || raw.startsWith("index ") || raw.startsWith("--- ") || raw.startsWith("+++ ")) continue;
    if (raw.startsWith("\\")) continue; // "\ No newline at end of file"
    if (raw === "" && lines.length === 0) continue;
    const sign = raw[0];
    const body = raw.slice(1);
    if (sign === "+") lines.push({ no: oldNo, sign: "+", text: body });
    else if (sign === "-") lines.push({ no: oldNo++, sign: "-", text: body });
    else if (sign === " ") lines.push({ no: oldNo++, sign: " ", text: body });
  }
  return lines;
}

/** Diff of one path vs HEAD (untracked → all additions). */
export function fileDiff(root: string, path: string, status: ChangeStatus): FileDiff | null {
  if (status === "A") {
    let content = "";
    try {
      content = readFileSync(join(root, path), "utf8");
    } catch {
      return null;
    }
    const ls = content.split("\n");
    return { path, lines: ls.map((text, i) => ({ no: i + 1, sign: "+", text })), added: ls.length, removed: 0 };
  }
  const out = run(root, ["diff", "--relative", "HEAD", "--", path]);
  if (!out) return null;
  const lines = parseUnified(out);
  return {
    path,
    lines,
    added: lines.filter((l) => l.sign === "+").length,
    removed: lines.filter((l) => l.sign === "-").length,
  };
}

/** Full file as context-only DiffLines; changed lines tinted when a diff exists. */
export function fullFile(root: string, path: string, diff: FileDiff | null): DiffLine[] {
  let content = "";
  try {
    content = readFileSync(join(root, path), "utf8");
  } catch {
    return [{ no: "", sign: " ", text: "(binary or unreadable)" }];
  }
  const added = new Set<string>();
  if (diff) for (const l of diff.lines) if (l.sign === "+") added.add(l.text);
  return content.split("\n").map((text, i) => ({
    no: i + 1,
    sign: added.has(text) ? "+" : " ",
    text,
  }));
}

/** One directory level of the tree, dirs first, ignored ones marked. */
export function listDir(root: string, rel: string): TreeNode[] {
  let names: string[] = [];
  try {
    names = readdirSync(join(root, rel));
  } catch {
    return [];
  }
  const nodes: TreeNode[] = names.map((name) => {
    const path = rel ? `${rel}/${name}` : name;
    let dir = false;
    try {
      dir = statSync(join(root, path)).isDirectory();
    } catch {}
    return { name, path, dir, ignored: IGNORED.has(name) };
  });
  return nodes.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
}

export function displayRoot(root: string): string {
  const home = process.env.HOME ?? "";
  return home && root.startsWith(home) ? `~${root.slice(home.length)}` : relative(process.cwd(), root) || root;
}
