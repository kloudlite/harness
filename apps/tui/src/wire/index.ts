//! The seam between the TUI and the agent. `LocalBackend` (./local) runs the agent in-process; a
//! `RemoteBackend` (./remote) reaches the same thing on the bench over a websocket through bench-proxy (./wire). The TUI
//! imports only this file and ./remote at runtime, so the laptop binary bundles no agent. The agent itself is the Kloudlite
//! runtime now (Rust); the pi types here are type-only.
//! Design: docs/superpowers/specs/2026-10-08-local-tui-design.md.
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { AuthInteraction, AuthType } from "@earendil-works/pi-ai";
import type { ModelRef, ProviderCheck, ThinkingLevel } from "./agent-types.ts";
import type { ToolDef } from "@kloudlite-tui/tools";
import type { FileDiff, DiffLine } from "./diff.ts";
import type { Change, ChangeStatus, Match, TreeNode } from "./git.ts";

export type { DiffLine, FileDiff } from "./diff.ts";
export type { Change, ChangeStatus, Match, TreeNode } from "./git.ts";
export type { ModelRef, ThinkingLevel, ToolDef };
export { PROTOCOL } from "./wire.ts";
export { connect, RemoteBackend } from "./remote.ts";

export type Settings = {
  defaultModel?: ModelRef; theme?: string; sidebar?: "show" | "hide"; sidebarWidth?: number; thinking?: "show" | "hide";
  thinkingLevel?: ThinkingLevel; autoCompact?: "on" | "off"; codemode?: "on" | "off"; vim?: "on" | "off";
};
export type DeskMeta = { key: string; name?: string; description?: string; updated: number };
export type LiveDeskMeta = DeskMeta & { busy: boolean };
export type LoginOption = { provider: string; type: AuthType; label: string };
export type ProviderAuth = {
  provider: string;
  /** Credentials resolve (env key, OAuth token, ambient) - a request can run. */
  ok: boolean;
  /** Env var(s) that would configure this provider, for the "how to add" hint. */
  envKeys: string[];
};
export type { ProviderCheck };
export type LoginType = AuthType;
/** pi's `AuthInteraction`: `{ signal?, prompt(p): Promise<string>, notify(e): void }`. */
export type LoginUi = AuthInteraction;
export type CatalogModel = { provider: string; id: string; name: string; input: string[] };
/** What the sidebar shows, read by the bench from the platform (./desk). JSON-safe: it crosses the websocket. */
export type TeamProcess = { id: string; tree?: string; cmd: string; state: string; exit_code?: number | null; failed?: boolean; started_at?: string; logs: { text: string; err?: true }[] };
export type TeamWorkspace = {
  id: string;
  name: string;
  owner: string;
  state: string;
  repo?: string;
  branch?: string;
  /** The environment the workspace's desk connects it to, if any. */
  environment?: string;
  parent?: string;
  task?: string;
  processes?: TeamProcess[];
  changes?: number;
};
export type TeamEnvironment = {
  id: string;
  name: string;
  owner: string;
  state: string;
  services: { name: string; ports: number[]; interceptedBy?: string }[];
  /** The snapshot the environment sits on (its message, else its id); only the connected one. */
  snapshot?: string;
};
export type TaskState = "queued" | "running" | "blocked" | "done" | "failed";
export type BoardTask = { id: string; title: string; priority: number; dependsOn: string[]; state: TaskState; note?: string; /** What changed and where; with `verified`, required to mark done (tasks.ts). */ summary?: string; verified?: string; /** Set when the board watcher (watch.ts) moved the task, not the desk; any desk write clears it. */ by?: "watcher"; created: number };
export type TeamView = {
  available: boolean;
  error?: string;
  user: string;
  workspaces: TeamWorkspace[];
  environments: TeamEnvironment[];
  /** The desk's environment (`KL_ENVIRONMENT`). */
  connected?: string;
  /** Every desk's own board, main first; only the local backend fills it. */
  boards?: { desk: string; tasks: BoardTask[] }[];
  /** The newest messages desks sent each other (messages.ts); only the local backend fills it. */
  messages?: Message[];
};
/** One message between desks; `from`/`to` are base desk keys. `for` is the sender's own task id, `reply` the id of the message answered. */
export type Message = { id: string; from: string; to: string; text: string; at: string; for?: string; kind?: string; reply?: string };
export type ToolSpec = Pick<ToolDef, "name" | "description" | "inputSchema">;

