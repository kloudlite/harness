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

export async function checkProvider(
  models: { getAuth(id: string): Promise<{ auth: { apiKey?: string; headers?: Record<string, unknown> } } | undefined> },
  provider: string,
): Promise<ProviderCheck> {
  if (provider !== "huggingface") return { state: "none" };
  const key = tokenOf((await models.getAuth(provider).catch(() => undefined))?.auth) ?? process.env.HF_TOKEN;
  if (!key) return { state: "unknown", reason: "no token to read" };
  try {
    const r = await fetch(WHOAMI(), {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5000),
    });
    if (r.status === 401) return { state: "blocked", reason: "token rejected" };
    if (!r.ok) return { state: "unknown", reason: `Hugging Face answered ${r.status}` };
    return hfInference(await r.json());
  } catch {
    return { state: "unknown", reason: "Hugging Face did not answer" }; // offline is not a verdict
  }
}
