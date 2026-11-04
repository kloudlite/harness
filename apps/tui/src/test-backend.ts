//! A stand-in Backend for the UI tests: the agent runs in the Kloudlite runtime now, so the tests drive the App against
//! canned answers. Anything not named here is an inert async call resolving `undefined`.
import type { Backend, Hello, SessionHandle } from "./wire/index.ts";

const inert = (): any => new Proxy(() => Promise.resolve(undefined), { get: (_t, k) => (k === "then" ? undefined : inert()) });

const CATALOG = { provider: "deepseek", id: "deepseek-flash", name: "DeepSeek Flash", input: ["text"] };
export const fakeHello = (settings: Hello["settings"] = {}): Hello => ({
  protocol: 2, settings, catalog: [CATALOG], defaultModel: { provider: "deepseek", id: "deepseek-flash" }, logins: [], sessions: [],
  cwd: "/", home: "/", tools: [], asks: [], mode: "default",
});

export function fakeHandle(): SessionHandle {
  return {
    messages: [], busy: false,
    state: { type: "session_state", model: { provider: "deepseek", id: "deepseek-flash" }, thinkingLevel: "off", autoCompact: true, codemode: false, queued: { steering: [], followUp: [] } },
    subscribe: () => () => {}, dispose: async () => {}, prompt: async () => {}, abort: async () => {},
  } as any;
}

export class FakeBackend {
  teamView: any = async () => ({ available: false, user: "", workspaces: [], environments: [] });
  constructor() {
    const self: any = this;
    return new Proxy(self, { get: (t, k) => (k in t ? t[k] : inert()) });
  }
  models = { refresh: async () => [CATALOG] };
  auth = { providers: async () => [{ provider: "deepseek", ok: true, envKeys: [] }] };
  // like the old local backend, a watcher hears the team view at once
  watch = async (cb: (e: any) => void) => {
    void this.teamView().then((view: unknown) => cb({ type: "team", view }));
    return () => {};
  };
  sessions = { list: async () => [], watch: async (cb: (l: unknown[]) => void) => (cb([]), () => {}), name: async () => {}, describe: async () => {}, clear: async () => {} };
  hello = async () => fakeHello();
  session = async (_key: string, _opts?: unknown) => fakeHandle();
}
export const newFake = (): Backend => new FakeBackend() as unknown as Backend;