export type Hello = {
  protocol: number;
  settings: Settings;
  catalog: CatalogModel[];
  defaultModel: ModelRef;
  logins: LoginOption[];
  desks: DeskMeta[];
  /** The backend's working directory: what Files browses and the agent edits. */
  cwd: string;
  home: string;
  /** Tools the backend registers itself (web_fetch, web_search). */
  tools: string[];
  /** Cards waiting for an answer, for a connection that arrives late. */
  asks: Ask[];
  /** The permission mode every TUI shows. */
  mode: PermMode;
};

export type PermMode = "default" | "acceptEdits" | "plan" | "bypass";
/** A pending question to the person: raised by the daemon, shown by each TUI for its active key. */
export type Ask = {
  id: string;
  /** The asking key (a delegated desk's caller). */
  key: string;
  kind: "permission" | "question";
  tool: string;
  title: string;
  subtitle?: string;
  body?: string;
  diff?: FileDiff;
  options: { id: string; label: string }[];
};
/** Everything the daemon says to every connection, outside any one desk. */
export type BenchEvent =
  | { type: "ask"; ask: Ask }
  | { type: "ask_resolved"; id: string }
  | { type: "perm"; mode: PermMode }
  | { type: "settings"; settings: Settings }
  | { type: "auth_changed" }
  | { type: "fs_changed"; ws?: string }
  | { type: "team"; view: TeamView };

export type PermissionRequest = {
  name: string;
  args: any;
  diff?: FileDiff;
  /** Key of the desk that asks, when it is not the one the callback was opened for (delegated desks). */
  desk?: string;
  /** The model's one-sentence reason (because.reason). */
  reason?: string;
  /** A quote the model said the person typed but that failed the check (because.asked). */
  claimed?: string;
};
export type Decision = { block?: boolean; reason?: string };

/** What the daemon holds for one live key and pushes to every view (protocol 2). */
export type DeskState = {
  type: "desk_state";
  model: ModelRef;
  thinkingLevel: ThinkingLevel;
  autoCompact: boolean;
  codemode: boolean;
  queued: { steering: string[]; followUp: string[] };
  /** Context now against the model's window; tokens null right after compaction until the next reply. */
  context?: { tokens: number | null; window: number };
};

export type DeskOpts = {
  /** Used only when the daemon has no live agent for the key and builds one; never applied to a live one. */
  initial?: { model?: ModelRef; thinkingLevel?: ThinkingLevel; autoCompact?: boolean; codemode?: boolean };
  fresh?: boolean;
  /** Tools the TUI owns; their `run` executes in the TUI process. */
  tools: ToolDef[];
  /** Called only for destructive house actions (`mustAsk`); never exec, bash, edits, builds or stops. Absent on internal opens (a
   * view opened to deliver a reply): cards then go to every connected TUI (cards.ts). */
  permission?(req: PermissionRequest, signal: AbortSignal): Promise<Decision>;
  /** Set only by serve.ts: this view is a person at a client, so what is typed through it counts as their words (consent.ts). */
  client?: boolean;
};

type Image = Parameters<AgentSession["steer"]>[1] extends (infer I)[] | undefined ? I : never;
/** `desk_closed`: the agent behind this handle was disposed (rebuilt, or idle with no views);
 * the handle is dead and the client reopens on its next action. */
export type DeskEvent = (AgentSessionEvent & { diff?: FileDiff }) | { type: "desk_closed"; reopen: boolean } | { type: "desk_notice"; text: string } | DeskState;

