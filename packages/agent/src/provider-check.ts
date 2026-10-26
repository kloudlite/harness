/**
 * Whether a provider whose credential resolves can actually run inference. `auth.ok` only says a
 * credential exists: a Hugging Face token made for git or pushes resolves fine and still gets a 403
 * from Inference Providers. Only providers whose token scope can be read cheaply have a probe;
 * every other provider is `unknown`, and the 403 a real request returns is what marks it.
 */
export type ProviderCheck = { state: "ok" | "blocked" | "unknown"; reason?: string };

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
    : { state: "blocked", reason: "the token has no Inference Providers permission" };
}

export async function checkProvider(models: { getAuth(id: string): Promise<{ auth: { apiKey?: string } } | undefined> }, provider: string): Promise<ProviderCheck> {
  if (provider !== "huggingface") return { state: "unknown" };
  const key = (await models.getAuth(provider).catch(() => undefined))?.auth.apiKey;
  if (!key) return { state: "unknown" };
  try {
    const r = await fetch(WHOAMI(), {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5000),
    });
    if (r.status === 401) return { state: "blocked", reason: "the token was rejected" };
    if (!r.ok) return { state: "unknown" };
    return hfInference(await r.json());
  } catch {
    return { state: "unknown" }; // offline is not a verdict
  }
}
