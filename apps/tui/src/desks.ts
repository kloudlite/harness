import type { Entry } from "./components/Transcript.tsx";
import { DEFAULT_MODEL, type ModelRef } from "./models.ts";

/**
 * One conversation per key, of two kinds: the COORDINATOR (`main`, and named
 * ones `main:<id>`), which talks to the person and plans, and WORKERS, keyed by
 * the name the coordinator gave them when it started them (`worker_ask`). A
 * workspace is a tool either kind uses, never a conversation of its own.
 * Turns keep running in whichever conversation started them, regardless of
 * what the user is currently looking at.
 */
export type Desk = {
  entries: Entry[];
  /**
   * The persisted transcript has been read off disk. Until then an empty
   * `entries` means "not loaded yet", not "nothing to show" — rendering the
   * welcome screen on that guess flashed it over every reloaded desk.
   */
  restored?: boolean;
  busy: boolean;
  context?: { tokens: number | null; window: number };
  /** Prompts submitted in this desk, oldest first (↑/↓ recall). */
  history: string[];
  model: ModelRef;
  /**
   * Steering / follow-up prompts queued while the agent streams, in delivery
   * order. `kind` decides which SDK queue an edit re-queues them onto.
   */
  queued: QueuedMessage[];
};

export type QueuedMessage = { text: string; kind: "steer" | "followUp" };

const emptyDesk: Desk = { entries: [], busy: false, history: [], model: DEFAULT_MODEL, queued: [] };

/** The base of a key: `main:<id>` is `main`; a worker's name is its own base. Keys from older
 * desks (a workspace id, `{ws}:agent-<hex>`) parse the same way and are simply other workers. */
export function baseOf(key: string): string {
  return key.split(":")[0]!;
}

/** First pending ask for the workspace the user is looking at; asks keep arrival order. */
export function askFor<T extends { key: string }>(asks: T[], activeKey: string): T | undefined {
  const base = baseOf(activeKey);
  return asks.find((a) => baseOf(a.key) === base);
}

export function deskKey(workspaceId?: string, id = "main"): string {
  const base = workspaceId ?? "main";
  return id === "main" ? base : `${base}:${id}`;
}

/** The desk id inside a key, i.e. the inverse of `deskKey`. */
export function deskIdOf(base: string, key: string): string {
  return key === base ? "main" : key.slice(base.length + 1);
}

/** The worker conversations among `keys`: every key that is not the coordinator's, sorted and
 * once each. An older desk's workspace-id and `:agent-` keys land here too, shown by their key,
 * so nothing they hold disappears. */
export function workerKeys(keys: Iterable<string>): string[] {
  return [...new Set([...keys].filter((k) => k && baseOf(k) !== "main"))].sort();
}

export type DeskMap = Record<string, Desk>;

export function getDesk(map: DeskMap, key: string): Desk {
  return map[key] ?? emptyDesk;
}

export function patchDesk(
  map: DeskMap,
  key: string,
  patch: Partial<Desk> | ((s: Desk) => Partial<Desk>),
): DeskMap {
  const current = getDesk(map, key);
  const applied = typeof patch === "function" ? patch(current) : patch;
  return { ...map, [key]: { ...current, ...applied } };
}
