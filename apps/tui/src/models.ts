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
 * Providers whose credential resolved but cannot run inference: refused (401/403) on a request, or
 * shown to lack the permission by a scope probe. A connector can be linked for git and still lack
 * inference rights, and auth keeps listing it as connected, so only these two signals tell. A fresh
 * login replaces the credential and clears the mark.
 */
type Blocked = { reason: string; at: number; detail: string };
const unusable = new Map<string, Blocked>();
/** `reason` is the short form the menu shows; `detail` is the full text, shown when the user reconnects. */
export const markUnusable = (provider: string, reason = "the provider refused the request", detail = reason) =>
  void unusable.set(provider, { reason, at: Date.now(), detail });
export const isUnusable = (provider: string) => unusable.has(provider);
export const unusableInfo = (provider: string) => unusable.get(provider);
export const clearUnusable = (provider: string) => {
  unusable.delete(provider);
  probed.delete(provider);
  verdicts.delete(provider);
};

/** What the scope probe said last, per provider. `unknown` is "could not verify" and is never treated as fine. */
const verdicts = new Map<string, { state: "ok" | "blocked" | "unknown" | "none"; reason?: string }>();
export const verdictOf = (provider: string) => verdicts.get(provider);

/** Providers the scope probe has already judged this run: one probe per credential, cleared by a login. */
const probed = new Set<string>();

/**
 * Ask the backend whether each connected provider can run inference, once per credential. A
 * `blocked` verdict marks it unusable up front, so the first prompt never has to find out.
 * `force` re-asks (the `/model test` action). Returns the providers it marked.
 */
export async function probeProviders(auth: Map<string, { ok: boolean }>, force = false): Promise<string[]> {
  const marked: string[] = [];
  await Promise.all(
    [...auth]
      .filter(([p, a]) => a.ok && (force || !probed.has(p)))
      .map(async ([p]) => {
        probed.add(p);
        const v = await backend().auth.check(p).catch(() => undefined);
        if (v) verdicts.set(p, v);
        if (v?.state === "blocked") {
          markUnusable(p, v.reason);
          marked.push(p);
        }
        // an ok does not clear a mark: a refused real request outranks a probe, and only a new login lifts it
      }),
  );
  return marked;
}

/** The model call was refused for want of permission, not for a transient fault. */
export const isAuthRefusal = (message: string) => /\b(401|403)\b|unauthori[sz]ed|insufficient permissions/i.test(message);

/** A loaded auth map that has no working credential for the provider; an unloaded (empty) one decides nothing. */
export function lacksCredentials(auth: Map<string, { ok: boolean }>, provider: string): boolean {
  return isUnusable(provider) || (auth.size > 0 && !auth.get(provider)?.ok);
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
  // a provider the probe confirmed outranks one it could not verify, which outranks the rest
  const rank = (p: string) => (verdicts.get(p)?.state === "ok" ? 0 : verdicts.get(p)?.state === "unknown" ? 2 : 1);
  const sorted = [...ok].sort((a, b) => rank(a.provider) - rank(b.provider) || a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id));
  if (!sorted.length) return undefined;
  const top = sorted.filter((m) => rank(m.provider) === rank(sorted[0]!.provider));
  const best =
    ["deepseek-v4-flash", "deepseek-flash"].map((id) => top.find((m) => m.id === id)).find(Boolean) ??
    top.find((m) => FAST.test(m.id)) ??
    top[0];
  return best && { provider: best.provider, id: best.id };
}

export function findModel(ref: ModelRef): CatalogModel | undefined {
  return catalog.find((m) => m.provider === ref.provider && m.id === ref.id);
}

export function modelLabel(ref: ModelRef): string {
  return findModel(ref)?.name ?? ref.id;
}
