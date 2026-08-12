import type { Entry } from "./components/Transcript.tsx";
import { DEFAULT_MODEL, type ModelRef } from "./models.ts";

/**
 * Hierarchical sessions: each environment has a main session (orchestrator),
 * and every workspace runs its own session with its own agent loop. Turns
 * keep running in whichever session started them, regardless of what the
 * user is currently looking at.
 */
export type Session = {
  entries: Entry[];
  busy: boolean;
  tokens: number;
  /** Prompts submitted in this session, oldest first (↑/↓ recall). */
  history: string[];
  model: ModelRef;
  /** Steering / follow-up prompts queued while the agent streams. */
  queued: number;
};

const emptySession: Session = { entries: [], busy: false, tokens: 0, history: [], model: DEFAULT_MODEL, queued: 0 };

/** Session key for a context: environment main, or a workspace's own session. */
export function sessionKey(envId: string, workspaceId?: string): string {
  return workspaceId ?? `${envId}:main`;
}

export type SessionMap = Record<string, Session>;

export function getSession(map: SessionMap, key: string): Session {
  return map[key] ?? emptySession;
}

export function patchSession(
  map: SessionMap,
  key: string,
  patch: Partial<Session> | ((s: Session) => Partial<Session>),
): SessionMap {
  const current = getSession(map, key);
  const applied = typeof patch === "function" ? patch(current) : patch;
  return { ...map, [key]: { ...current, ...applied } };
}
