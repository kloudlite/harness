// The model state machine against the real processes: a daemon and the TUI in a tmux pane, with
// credentials from the environment and a local stand-in for Hugging Face's whoami. Unit and app
// tests drive one process with fakes; this is the one that can see a daemon/session race.
//   bun run e2e        (needs tmux; offline, no real provider is called)
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("../../..", import.meta.url).pathname;
const tui = join(root, "apps/tui");
const daemonTs = join(root, "packages/backend/src/daemon.ts");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tmux = (...a: string[]) => Bun.spawnSync(["tmux", ...a]).stdout.toString();

const home = mkdtempSync(join(tmpdir(), "kl-e2e-"));
const cfg = join(home, "cfg");
mkdirSync(cfg, { recursive: true });
const sock = join(home, "host.sock");
const port = String(20000 + Math.floor(Math.random() * 20000));

// whoami for a fine-grained token that has no inference permission
const whoami = Bun.serve({
  port: 0,
  fetch: () => Response.json({ auth: { accessToken: { fineGrained: { global: ["repo.content.read"], scoped: [] } } } }),
});

const env = {
  HOME: home,
  KLOUDLITE_CONFIG_DIR: cfg,
  KL_HOST_SOCK: sock,
  KL_HOST_TUI_PORT: port,
  KLOUDLITE_HF_WHOAMI_URL: `http://127.0.0.1:${whoami.port}`,
  DEEPSEEK_API_KEY: "sk-e2e",
  HF_TOKEN: "hf_e2e",
};
const envArgs = Object.entries(env).map(([k, v]) => `${k}=${v}`).join(" ");

let failures = 0;
const expect = (name: string, ok: boolean, shown: () => string) => {
  console.log(`${ok ? "pass" : "FAIL"}  ${name}`);
  if (!ok) {
    failures++;
    console.log(shown().split("\n").filter((l) => l.trim()).slice(0, 25).join("\n"));
  }
};

const daemon = Bun.spawn(["bun", "run", daemonTs], { cwd: root, env: { ...process.env, ...env }, stdout: "ignore", stderr: "ignore" });

async function open(name: string): Promise<() => string> {
  tmux("kill-session", "-t", name);
  tmux("new-session", "-d", "-s", name, "-x", "140", "-y", "40", `sh -c 'cd ${tui} && env ${envArgs} bun run src/cli.tsx; sleep 120'`);
  return () => tmux("capture-pane", "-t", name, "-p");
}
// the pane wraps long lines and draws card borders: compare on the words alone
const flat = (s: string) => s.replace(/[┃╹▀╻▄█▀]+/g, " ").replace(/\s+/g, " ");
const has = (pane: () => string, text: string) => flat(pane()).includes(text);
async function until(pane: () => string, text: string, ms = 25000) {
  for (let t = 0; t < ms; t += 500) {
    if (has(pane, text)) return true;
    await sleep(500);
  }
  return false;
}
const settings = (m: { provider: string; id: string }) => writeFileSync(join(cfg, "settings.json"), JSON.stringify({ defaultModel: m }));

try {
  for (let i = 0; i < 40 && !(await Bun.file(sock).exists()); i++) await sleep(250);

  // 1. a saved model of a provider with no credentials: start moves off it and says so
  settings({ provider: "amazon-bedrock", id: "amazon.nova-2-lite-v1:0" });
  let pane = await open("kl-e2e-1");
  expect("start repair: unconnected saved model is replaced", await until(pane, "has no credentials; now using"), pane);
  expect("start repair: the prompt card follows", has(pane, "deepseek"), pane);
  tmux("kill-session", "-t", "kl-e2e-1");

  // 2. a connected provider whose token lacks inference rights is blocked before any prompt
  settings({ provider: "huggingface", id: "deepseek-ai/DeepSeek-R1" });
  pane = await open("kl-e2e-2");
  expect("scope probe: blocked provider is left at start", await until(pane, "is connected but cannot run inference"), pane);
  expect("scope probe: the card moved to the usable provider", await until(pane, "Working Session · DeepSeek V4.1 Flash deepseek"), pane);
  tmux("send-keys", "-t", "kl-e2e-2", "/model huggingface");
  await sleep(1500);
  expect("scope probe: /model shows one reconnect row", has(pane, "inference blocked") && has(pane, "Enter to reconnect") && !has(pane, "huggingface/deepseek-ai/"), pane);
  tmux("kill-session", "-t", "kl-e2e-2");

  // 3. the switch was saved: a restart opens on the usable model with the blocked one still blocked
  pane = await open("kl-e2e-3");
  await until(pane, "deepseek");
  expect("restart: opens on the saved usable model", has(pane, "deepseek") && !has(pane, "now using"), pane);
  tmux("kill-session", "-t", "kl-e2e-3");
} finally {
  daemon.kill();
  whoami.stop(true);
  rmSync(home, { recursive: true, force: true });
}
if (failures) {
  console.log(`${failures} failed`);
  process.exit(1);
}
console.log("all passed");
