import { expect, test } from "bun:test";
import { models } from "@kloudlite-tui/agent";
import { spawnSync } from "bun";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { catalog, clearUnusable, isAuthRefusal, lacksCredentials, markUnusable, modelLabel, pickConnectedModel, refreshCatalog } from "./models.ts";

// pi's bundled JSON is an offline seed, and every provider is dynamic — so a
// never-refreshed catalog is pinned to whatever shipped in dist. This is the
// bug that stranded us on `deepseek-v4-flash`, an id DeepSeek stopped serving.
test("every provider is dynamic, so the seed is never the whole story", () => {
  // claude-bridge is ours, registered when any test mounts the app first (file order is not fixed)
  const providers = models.getProviders().filter((p) => p.id !== "claude-bridge");
  expect(providers.length).toBeGreaterThan(0);
  // if pi ever ships a static provider, refresh silently skips it
  const dynamic = providers.filter(
    (p) => typeof (p as { refreshModels?: unknown }).refreshModels === "function",
  );
  expect(dynamic.length).toBe(providers.length);
});

// refresh returns the live list and the exported `catalog` binding follows it
test("refreshCatalog returns the live list and updates the binding", async () => {
  const live = await refreshCatalog();
  expect(Array.isArray(live)).toBe(true);
  // Not >= the seed: a provider's live list can shrink between runs (a retired model, a failed fetch).
  expect(live.length).toBeGreaterThan(0);
  // not toBe: a refresh an earlier App test started can rebind `catalog` after ours returns
  expect(catalog).toEqual(live);
});

// A cold start knows only pi's bundled seed, so validating a saved model
// against the catalog at import time threw away any choice the seed predates:
// `deepseek-flash` (the one DeepSeek model that accepts images) became an
// default-model fallback on first launch. DEFAULT_MODEL is computed at import, and
// bun caches modules for the process — so this needs a real fresh process.
test("a saved default model survives a cold start", () => {
  const dir = mkdtempSync(join(tmpdir(), "kl-cold-"));
  writeFileSync(
    join(dir, "settings.json"),
    JSON.stringify({ defaultModel: { provider: "deepseek", id: "deepseek-flash" } }),
  );
  const out = spawnSync(
    [
      "bun",
      "-e",
      'const { LocalBackend } = await import("@kloudlite-tui/backend/local"); const { boot } = await import("./src/hello.ts"); const l = new LocalBackend(); boot(l, await l.hello()); const m = await import("./src/models.ts"); console.log(m.DEFAULT_MODEL.provider + "/" + m.DEFAULT_MODEL.id);',
    ],
    { cwd: import.meta.dir + "/..", env: { ...process.env, KLOUDLITE_CONFIG_DIR: dir } },
  );
  expect(out.stdout.toString().trim()).toBe("deepseek/deepseek-flash");
});

// the label is what the title bar shows before refresh lands
test("an unrefreshed model still labels as its id", () => {
  expect(modelLabel({ provider: "deepseek", id: "not-a-real-model" })).toBe("not-a-real-model");
});

test("lacksCredentials refuses an unconnected provider but not an unloaded auth map", () => {
  const auth = new Map([["deepseek", { ok: true }], ["amazon-bedrock", { ok: false }]]);
  expect(lacksCredentials(auth, "amazon-bedrock")).toBe(true);
  expect(lacksCredentials(auth, "unlisted")).toBe(true);
  expect(lacksCredentials(auth, "deepseek")).toBe(false);
  expect(lacksCredentials(new Map(), "amazon-bedrock")).toBe(false);
});

test("pickConnectedModel prefers the fast model of a connected provider and never an unconnected one", () => {
  const list = [
    { provider: "amazon-bedrock", id: "nova-2-lite" },
    { provider: "deepseek", id: "deepseek-chat" },
    { provider: "deepseek", id: "deepseek-flash" },
    { provider: "huggingface", id: "a-model" },
  ] as never;
  const auth = new Map([["deepseek", { ok: true }], ["huggingface", { ok: true }], ["amazon-bedrock", { ok: false }]]);
  expect(pickConnectedModel(list, auth, "deepseek")).toEqual({ provider: "deepseek", id: "deepseek-flash" });
  expect(pickConnectedModel(list, auth)).toEqual({ provider: "deepseek", id: "deepseek-flash" });
  expect(pickConnectedModel(list, auth, "huggingface")).toEqual({ provider: "huggingface", id: "a-model" });
  expect(pickConnectedModel(list, auth, "amazon-bedrock")).toBeUndefined();
  expect(pickConnectedModel(list, new Map())).toBeUndefined();
});

test("a provider refused with 401/403 is unusable until a fresh login, and is never picked", () => {
  const list = [
    { provider: "deepseek", id: "deepseek-flash" },
    { provider: "huggingface", id: "a-model" },
  ] as never;
  const auth = new Map([["deepseek", { ok: true }], ["huggingface", { ok: true }]]);
  expect(isAuthRefusal('403 "This authentication method does not have sufficient permissions"')).toBe(true);
  expect(isAuthRefusal("rate limited")).toBe(false);
  markUnusable("huggingface");
  expect(lacksCredentials(auth, "huggingface")).toBe(true);
  expect(pickConnectedModel(list, auth, "huggingface")).toBeUndefined();
  clearUnusable("huggingface");
  expect(lacksCredentials(auth, "huggingface")).toBe(false);
});

test("pickConnectedModel prefers a fast model over the alphabetical first", () => {
  const list = [
    { provider: "huggingface", id: "DeepSeek-R1" },
    { provider: "huggingface", id: "small-lite" },
  ] as never;
  const auth = new Map([["huggingface", { ok: true }]]);
  expect(pickConnectedModel(list, auth)).toEqual({ provider: "huggingface", id: "small-lite" });
});
