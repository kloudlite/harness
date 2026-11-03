//! A session's own task board: one JSON file per session (`~/.kl/tasks/{session}.json`), written only
//! by that session's task tools. Messages between sessions never touch a board. No dispatcher by
//! design: the session decides what runs next, the board only records, orders (priority, then age)
//! and says what is blocked on what. Written tmp +
//! rename like asks.ts so a crash never leaves half a file.
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { resource, type ToolDef } from "@kloudlite-tui/tools";
import type { BoardTask, TaskState } from "./index.ts";

export const tasksDir = () => join(homedir(), ".kl", "tasks");
/** `session` is the BASE key ("main" or the workspace id), the part before the first `:`. */
export const tasksFile = (session: string, dir = tasksDir()) => join(dir, `${session.split(":")[0]}.json`);

const STATES: TaskState[] = ["queued", "running", "blocked", "done", "failed"];

export function readTasks(file: string): BoardTask[] {
  try {
    const v = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function write(file: string, ts: BoardTask[]): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(ts));
  renameSync(`${file}.tmp`, file);
}

/** Every session's board under `dir`: main first (always), then the others by name, empty ones skipped. */
export function readBoards(dir = tasksDir()): { session: string; tasks: BoardTask[] }[] {
  const out = [{ session: "main", tasks: readTasks(tasksFile("main", dir)) }];
  let names: string[] = [];
  try {
    names = readdirSync(dir).sort();
  } catch {}
  for (const n of names) {
    const tasks = n.endsWith(".json") && n !== "main.json" ? readTasks(join(dir, n)) : [];
    if (tasks.length) out.push({ session: n.slice(0, -5), tasks });
  }
  return out;
}

/** The path from `from` back to `to` through dependsOn, if any. */
function reach(ts: BoardTask[], from: string, to: string, seen = new Set<string>()): string[] | undefined {
  if (from === to) return [from];
  if (seen.has(from)) return undefined;
  seen.add(from);
  for (const d of ts.find((t) => t.id === from)?.dependsOn ?? []) {
    const p = reach(ts, d, to, seen);
    if (p) return [from, ...p];
  }
  return undefined;
}

/** Why `deps` cannot be the dependencies of `id` (which may not exist yet), else undefined. */
function badDeps(ts: BoardTask[], id: string, deps: string[]): string | undefined {
  for (const d of deps) if (!ts.some((t) => t.id === d)) return `error: unknown task ${d}`;
  for (const d of deps) {
    const p = reach(ts, d, id);
    if (p) return `error: ${[id, ...p].join(" -> ")} is a loop`;
  }
  return undefined;
}

export function addTask(file: string, a: { title: string; priority?: number; dependsOn?: string[]; note?: string }): BoardTask | string {
  const ts = readTasks(file);
  const id = `T${Math.max(0, ...ts.map((t) => Number(t.id.slice(1)) || 0)) + 1}`;
  const dependsOn = a.dependsOn ?? [];
  const bad = badDeps(ts, id, dependsOn);
  if (bad) return bad;
  const t: BoardTask = { id, title: a.title, priority: a.priority ?? 3, dependsOn, state: "queued", note: a.note, created: Date.now() };
  write(file, [...ts, t]);
  return t;
}

export function updateTask(file: string, id: string, p: Partial<Pick<BoardTask, "title" | "priority" | "dependsOn" | "state" | "note" | "summary" | "verified">>): BoardTask | string {
  const ts = readTasks(file);
  const cur = ts.find((t) => t.id === id);
  if (!cur) return `error: unknown task ${id}`;
  if (p.dependsOn) {
    const bad = badDeps(ts, id, p.dependsOn);
    if (bad) return bad;
  }
  const { by: _watcher, ...own } = cur; // the session's own write always wins over the watcher's mark
  const next = { ...own, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) } as BoardTask;
  write(file, ts.map((t) => (t.id === id ? next : t)));
  return next;
}

/** The board watcher's only write (watch.ts): queued -> running, marked `by: "watcher"`, and only while
 * nothing else runs. Re-reads the board so a session update that landed first is never overwritten. */
export function markRunning(file: string, id: string): boolean {
  const ts = readTasks(file);
  const cur = ts.find((t) => t.id === id);
  if (!cur || cur.state !== "queued" || ts.some((t) => t.state === "running")) return false;
  write(file, ts.map((t) => (t.id === id ? { ...t, state: "running" as const, by: "watcher" as const } : t)));
  return true;
}

