import { useEffect, useMemo, useRef, useState } from "react";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { Registry } from "@kloudlite-tui/tools";
import { Transcript, type Entry } from "./components/Transcript.tsx";
import { Prompt } from "./components/Prompt.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { HintBar } from "./components/HintBar.tsx";
import { Palette, type PaletteItem } from "./components/Palette.tsx";
import { Tabs } from "./components/Tabs.tsx";
import { matchCommands, menuItems, placeholders } from "./slash.ts";
import { CURRENT_USER, envLabel, MOCK_ENVIRONMENTS } from "./workspaces.ts";
import { setTheme, theme, themeNames } from "./theme.ts";
import { catalog, loadProviderAuth, modelLabel } from "./models.ts";
import {
  clearSessionHistory,
  createSession,
  loginOptions,
  readSettings,
  resolveModel,
  writeSettings,
  type AgentSession,
  type AgentSessionEvent,
} from "@kloudlite-tui/agent";
import { Login } from "./components/Login.tsx";
import { AskPanel, type Ask } from "./components/Ask.tsx";
import { toolDiff } from "./diff.ts";
import {
  getSession,
  patchSession,
  sessionKey,
  type SessionMap,
} from "./sessions.ts";

export const SIDEBAR_WIDTH = 42;

/**
 * Sessions are hierarchical: each environment has a main session, and each
 * workspace has its own session running pi's full agent harness (streaming,
 * thinking, coding tools, steering queues, compaction, retries). A running
 * turn belongs to its session and keeps streaming while you look elsewhere.
 */