export type DeskHandle = {
  /** Snapshot taken when the desk opened; restoreTranscript reads it. */
  messages: AgentSession["messages"];
  /** A turn is running right now (live: a client that reconnects mid-turn sees it). */
  readonly busy: boolean;
  /** Current snapshot; kept live by `desk_state` events. */
  readonly state: DeskState;
  prompt(text: string, o?: { images?: Image[] }): Promise<void>;
  steer(text: string, images?: Image[]): Promise<void>;
  followUp(text: string, images?: Image[]): Promise<void>;
  /**
   * A message for a desk that may be busy. Idle: prompt. Busy: a throwaway fork of the desk (one
   * stateless side call, never recorded) answers STEER or QUEUE; a failed, slow (20 s) or unparsable fork
   * queues. If the turn ended while the fork ran, prompt. `kind` is what was done.
   */
  route(text: string, images?: Image[]): Promise<{ kind: "steer" | "followUp" | "prompt"; reason: string }>;
  clearQueue(): Promise<void>;
  /** Side question answered from the conversation so far; never recorded anywhere. */
  btw(question: string): Promise<string>;
  /** Compact the context now; pi's compaction events report the result. */
  compact(instructions?: string): Promise<void>;
  abort(): Promise<void>;
  dispose(): Promise<void>;
  setModel(ref: ModelRef): Promise<void>;
  setThinkingLevel(level: ThinkingLevel): Promise<void>;
  setAutoCompactionEnabled(on: boolean): Promise<void>;
  setCodemode(on: boolean): Promise<void>;
  subscribe(cb: (e: DeskEvent) => void): () => void;
};

export interface Backend {
  hello(): Promise<Hello>;
  /** Bench-wide events (cards, permission mode). Resolves with the unsubscribe. */
  watch(cb: (e: BenchEvent) => void): Promise<() => void>;
  asks: { answer(id: string, choice: string): Promise<void> };
  mode: { set(m: PermMode): Promise<void> };
  desk(key: string, opts: DeskOpts): Promise<DeskHandle>;
  desks: {
    list(prefix?: string): Promise<DeskMeta[]>;
    /** Pushed list with live busy: `cb` runs once before this resolves, then on every open,
     * close, turn start, turn end, name, describe and clear. Rejects on a bench without the op
     * (the caller keeps fetching `list`). Resolves with the unsubscribe. */
    watch(cb: (list: LiveDeskMeta[]) => void): Promise<() => void>;
    name(key: string, name: string): Promise<void>;
    describe(key: string, description: string): Promise<void>;
    clear(key: string): Promise<void>;
  };
  settings: { write(patch: Partial<Settings>): Promise<void> };
  /** The desk's real workspaces and environments; never throws, `available: false` says why. */
  teamView(): Promise<TeamView>;
  /** One JSON-RPC message from the laptop MCP door (mcp.ts); the reply, null for a notification. */
  mcp?(msg: unknown): Promise<unknown>;
  models: { refresh(): Promise<CatalogModel[]> };
  auth: {
    providers(): Promise<ProviderAuth[]>;
    /** Whether a connected provider can run inference (a token scope probe; `unknown` when none exists). */
    check(provider: string): Promise<ProviderCheck>;
    login(provider: string, type: LoginType, ui: LoginUi): Promise<void>;
  };
  fs: {
    isGitRepo(root: string): Promise<boolean>;
    changes(root: string): Promise<Change[]>;
    fileDiff(root: string, path: string, status: ChangeStatus): Promise<FileDiff | null>;
    fullFile(root: string, path: string, status?: ChangeStatus): Promise<DiffLine[]>;
    listDir(root: string, rel: string): Promise<TreeNode[]>;
    grep(root: string, query: string, limit?: number): Promise<Match[]>;
  };
  /** The same reads against a workspace's own `~/workspace`, from its pod's ide server. Rejects
   * with the reason when the pod cannot be reached; there is no grep (no pod endpoint). */
  podfs: {
    isGitRepo(ws: string): Promise<boolean>;
    changes(ws: string): Promise<Change[]>;
    fileDiff(ws: string, path: string, status: ChangeStatus): Promise<FileDiff | null>;
    fullFile(ws: string, path: string, status?: ChangeStatus): Promise<DiffLine[]>;
    listDir(ws: string, rel: string): Promise<TreeNode[]>;
  };
}