/** Dependencies of `t` that are not done. A deleted dependency counts as blocking. */
export const blockers = (ts: BoardTask[], t: BoardTask): string[] => t.dependsOn.filter((d) => ts.find((x) => x.id === d)?.state !== "done");

const order = (a: BoardTask, b: BoardTask) => a.priority - b.priority || a.created - b.created;

/** Queued, unblocked tasks, best first. */
export const ready = (ts: BoardTask[]): BoardTask[] => ts.filter((t) => t.state === "queued" && !blockers(ts, t).length).sort(order);

const line = (ts: BoardTask[], t: BoardTask): string => {
  const w = blockers(ts, t);
  return `${t.id} [${t.state}]${t.by ? " (watcher)" : ""} p${t.priority} ${t.title}${w.length ? `  waits on ${w.join(", ")}` : ""}`;
};

export function boardText(ts: BoardTask[]): string {
  if (!ts.length) return "no tasks";
  const open = ts.filter((t) => t.state !== "done");
  return [...open.sort(order).map((t) => line(ts, t)), `${ts.length - open.length} done`].join("\n");
}

/** Longest `summary` the board keeps: it is replayed into a fresh session (local.ts seed). */
export const SUMMARY_MAX = 2000;

/** Why `p` may not be stored, or undefined. Only the agent's tool asks: the backend's own state moves
 * (a reply closes an ask) carry no summary and must not be refused. */
function refuseDone(cur: BoardTask | undefined, p: { state?: TaskState; summary?: string; verified?: string }): string | undefined {
  const summary = p.summary ?? cur?.summary;
  if (p.summary && p.summary.length > SUMMARY_MAX) return `error: summary is ${p.summary.length} characters, the limit is ${SUMMARY_MAX}`;
  if (p.state !== "done" || cur?.state === "done") return undefined;
  if (!summary?.trim()) return "error: a done task needs a summary: say what changed and where";
  if (!(p.verified ?? cur?.verified)?.trim()) return "error: a done task needs verified: the check that passed, with its result";
  return undefined;
}

const STR = { type: "string" };
const DEPS = { type: "array", items: STR };
const PRIORITY = { type: "integer", minimum: 0, description: "Lower runs first (default 3)." };

/** The one `task` tool over a session's own board. With `boards` (main and the laptop door) `list` can also
 * read the workspaces' boards: read only, since a message never moves a task on another session's board. */
export function taskTools(file: string, boards?: string): ToolDef[] {
  const own = !!boards;
  return [
    resource("task", "Your own task board, how the person follows your work. Actions: list, add, update. Set a task running before you start it and done as soon as its check passes.", {
      list: {
        properties: own ? { workspace: { type: "string", description: "A workspace id: show its board instead (`*` for every workspace's). You cannot change it." } } : {},
        required: [],
        async run(i: { workspace?: string }) {
          if (!boards || !i.workspace) return boardText(readTasks(file));
          const out = i.workspace !== "*"
            ? [{ workspace: i.workspace, tasks: readTasks(tasksFile(i.workspace, boards)) }]
            : readBoards(boards).filter((b) => b.session !== "main").map((b) => ({ workspace: b.session, tasks: b.tasks }));
          return JSON.stringify(out);
        },
      },
      add: {
        properties: { title: STR, priority: PRIORITY, depends_on: DEPS, note: STR },
        required: ["title"],
        async run(i: { title: string; priority?: number; depends_on?: string[]; note?: string }) {
          const r = addTask(file, { title: i.title, priority: i.priority, dependsOn: i.depends_on, note: i.note });
          return typeof r === "string" ? r : line(readTasks(file), r);
        },
      },
      update: {
        properties: { id: STR, title: STR, priority: PRIORITY, depends_on: DEPS, state: { type: "string", enum: STATES }, note: STR, summary: { type: "string", description: "Done only: what changed and where (at most 2000 characters)." }, verified: { type: "string", description: "Done only: the check that passed, with its result." } },
        required: ["id"],
        async run(i: { id: string; title?: string; priority?: number; depends_on?: string[]; state?: TaskState; note?: string; summary?: string; verified?: string }) {
          const { id, depends_on, ...rest } = i;
          const no = refuseDone(readTasks(file).find((t) => t.id === id), rest);
          if (no) return no;
          const r = updateTask(file, id, { ...rest, dependsOn: depends_on });
          return typeof r === "string" ? r : line(readTasks(file), r);
        },
      },
    }),
  ];
}
