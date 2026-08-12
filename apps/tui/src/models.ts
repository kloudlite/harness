import { listModels, models, providerAuth, readSettings, type ModelRef } from "@kloudlite-tui/agent";

export type { ModelRef };

/** Full pi-ai catalog: every provider, every model. */
export const catalog = listModels();

export const DEFAULT_MODEL: ModelRef = (() => {
  // last explicitly chosen model wins, when it still exists in the catalog
  const saved = readSettings().defaultModel;
  if (saved && models.getModel(saved.provider, saved.id)) return saved;
  const anthropic = catalog.find(
    (m) => m.provider === "anthropic" && /opus/.test(m.id),
  );
  return anthropic ?? catalog[0] ?? { provider: "anthropic", id: "claude-opus-5" };
})();

/** provider id → auth info; resolves once at startup. */
export async function loadProviderAuth(): Promise<Map<string, { ok: boolean; envKey?: string }>> {
  const all = await providerAuth();
  return new Map(all.map((a) => [a.provider, { ok: a.ok, envKey: a.envKeys[0] }]));
}

export function modelLabel(ref: ModelRef): string {
  const m = models.getModel(ref.provider, ref.id);
  return m?.name ?? ref.id;
}