export function App({
  registry,
  onExit,
}: {
  registry: Registry;
  /** Called on quit; defaults to killing the process (single-user CLI). */
  onExit?: () => void;
}) {
  const renderer = useRenderer();
  const { width: columns, height: rows } = useTerminalDimensions();
  const [sessions, setSessions] = useState<SessionMap>({});
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"agent" | "shell">("agent");
  const [hint, setHint] = useState(0);
  // 0 = main context (orchestrator); 1..N = inside workspaces[focus - 1]
  const [focus, setFocus] = useState(0);
  // Environment tabs: indexes into MOCK_ENVIRONMENTS that are open; one active
  const [openEnvs, setOpenEnvs] = useState<number[]>([0, 1, 2]);
  const [env, setEnv] = useState(0);
  // environments are state: /move re-homes a workspace into another one
  const [envs, setEnvs] = useState(MOCK_ENVIRONMENTS);
  const [palette, setPalette] = useState(false);
  const [login, setLogin] = useState<{ provider: string; type: "oauth" | "api_key" } | null>(null);
  // provider id → auth status, resolved once on startup
  const [auth, setAuth] = useState<Map<string, { ok: boolean; envKey?: string }>>(new Map());
  // bumped to re-render after an in-place theme swap
  const [, setThemeTick] = useState(0);
  // persisted UI preferences (sidebar visibility, thinking visibility)
  const [prefs, setPrefs] = useState(() => {
    const s = readSettings();
    return { sidebar: s.sidebar ?? "show", thinking: s.thinking ?? "show" };
  });
  // Live agent sessions, one per session key (created lazily on first prompt).
  const agents = useRef(new Map<string, Promise<AgentSession>>());
  // ↑/↓ recall position in the active session's history; null = live input
  const [histIdx, setHistIdx] = useState<number | null>(null);
  // interactive prompts (permissions, model questions), oldest first
  const [asks, setAsks] = useState<Ask[]>([]);
  // tools granted "always allow" per session key
  const alwaysAllow = useRef(new Map<string, Set<string>>());

  const environment = envs[env]!;
  const workspaces = environment.workspaces;
  const activeKey = sessionKey(
    environment.id,
    focus === 0 ? undefined : workspaces[focus - 1]!.id,
  );
  const session = getSession(sessions, activeKey);
  const busy = session.busy;

  function exit(): void {
    if (onExit) return onExit(); // server session: close the connection only
    renderer.destroy();
    process.exit(0);
  }

  // Switching sessions leaves history recall; also wake the session so a
  // persisted transcript is restored without needing a first prompt.
  useEffect(() => {
    setHistIdx(null);
    ensureAgent(activeKey).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);

  useEffect(() => {
    loadProviderAuth().then(setAuth).catch(() => {});
  }, []);

  useEffect(() => {
    const id = setInterval(
      () => setHint((h) => (h + 1) % placeholders.length),
      6000,
    );
    return () => clearInterval(id);
  }, []);

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") return exit();
    if (palette || login || asks.length > 0) return; // modal owns the keyboard
    const menuOpen = matchCommands(input).length > 0;
    // Ctrl+P: jump palette
    if (key.ctrl && key.name === "p") return setPalette(true);
    // Ctrl+A: contextual actions for the current selection
    if (key.ctrl && key.name === "a") {
      if (focus > 0) {
        const ws = workspaces[focus - 1]!;
        const intercepting = environment.services.some((s) => s.interceptedBy === ws.name);
        pushAskRef.current({
          title: ws.name,
          subtitle: `attached to ${envLabel(environment)}`,
          options: [
            { id: "attach", label: "Attach to environment…" },
            { id: "intercept", label: "Intercept a service…" },
            ...(intercepting ? [{ id: "release", label: "Release interception" }] : []),
            { id: "clone", label: "Clone workspace" },
            { id: "cancel", label: "Cancel" },
          ],
          escapeId: "cancel",
        }).then((id) => {
          if (id === "attach") askAttach();
          if (id === "intercept") askIntercept();
          if (id === "release") releaseInterception();
          if (id === "clone") cloneWorkspace();
        });
      } else {
        pushAskRef.current({
          title: envLabel(environment),
          subtitle: environment.owner === CURRENT_USER ? "your environment" : `shared by ${environment.owner}`,
          options: [
            { id: "new", label: "New workspace…" },
            { id: "clone-env", label: "Clone environment" },
            { id: "close", label: "Close tab" },
            { id: "cancel", label: "Cancel" },
          ],
          escapeId: "cancel",
        }).then((id) => {
          if (id === "new") setInput("/workspace new ");
          if (id === "clone-env") cloneEnvironment();
          if (id === "close") closeTab();
        });
      }
      return;
    }
    const n = workspaces.length;
    // only your own workspaces can be entered; others are visible but attached
    // to their owner's session
    const own = workspaces
      .map((w, i) => (w.owner === CURRENT_USER ? i + 1 : -1))
      .filter((i) => i > 0);
    // cycle among your workspaces; entering from main lands on first/last
    const cycle = (delta: number) =>
      setFocus((f) => {
        if (own.length === 0) return 0;
        const pos = own.indexOf(f);
        if (pos === -1) return delta > 0 ? own[0]! : own[own.length - 1]!;
        return own[(pos + delta + own.length) % own.length]!;
      });
    // Ctrl+J/K cycle workspaces (legacy terminals report ctrl+j as a bare linefeed)
    if ((key.ctrl && key.name === "j") || key.name === "linefeed") return cycle(1);
    if (key.ctrl && key.name === "k") return cycle(-1);
    // vim-style: Ctrl+H/L = environment tab left/right
    const tabMove = (delta: number) => {
      const pos = openEnvs.indexOf(env);
      const next = openEnvs[(pos + delta + openEnvs.length) % openEnvs.length]!;
      setEnv(next);
      setFocus(0);
      setMode("agent");
    };
    if (key.ctrl && key.name === "h") return tabMove(-1);
    if (key.ctrl && key.name === "l") return tabMove(1);
    // Ctrl+1..9: jump straight to workspace N; Ctrl+0: main context
    if (key.ctrl && /^[0-9]$/.test(key.name)) {
      const d = Number(key.name);
      if (d === 0) {
        setMode("agent");
        return setFocus(0);
      }
      if (d <= n && workspaces[d - 1]!.owner === CURRENT_USER) return setFocus(d);
      return;
    }
    if (key.name === "tab" && !menuOpen) return cycle(key.shift ? -1 : 1);
    // ↑/↓ recall this session's prompt history (menu closed only)
    if (!menuOpen && (key.name === "up" || key.name === "down")) {
      const h = session.history;
      if (h.length === 0) return;
      if (key.name === "up") {
        const idx = histIdx === null ? h.length - 1 : Math.max(0, histIdx - 1);
        setHistIdx(idx);
        setInput(h[idx]!);
      } else if (histIdx !== null) {
        const idx = histIdx + 1;
        if (idx >= h.length) {
          setHistIdx(null);
          setInput("");
        } else {
          setHistIdx(idx);
          setInput(h[idx]!);
        }
      }
      return;
    }
    // leaving shell mode: backspace on an empty prompt
    if (mode === "shell" && (key.name === "backspace" || key.name === "delete") && input === "") {
      setMode("agent");
    }
    // Ctrl+B: come out of the workspace to the main context (esc stays interrupt-only)
    if (key.ctrl && key.name === "b") {
      setMode("agent"); // shell only exists inside a workspace
      return setFocus(0);
    }
    if (key.name === "escape") {
      if (busy) return interrupt(activeKey);
      if (input !== "") setInput(""); // clear the prompt
    }
  });

  /** Human summary of a tool call, opencode-style: the salient arg, not JSON. */
  function toolSummary(name: string, args: any): string {
    const one = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
    const clip = (v: string) => (v.length > 100 ? `${v.slice(0, 99)}…` : v);
    if (args && typeof args === "object") {
      if (name === "bash" && args.command) return clip(one(args.command));
      const path = args.path ?? args.file_path ?? args.filePath;
      if (path) return clip(one(path));
      const vals = Object.values(args).filter((v) => typeof v === "string");
      if (vals.length) return clip(vals.map(one).join(" "));
    }
    return clip(JSON.stringify(args) ?? "");
  }

  /** Strip pi's internal doc paths / stack noise from error text. */
  const cleanError = (text: string) =>
    text
      .split("\n")
      .filter((l) => !/node_modules|^\s*at /.test(l))
      .join("\n")
      .replace(/\s*See:\s*$/m, "")
      .trim();

  const append = (key: string, entry: Entry) =>
    setSessions((map) =>
      patchSession(map, key, (s) => ({ entries: [...s.entries, entry] })),
    );

  /** Insert-or-update an entry by id (streaming text, tool status). */
  const upsert = (key: string, id: string, make: (prev?: Entry) => Entry) =>
    setSessions((map) =>
      patchSession(map, key, (s) => {
        const i = s.entries.findIndex((e) => "id" in e && e.id === id);
        if (i === -1) return { entries: [...s.entries, make()] };
        const entries = [...s.entries];
        entries[i] = make(entries[i]);
        return { entries };
      }),
    );

  function handleAgentEvent(key: string, event: AgentSessionEvent) {
    switch (event.type) {
      case "agent_start":
        setSessions((map) => patchSession(map, key, { busy: true }));
        break;
      case "agent_end":
        setSessions((map) => patchSession(map, key, { busy: false }));
        break;
      case "message_update":
      case "message_end": {
        const msg = event.message as any;
        if (msg.role !== "assistant") break;
        // Stable per-message entry ids: the message's creation timestamp
        // survives every streaming update, so deltas update in place.
        const mid = `m${msg.timestamp}`;
        const thinking = msg.content
          .filter((b: any) => b.type === "thinking")
          .map((b: any) => b.thinking)
          .join("");
        if (thinking)
          upsert(key, `${mid}t`, () => ({ kind: "thinking", id: `${mid}t`, text: thinking }));
        const text = msg.content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("");
        if (text) upsert(key, mid, () => ({ kind: "agent", id: mid, text }));
        if (event.type !== "message_end") break;
        const m = msg;
        if (m.role === "assistant" && (m.stopReason === "error" || m.stopReason === "aborted")) {
          append(key, {
            kind: "error",
            text: m.stopReason === "aborted" ? "interrupted" : cleanError(m.errorMessage ?? "request failed"),
          });
        }
        break;
      }
      case "tool_execution_start":
        upsert(key, event.toolCallId, () => ({
          kind: "tool",
          id: event.toolCallId,
          name: event.toolName,
          summary: toolSummary(event.toolName, event.args),
          status: "running",
          diff: toolDiff(event.toolName, event.args) ?? undefined,
        }));
        break;
      case "tool_execution_update": {
        // streaming tool output → rendered as the bash block's tail
        const partial = (event as any).partialResult;
        const text =
          typeof partial === "string"
            ? partial
            : (partial?.content?.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n") ?? "");
        if (text)
          upsert(key, event.toolCallId, (prev) => ({
            ...(prev as Entry & { kind: "tool" }),
            output: text,
          }));
        break;
      }
      case "tool_execution_end": {
        const result = (event as any).result;
        const text =
          typeof result === "string"
            ? result
            : (result?.content?.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n") ?? "");
        upsert(key, event.toolCallId, (prev) => ({
          ...(prev as Entry & { kind: "tool" }),
          status: event.isError ? "error" : "ok",
          output: text || (prev as any)?.output,
          error: event.isError ? text.split("\n")[0] : undefined,
        }));
        break;
      }
      case "turn_end": {
        const tokens = (event.message as any)?.usage?.totalTokens ?? 0;
        if (tokens)
          setSessions((map) =>
            patchSession(map, key, (s) => ({ tokens: s.tokens + tokens })),
          );
        break;
      }
      case "queue_update":
        setSessions((map) =>
          patchSession(map, key, {
            queued: (event.steering?.length ?? 0) + (event.followUp?.length ?? 0),
          }),
        );
        break;
      case "compaction_start":
        append(key, { kind: "info", text: "compacting context…" });
        break;
      case "compaction_end":
        append(key, { kind: "info", text: "context compacted" });
        break;
      case "auto_retry_start":
        append(key, {
          kind: "info",
          text: `retrying (${event.attempt}/${event.maxAttempts}): ${event.errorMessage}`,
        });
        break;
      case "auto_retry_end":
        if (!event.success)
          append(key, { kind: "error", text: event.finalError ?? "retries exhausted" });
        break;
    }
  }

  /** Get or lazily create the agent session behind a session key. */
  function ensureAgent(key: string, opts?: { fresh?: boolean }): Promise<AgentSession> {
    let existing = agents.current.get(key);
    if (existing) return existing;
    const model = resolveModel(getSession(sessions, key).model);
    if (!model) return Promise.reject(new Error("no model available"));
    const created = createSession({ key, model, registry, fresh: opts?.fresh }).then((agent) => {
      agent.subscribe((event) => handleAgentEvent(key, event));
      installPermissionGate(key, agent);
      if (!opts?.fresh) restoreTranscript(key, agent);
      return agent;
    });
    agents.current.set(key, created);
    created.catch(() => agents.current.delete(key));
    return created;
  }

  /** Show an interactive prompt and resolve with the chosen option id. */
  function pushAsk(ask: Omit<Ask, "resolve">): Promise<string> {
    return new Promise((resolve) => {
      setAsks((prev) => [
        ...prev,
        {
          ...ask,
          resolve: (id) => {
            setAsks((current) => current.slice(1));
            resolve(id);
          },
        },
      ]);
    });
  }
  const pushAskRef = useRef(pushAsk);
  pushAskRef.current = pushAsk;

  // The model can ask the user a question with options (opencode's question tool).
  const registered = useRef(false);
  if (!registered.current) {
    registered.current = true;
    registry.add({
      name: "question",
      description:
        "Ask the user a question and wait for their answer. Use when you need a decision or clarification. Provide 2-5 short answer options.",
      inputSchema: {
        type: "object",
        properties: {
          question: { type: "string", description: "The question to ask" },
          options: {
            type: "array",
            items: { type: "string" },
            description: "Selectable answer options",
          },
        },
        required: ["question", "options"],
      },
      run: async ({ question, options }: { question: string; options: string[] }) => {
        const picked = await pushAskRef.current({
          title: question,
          options: options.map((label, i) => ({ id: String(i), label })),
        });
        return options[Number(picked)] ?? picked;
      },
    });
  }

  /** Tools that require permission before running. */
  const GATED = new Set(["bash", "write", "edit"]);

  /** Chain a permission gate ahead of pi's installed beforeToolCall hook. */
  function installPermissionGate(key: string, agent: AgentSession) {
    const inner = agent.agent.beforeToolCall;
    agent.agent.beforeToolCall = async (ctx: any, signal?: AbortSignal) => {
      const name = ctx.toolCall.name;
      const granted = alwaysAllow.current.get(key) ?? new Set<string>();
      if (GATED.has(name) && !granted.has(name)) {
        const diff = toolDiff(name, ctx.args) ?? undefined;
        const choice = await pushAskRef.current({
          title: "Permission required",
          subtitle:
            name === "bash"
              ? "Shell command"
              : `${name === "write" ? "Write" : "Edit"} ${ctx.args?.path ?? "file"}`,
          body: name === "bash" ? `$ ${ctx.args?.command ?? ""}` : diff ? undefined : toolSummary(name, ctx.args),
          diff,
          options: [
            { id: "once", label: "Allow once" },
            { id: "always", label: "Allow always" },
            { id: "reject", label: "Reject" },
          ],
          escapeId: "reject",
        });
        if (choice === "always") {
          granted.add(name);
          alwaysAllow.current.set(key, granted);
        } else if (choice === "reject") {
          return { block: true, reason: "The user rejected this tool call." };
        }
      }
      return inner?.(ctx, signal);
    };
  }

  /** Rebuild the transcript + prompt history from a restored session. */
  function restoreTranscript(key: string, agent: AgentSession) {
    const messages = agent.messages;
    if (messages.length === 0) return;
    const entries: Entry[] = [];
    const history: string[] = [];
    for (const m of messages as any[]) {
      if (m.role === "user") {
        const text = (m.content ?? [])
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("\n");
        if (text) {
          entries.push({ kind: "user", text });
          history.push(text);
        }
      } else if (m.role === "assistant") {
        for (const b of m.content ?? []) {
          if (b.type === "text" && b.text.trim())
            entries.push({ kind: "agent", text: b.text });
          if (b.type === "toolCall")
            entries.push({
              kind: "tool",
              id: b.id,
              name: b.name,
              summary: toolSummary(b.name, b.arguments),
              status: "ok",
            });
        }
      }
    }
    setSessions((map) =>
      patchSession(map, key, (s) =>
        s.entries.length === 0 ? { entries, history } : {},
      ),
    );
  }

  function interrupt(key: string) {
    agents.current.get(key)?.then((a) => a.abort());
  }

  // Dispose sessions when the app unmounts.
  useEffect(() => () => {
    for (const agent of agents.current.values()) agent.then((a) => a.dispose()).catch(() => {});
  }, []);

  // "!" typed on an empty prompt enters shell mode. Intercepted here (single
  // writer of input state) rather than in a second key handler, so there is
  // no ordering dependence between handlers.
  function changeInput(v: string) {
    setHistIdx(null); // typing exits history recall
    // shell runs inside a workspace; there is no shell at the main context
    if (mode === "agent" && v === "!" && input === "" && focus > 0) {
      setMode("shell");
      return;
    }
    setInput(v);
  }

  // ---- environment / workspace verbs (mock-state mutations) ----
  const uid = useRef(100);
  const freshId = () => `w${uid.current++}`;

  function attachTo(target: number) {
    if (focus === 0 || target === -1 || target === env) return;
    const ws = workspaces[focus - 1]!;
    setEnvs((prev) =>
      prev.map((e, i) => {
        if (i === env)
          return {
            ...e,
            workspaces: e.workspaces.filter((w) => w.id !== ws.id),
            // detaching releases any interception it held here
            services: e.services.map((s) => (s.interceptedBy === ws.name ? { ...s, interceptedBy: undefined } : s)),
          };
        if (i === target) return { ...e, workspaces: [...e.workspaces, ws] };
        return e;
      }),
    );
    // follow the workspace: open + activate the target env, keep it focused
    setOpenEnvs((open) => (open.includes(target) ? open : [...open, target]));
    setEnv(target);
    setFocus(envs[target]!.workspaces.length + 1);
  }

  function askAttach() {
    const ws = workspaces[focus - 1]!;
    pushAskRef.current({
      title: "Attach to environment",
      subtitle: `${ws.name} → choose where to plug in`,
      options: [
        ...envs.map((e, i) => ({ id: String(i), label: envLabel(e) })).filter((o) => Number(o.id) !== env),
        { id: "cancel", label: "Cancel" },
      ],
      escapeId: "cancel",
    }).then((id) => {
      if (id !== "cancel") attachTo(Number(id));
    });
  }

  function interceptService(name: string) {
    const ws = workspaces[focus - 1]!;
    if (!environment.services.some((s) => s.name === name)) return;
    setEnvs((prev) =>
      prev.map((e, i) =>
        i === env
          ? { ...e, services: e.services.map((s) => (s.name === name ? { ...s, interceptedBy: ws.name } : s)) }
          : e,
      ),
    );
    append(activeKey, { kind: "info", text: `intercepting ${name}.${environment.name} → ${ws.name}` });
  }

  function askIntercept() {
    pushAskRef.current({
      title: "Intercept a service",
      subtitle: `traffic will route to ${workspaces[focus - 1]!.name}`,
      options: [
        ...environment.services.map((s) => ({
          id: s.name,
          label: `${s.name}:${s.port}`,
        })),
        { id: "cancel", label: "Cancel" },
      ],
      escapeId: "cancel",
    }).then((id) => {
      if (id !== "cancel") interceptService(id);
    });
  }

  function releaseInterception() {
    const ws = workspaces[focus - 1]!;
    setEnvs((prev) =>
      prev.map((e, i) =>
        i === env
          ? { ...e, services: e.services.map((s) => (s.interceptedBy === ws.name ? { ...s, interceptedBy: undefined } : s)) }
          : e,
      ),
    );
    append(activeKey, { kind: "info", text: `released interceptions held by ${ws.name}` });
  }

  function newWorkspace(name: string) {
    const ws = {
      id: freshId(),
      name,
      owner: CURRENT_USER,
      status: "running" as const,
      ports: [],
      repo: `kloudlite/${name}`,
      branch: "main",
    };
    setEnvs((prev) => prev.map((e, i) => (i === env ? { ...e, workspaces: [...e.workspaces, ws] } : e)));
    setFocus(environment.workspaces.length + 1);
  }

  function cloneWorkspace() {
    const src = workspaces[focus - 1]!;
    const ws = { ...src, id: freshId(), name: `${src.name}-copy`, owner: CURRENT_USER };
    setEnvs((prev) => prev.map((e, i) => (i === env ? { ...e, workspaces: [...e.workspaces, ws] } : e)));
    setFocus(environment.workspaces.length + 1);
  }

  function cloneEnvironment() {
    // clones services and YOUR attached workspaces; the copy is yours
    const src = environment;
    const cloned = {
      ...src,
      id: `e${uid.current++}`,
      name: `${src.name}-copy`,
      owner: CURRENT_USER,
      services: src.services.map((s) => ({ ...s })),
      workspaces: src.workspaces
        .filter((w) => w.owner === CURRENT_USER)
        .map((w) => ({ ...w, id: freshId() })),
    };
    setEnvs((prev) => [...prev, cloned]);
    setOpenEnvs((open) => [...open, envs.length]);
    setEnv(envs.length);
    setFocus(0);
    setMode("agent");
  }

  function closeTab() {
    setOpenEnvs((open) => {
      if (open.length <= 1) return open;
      const next = open.filter((i) => i !== env);
      setEnv(next[0]!);
      setFocus(0);
      return next;
    });
  }

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setInput("");

    if (trimmed === "/exit") return exit();
    if (trimmed === "/clear") {
      // start a brand-new persisted session: drop the live agent and its
      // restored history, so the cleared state survives a restart
      const key = activeKey;
      agents.current.get(key)?.then((a) => a.dispose()).catch(() => {});
      agents.current.delete(key);
      clearSessionHistory(key); // archive persisted transcripts
      setSessions((map) =>
        patchSession(map, key, { entries: [], history: [], tokens: 0, queued: 0, busy: false }),
      );
      ensureAgent(key, { fresh: true }).catch(() => {});
      return;
    }
    if (trimmed === "/tools") {
      const names = registry.names();
      return append(activeKey, {
        kind: "agent",
        text: names.length ? names.join(", ") : "No tools registered.",
      });
    }
    if (trimmed === "/help")
      return append(activeKey, { kind: "agent", text: "Type / to see commands." });
    if (trimmed.startsWith("/theme ")) {
      const name = trimmed.slice(7).trim();
      setTheme(name);
      writeSettings({ theme: name }); // persists across restarts
      setThemeTick((t) => t + 1);
      return;
    }
    if (trimmed.startsWith("/model ")) {
      const ref = trimmed.slice(7).trim();
      const slash = ref.indexOf("/");
      if (slash > 0) {
        const provider = ref.slice(0, slash);
        const id = ref.slice(slash + 1);
        setSessions((map) => patchSession(map, activeKey, { model: { provider, id } }));
        writeSettings({ defaultModel: { provider, id } }); // persists across restarts
        const live = resolveModel({ provider, id });
        if (live) agents.current.get(activeKey)?.then((a) => a.setModel(live)).catch(() => {});
      }
      return;
    }
    if (trimmed.startsWith("/login ")) {
      const [provider, type] = trimmed.slice(7).trim().split(/\s+/);
      if (provider)
        setLogin({ provider, type: type === "api_key" ? "api_key" : "oauth" });
      return;
    }
    if (trimmed === "/attach" || trimmed.startsWith("/attach ")) {
      if (focus === 0) {
        append(activeKey, {
          kind: "info",
          text: "enter a workspace first — /attach re-points the current workspace",
        });
        return;
      }
      const typed = trimmed.slice(7).trim();
      if (typed) attachTo(envs.findIndex((e) => envLabel(e) === typed || e.name === typed));
      else askAttach();
      return;
    }
    if (trimmed === "/intercept" || trimmed.startsWith("/intercept ")) {
      if (focus === 0) {
        append(activeKey, { kind: "info", text: "enter a workspace first — interception routes a service into it" });
        return;
      }
      const typed = trimmed.slice(10).trim();
      if (typed) interceptService(typed);
      else askIntercept();
      return;
    }
    if (trimmed === "/release") {
      if (focus > 0) releaseInterception();
      return;
    }
    if (trimmed.startsWith("/workspace")) {
      const rest = trimmed.slice(10).trim();
      if (rest.startsWith("new")) {
        const name = rest.slice(3).trim();
        if (name) newWorkspace(name);
        else setInput("/workspace new ");
        return;
      }
      if (rest === "clone") {
        cloneWorkspace();
        return;
      }
      setInput("/workspace ");
      return;
    }
    if (trimmed === "/env clone") return cloneEnvironment();
    if (trimmed === "/env close") return closeTab();
    if (trimmed === "/env") {
      setInput("/env ");
      return;
    }
    if (trimmed.startsWith("/settings ")) {
      const [key, value] = trimmed.slice(10).trim().split(/\s+/);
      if ((key === "sidebar" || key === "thinking") && (value === "show" || value === "hide")) {
        setPrefs((p) => ({ ...p, [key]: value }));
        writeSettings({ [key]: value });
      }
      return;
    }
    // bare option-commands: open their menu instead of sending to the agent
    if (["/model", "/theme", "/login", "/settings"].includes(trimmed)) {
      setInput(`${trimmed} `);
      return;
    }

    // The turn belongs to the session it started in; prompting while the
    // agent streams queues it as steering (pi handles the queue).
    const key = activeKey;
    append(key, { kind: "user", text: trimmed });
    setSessions((map) =>
      patchSession(map, key, (s) => ({ history: [...s.history, trimmed] })),
    );
    setHistIdx(null);
    ensureAgent(key)
      .then((agent) => agent.prompt(trimmed))
      .catch((err) => append(key, { kind: "error", text: cleanError(String(err)) }));
  }

  const paletteItems: PaletteItem[] = [
    ...envs.map((e, i) => ({
      label: envLabel(e),
      hint:
        e.owner === CURRENT_USER
          ? i === env ? "active" : openEnvs.includes(i) ? "open" : ""
          : `shared by ${e.owner}`,
      group: "Environments",
      run: () => {
        setOpenEnvs((open) => (open.includes(i) ? open : [...open, i]));
        setEnv(i);
        setFocus(0);
      },
    })),
    ...workspaces
      .map((w, i) => ({ w, i }))
      .filter(({ w }) => w.owner === CURRENT_USER)
      .map(({ w, i }) => ({
        label: w.name,
        hint: w.status === "cloning" ? (w.progress ?? w.status) : w.status,
        group: `Workspaces · ${environment.name}`,
        run: () => setFocus(i + 1),
      })),
    {
      label: "main context",
      hint: "orchestrator",
      group: "Context",
      run: () => setFocus(0),
    },
  ];

  // Built once per auth change, NOT per keystroke — sorting/mapping the full
  // model catalog on every key press is feelable input latency.
  const menuCtx = useMemo(
    () => ({
      models: [...catalog]
        .sort(
          (a, b) =>
            Number(auth.get(b.provider)?.ok ?? 0) - Number(auth.get(a.provider)?.ok ?? 0),
        )
        .map((m) => {
          const a = auth.get(m.provider);
          return {
            provider: m.provider,
            id: m.id,
            hint: a?.ok ? "ready" : a?.envKey ? `set ${a.envKey}` : "",
          };
        }),
      themes: themeNames,
      logins: loginOptions(),
      attach:
        focus > 0
          ? envs
              .map((e, i) => ({
                name: envLabel(e),
                hint:
                  e.owner === CURRENT_USER
                    ? openEnvs.includes(i)
                      ? "environment · open"
                      : "environment"
                    : `shared by ${e.owner}`,
              }))
              .filter((_, i) => i !== env)
          : [],
      intercepts:
        focus > 0
          ? environment.services.map((s) => ({
              name: s.name,
              hint: s.interceptedBy ? `⇄ ${s.interceptedBy}` : `:${s.port}`,
            }))
          : [],
      settings: (["sidebar", "thinking"] as const).flatMap((key) =>
        (["show", "hide"] as const).map((value) => ({
          key,
          value,
          hint: prefs[key] === value ? "current" : "",
        })),
      ),
    }),
    [auth, prefs, envs, env, focus, openEnvs, environment],
  );
  const menu = useMemo(
    () => (input.startsWith("/") ? menuItems(input, menuCtx) : []),
    [input, menuCtx],
  );
  const modalOpen = palette || login !== null || asks.length > 0;

  return (
    // pinned to the terminal size: without it the tree grows with content
    // and pushes the strip/hint bar (and tabs) off screen
    <box flexDirection="column" width={columns} height={rows} backgroundColor={theme.bg}>
      <Tabs
        names={openEnvs.map((i) => envLabel(envs[i]!))}
        active={openEnvs.indexOf(env)}
        width={columns}
      />
      <box flexDirection="row" flexGrow={1} minHeight={0} flexBasis={0} flexShrink={1} overflow="hidden">
        {/* opencode session main column: paddingX 2, paddingBottom 1, gap 1 */}
        <box
          flexDirection="column"
          flexGrow={1}
          minHeight={0}
          paddingLeft={2}
          paddingRight={2}
          paddingBottom={1}
          gap={1}
        >
          {login ? (
            <box flexGrow={1} flexDirection="column">
              <Login
                provider={login.provider}
                type={login.type}
                onDone={(ok) => {
                  setLogin(null);
                  if (ok) loadProviderAuth().then(setAuth).catch(() => {});
                }}
              />
            </box>
          ) : palette ? (
            <Palette items={paletteItems} onClose={() => setPalette(false)} />
          ) : (
            <Transcript
              entries={
                prefs.thinking === "hide"
                  ? session.entries.filter((e) => e.kind !== "thinking")
                  : session.entries
              }
              active={!modalOpen}
            />
          )}
          {/* prompt block, opencode structure: card + strip + footer row stack
              tight; question/permission panels replace the whole block */}
          <box flexDirection="column" flexShrink={0}>
          {asks.length > 0 ? (
            <AskPanel ask={asks[0]!} />
          ) : (
          <>
            <Prompt
              value={input}
              onChange={changeInput}
              onSubmit={submit}
              placeholder={session.entries.length === 0 ? placeholders[hint]! : ""}
              mode={mode}
              model={modelLabel(session.model)}
              provider={session.model.provider}
              workspace={focus === 0 ? undefined : workspaces[focus - 1]!.name}
              inputActive={!modalOpen}
              menu={menu}
            />
          <HintBar
            busy={busy}
            tokens={session.tokens}
            queued={session.queued}
            active={focus === 0 ? "main" : `main › ${workspaces[focus - 1]!.name}`}
            inWorkspace={focus > 0}
          />
          </>
          )}
          </box>
        </box>
        {prefs.sidebar === "show" && (
        <Sidebar
          workspaces={workspaces}
          services={environment.services}
          envName={environment.name}
          envOwner={environment.owner === CURRENT_USER ? undefined : environment.owner}
          focus={focus}
          width={SIDEBAR_WIDTH}
          tokens={session.tokens}
          running={workspaces.map((w) => getSession(sessions, w.id).busy)}
        />
        )}
      </box>
    </box>
  );
}
