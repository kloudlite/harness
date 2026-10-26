import type { CatalogModel, ModelRef } from "@kloudlite-tui/backend";
import { backend, hello } from "./hello.ts";

export type { ModelRef };

/** Every provider's models, as the backend knows them; refreshed from the live lists. */
export let catalog: CatalogModel[] = hello().catalog;

/**
 * Every provider is dynamic — pi's bundled JSON is only an offline seed, and a seed goes stale.
 * The backend fetches each configured provider's live list and persists it.
 */
export async function refreshCatalog(): Promise<CatalogModel[]> {
  catalog = await backend().models.refresh();
  return catalog;
}

/** The backend resolved it (saved choice, else deepseek-v4-flash, else the first model). */
export const DEFAULT_MODEL: ModelRef = hello().defaultModel;

/** provider id → auth info; re-resolved after a login. */
export async function loadProviderAuth(): Promise<Map<string, { ok: boolean; envKey?: string }>> {
  const all = await backend().auth.providers();
  return new Map(all.map((a) => [a.provider, { ok: a.ok, envKey: a.envKeys[0] }]));
}

/**
 * Providers whose credential resolved but was refused (401/403) this run. A connector can be linked
 * for git and still lack inference rights, and auth keeps listing it as connected, so only a failed
 * request tells. Cleared by a fresh login, which replaces the credential.
 */
const unusable = new Set<string>();
export const markUnusable = (provider: string) => void unusable.add(provider);
export const clearUnusable = (provider: string) => void unusable.delete(provider);

/** The model call was refused for want of permission, not for a transient fault. */
export const isAuthRefusal = (message: string) => /\b(401|403)\b|unauthori[sz]ed|insufficient permissions/i.test(message);

/** A loaded auth map that has no working credential for the provider; an unloaded (empty) one decides nothing. */
export function lacksCredentials(auth: Map<string, { ok: boolean }>, provider: string): boolean {
  return unusable.has(provider) || (auth.size > 0 && !auth.get(provider)?.ok);
}

const FAST = /flash|lite|mini|haiku|nano|small|turbo/i;

/**
 * A model a connected provider can run: the one the harness prefers when it is there (fast and
 * cheap), else the first by name. `provider` limits the pick to a provider just connected.
 */
export function pickConnectedModel(
  list: readonly CatalogModel[],
  auth: Map<string, { ok: boolean }>,
  provider?: string,
): ModelRef | undefined {
  const ok = list.filter((m) => auth.get(m.provider)?.ok && !unusable.has(m.provider) && (!provider || m.provider === provider));
  const sorted = [...ok].sort((a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id));
  const best =
    ["deepseek-v4-flash", "deepseek-flash"].map((id) => ok.find((m) => m.id === id)).find(Boolean) ??
    sorted.find((m) => FAST.test(m.id)) ??
    sorted[0];
  return best && { provider: best.provider, id: best.id };
}

export function findModel(ref: ModelRef): CatalogModel | undefined {
  return catalog.find((m) => m.provider === ref.provider && m.id === ref.id);
}

export function modelLabel(ref: ModelRef): string {
  return findModel(ref)?.name ?? ref.id;
}
