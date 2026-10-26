/**
 * Whether a provider whose credential resolves can actually run inference. `auth.ok` only says a
 * credential exists: a Hugging Face token made for git or pushes resolves fine and still gets a 403
 * from Inference Providers. Only providers whose token scope can be read cheaply have a probe;
 * every other provider is `unknown`, and the 403 a real request returns is what marks it.
 */
export type ProviderCheck = {
  /** `unknown`: a probe exists but could not decide (no token found, offline); `none`: no probe exists for the provider. */
  state: "ok" | "blocked" | "unknown" | "none";
  reason?: string;
};

const WHOAMI = () => process.env.KLOUDLITE_HF_WHOAMI_URL ?? "https://huggingface.co/api/whoami-v2";
const ROUTER = () => process.env.KLOUDLITE_HF_ROUTER_URL ?? "https://router.huggingface.co/v1/chat/completions";

/** A `whoami-v2` answer judged for inference rights. Fine-grained tokens list permissions; classic ones are role-wide. */
export function hfInference(whoami: any): ProviderCheck {
  const fine = whoami?.auth?.accessToken?.fineGrained;
  if (!fine) return { state: "ok" };
  const perms: string[] = [
    ...(fine.global ?? []),
    ...(fine.scoped ?? []).flatMap((s: any) => s?.permissions ?? []),
  ];
  return perms.some((p) => /inference/i.test(p))
    ? { state: "ok" }
    : { state: "blocked", reason: "no inference permission" };
}

/** The bearer token a provider's credential resolves to: an API key, or the access token of an OAuth/linked login. */
function tokenOf(auth: { apiKey?: string; headers?: Record<string, unknown> } | undefined): string | undefined {
  if (auth?.apiKey) return auth.apiKey;
  const h = Object.entries(auth?.headers ?? {}).find(([k]) => k.toLowerCase() === "authorization")?.[1];
  return typeof h === "string" ? h.replace(/^bearer\s+/i, "") : undefined;
}

/**
 * The permission itself, by asking for one token of output. A classic or OAuth token lists no
 * permissions in whoami, so reading the scope says "fine" for a token that the router still refuses
 * with a 403; only a real request knows. The answer maps by status: 403 is the missing permission,
 * 402 spent credits, 429 a limit on a token that is allowed; anything else decides nothing.
 */
async function hfProbe(key: string, model: string): Promise<ProviderCheck> {
  try {
    const r = await fetch(ROUTER(), {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }], max_tokens: 1, stream: false }),
      signal: AbortSignal.timeout(20000),
    });
    if (r.ok || r.status === 429) return { state: "ok" };
    if (r.status === 401) return { state: "blocked", reason: "token rejected" };
    if (r.status === 403) return { state: "blocked", reason: "no inference permission" };
    if (r.status === 402) return { state: "blocked", reason: "no inference credits" };
    return { state: "unknown", reason: `the router answered ${r.status}` };
  } catch {
    return { state: "unknown", reason: "Hugging Face did not answer" };
  }
}

export async function checkProvider(
  models: { getAuth(id: string): Promise<{ auth: { apiKey?: string; headers?: Record<string, unknown> } } | undefined> },
  provider: string,
  /** A model of the provider to ask for one token with; without one only the free scope read runs. */
  model?: string,
): Promise<ProviderCheck> {
  if (provider !== "huggingface") return { state: "none" };
  const key = tokenOf((await models.getAuth(provider).catch(() => undefined))?.auth) ?? process.env.HF_TOKEN;
  if (!key) return { state: "unknown", reason: "no token to read" };
  // free first: a fine-grained token's own permission list settles it without spending anything
  let scope: ProviderCheck = { state: "unknown", reason: "Hugging Face did not answer" };
  try {
    const r = await fetch(WHOAMI(), { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5000) });
    if (r.status === 401) return { state: "blocked", reason: "token rejected" };
    if (r.ok) scope = hfInference(await r.json());
    else scope = { state: "unknown", reason: `Hugging Face answered ${r.status}` };
  } catch {
    // offline for the scope read: the request below may still decide
  }
  if (scope.state === "blocked") return scope;
  if (!model) return scope.state === "ok" ? { state: "unknown", reason: "scope looks fine; not tried" } : scope;
  return hfProbe(key, model);
}
