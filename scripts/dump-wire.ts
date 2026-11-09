// Records the frames the wire tests exercise (apps/tui/src/wire/wire.test.ts and serve.ts) as JSON, so
// the Rust runtime replays them and must answer byte-identically (bins/runtime/tests/fixtures/wire-frames.json).
// Usage: bun run scripts/dump-wire.ts > wire-frames.json
import { serve } from "../apps/tui/src/wire/serve.ts";
import { encode, Peer, PROTOCOL } from "../apps/tui/src/wire/wire.ts";

type Row = { case: string; dir: "in" | "out"; line: string };
const rows: Row[] = [];
const enc = new TextEncoder();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A client line goes into serve.ts; everything serve writes comes back out. */
function harness(name: string, backend: any) {
  const peer: Peer = new Peer((line) => rows.push({ case: name, dir: "out", line }));
  const s = serve(backend, peer);
  const send = async (frame: unknown) => {
    const line = encode(frame);
    rows.push({ case: name, dir: "in", line });
    peer.feed(enc.encode(line));
    await sleep(15);
  };
  return { send, peer, s };
}

const hello = {
  protocol: PROTOCOL, settings: {}, catalog: [], defaultModel: { provider: "p", id: "m" }, logins: [], desks: [],
  cwd: "/", home: "/", tools: ["web_fetch"], asks: [], mode: "default",
};
const handle = {
  messages: [], busy: false,
  state: { type: "desk_state", model: { provider: "p", id: "m" }, thinkingLevel: "off", autoCompact: true, codemode: false, queued: { steering: [], followUp: [] } },
  subscribe: () => () => {}, dispose: async () => {},
  prompt: async () => {}, abort: async () => {},
};
const backend: any = {
  hello: async () => hello,
  desk: async () => handle,
  desks: { list: async () => [], watch: async () => () => {}, name: async () => {}, describe: async () => {}, clear: async () => {} },
  fs: {}, podfs: {},
  watch: async () => () => {},
  asks: { answer: async () => {} },
  mode: { set: async () => {} },
  settings: { write: async () => {} },
  teamView: async () => ({ available: false, user: "", workspaces: [], environments: [] }),
  models: { refresh: async () => [] },
  auth: { providers: async () => [], check: async () => ({ state: "none" }), login: async () => {} },
};

// wire.test.ts: an unknown op rejects
{
  const h = harness("unknown-op", backend);
  await h.send({ id: 1, op: "missing", args: null });
}
// serve.ts: a call with no open desk, then a tool without an object schema
{
  const h = harness("desk-errors", backend);
  await h.send({ id: 1, op: "desk.call", args: { key: "k", method: "prompt", args: ["hi"] } });
  await h.send({ id: 2, op: "desk.open", args: { key: "k", tools: [{ name: "t", description: "d", inputSchema: { type: "string" } }] } });
}
// serve.ts: ops whose handler returns nothing carry no `value`
{
  const h = harness("void-ops", backend);
  await h.send({ id: 1, op: "ask.answer", args: { id: "a1", choice: "0" } });
  await h.send({ id: 2, op: "mode.set", args: { mode: "plan" } });
  await h.send({ id: 3, op: "settings.write", args: { theme: "dark" } });
}
// serve.ts: not-allowed method on an open desk, and a method that works
{
  const h = harness("desk-call", backend);
  await h.send({ id: 1, op: "desk.open", args: { key: "k", tools: [] } });
  await h.send({ id: 2, op: "desk.call", args: { key: "k", method: "rm", args: [] } });
  await h.send({ id: 3, op: "desk.call", args: { key: "k", method: "abort", args: [] } });
  await h.send({ id: 4, op: "desk.call", args: { key: "k", method: "dispose", args: [] } });
}
// serve.ts: the reads whose value is the backend's own
{
  const h = harness("reads", backend);
  await h.send({ id: 1, op: "hello", args: null });
  await h.send({ id: 2, op: "desks.list", args: [] });
  await h.send({ id: 3, op: "team", args: null });
  await h.send({ id: 4, op: "models.refresh", args: null });
  await h.send({ id: 5, op: "auth.providers", args: null });
  await h.send({ id: 6, op: "auth.check", args: { provider: "huggingface" } });
  await h.send({ id: 7, op: "mcp", args: {} });
}
// serve.ts: streams answer `true`; the event a watcher gets is a one-way frame
{
  let push: any;
  const h = harness("watches", { ...backend, desks: { ...backend.desks, watch: async (cb: any) => ((push = cb), cb([]), () => {}) } });
  await h.send({ id: 1, op: "desks.watch", args: null });
  await h.send({ id: 2, op: "watch", args: null });
}
// wire.test.ts: events, a cancel, a non-JSON line, an Error on the wire
{
  const h = harness("frames", backend);
  rows.push({ case: "frames", dir: "in", line: "Debugger attached.\n" });
  h.peer.feed(enc.encode("Debugger attached.\n"));
  h.peer.emit("desk", "k", { type: "message_update", i: 0, kind: "text", delta: "héllo ✓" });
  h.peer.emit("bench", "*", { type: "ask_resolved", id: "a1" });
  await h.send({ cancel: 99 });
  rows.push({ case: "frames", dir: "out", line: encode({ re: 1, ok: false, error: new TypeError("bad") }) });
}
console.log(JSON.stringify({ protocol: PROTOCOL, rows }, null, 1));
process.exit(0);
