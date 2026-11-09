import type { Entry } from "./components/Transcript.tsx";
import { DEFAULT_MODEL, type ModelRef } from "./models.ts";

/**
 * Hierarchical desks: a working desk has main desks (orchestrators)
 * and every workspace has its own — both can be named and kept side by side.
 * Turns keep running in whichever desk started them, regardless of what the
 * user is currently looking at. The connected environment is a property of the
 * desk, not part of its address, so `/env` moves the whole desk across
 * without swapping any transcript.
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

/** The workspace a desk key belongs to: `main`, `ws-…`; `ws-…:agent-<hex>` belongs to `ws-…`. */
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

/** A clone's row has no desk of its own, only its subagent's (`<clone>:agent-<hex>`): the id of
 * the newest one, or undefined when the base has a regular desk or no agent one. */
export function pickAgentDesk(base: string, desks: { key: string; updated: number }[]): string | undefined {
  const mine = desks.filter((s) => s.key === base || s.key.startsWith(`${base}:`));
  if (mine.some((s) => !s.key.includes(":agent-"))) return undefined;
  const newest = mine.reduce<{ key: string; updated: number } | undefined>((a, s) => (!a || s.updated > a.updated ? s : a), undefined);
  return newest && deskIdOf(base, newest.key);
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
