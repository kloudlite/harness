//! Argument checking against a tool's own JSON schema, once, before its handler runs. A model that
//! sends `id` for `workspace`, `command` for `cmd`, or an array as a JSON string used to reach the
//! handler as `undefined` and read back "404: not found" or a TypeError; it now reads which key is
//! wrong and what the tool takes. Top-level keys only: nested shapes are the API's to refuse.

type Schema = { type?: string; oneOf?: Schema[]; anyOf?: Schema[]; enum?: unknown[]; minimum?: number; properties?: Record<string, Schema>; required?: string[] };

const jsonType = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

const branches = (s: Schema): Schema[] => s.oneOf ?? s.anyOf ?? [s];

function matches(v: unknown, t: string | undefined): boolean {
  switch (t) {
    case undefined:
      return true;
    case "integer":
      return Number.isInteger(v);
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    default:
      return jsonType(v) === t;
  }
}

const label = (s: Schema) => branches(s).map((b) => (b.type ?? "any")).join(" or ");

/** A string a model typed for an array/object/number/boolean, turned into the value it meant; anything unparsable is left for the type check to name. */
function coerce(v: unknown, s: Schema): unknown {
  if (typeof v !== "string") return v;
  const alts = branches(s);
  if (alts.some((b) => matches(v, b.type))) return v;
  for (const b of alts) {
    if (b.type === "array" || b.type === "object") {
      try {
        const p = JSON.parse(v);
        if (matches(p, b.type)) return p;
      } catch {}
    } else if ((b.type === "number" || b.type === "integer") && v.trim() !== "" && matches(Number(v), b.type)) return Number(v);
    else if (b.type === "boolean" && /^(true|false)$/i.test(v.trim())) return v.trim().toLowerCase() === "true";
  }
  return v;
}

/** The coerced arguments, or the one sentence that names what is wrong. */
export function checkArgs(schema: Record<string, unknown>, input: unknown): { args: any } | { error: string } {
  const s = schema as Schema;
  const props = s.properties ?? {};
  const given: Record<string, unknown> = input && typeof input === "object" && !Array.isArray(input) ? { ...(input as object) } : {};
  for (const k of Object.keys(given)) if (given[k] === null) delete given[k]; // null is how a model says "omitted"
  const missing = (s.required ?? []).filter((k) => given[k] === undefined);
  const unknown = Object.keys(given).filter((k) => !(k in props));
  if (missing.length && unknown.length)
    return { error: `unknown argument ${unknown.map((k) => `\`${k}\``).join(", ")}; this tool takes ${Object.keys(props).join(", ") || "no arguments"} (${missing.map((k) => `\`${k}\``).join(", ")} required)` };
  if (missing.length) return { error: `\`${missing[0]}\` is required` };
  for (const [k, p] of Object.entries(props)) {
    if (given[k] === undefined) continue;
    given[k] = coerce(given[k], p);
    if (!branches(p).some((b) => matches(given[k], b.type))) return { error: `\`${k}\` must be ${label(p)}; got ${jsonType(given[k])}` };
    if (p.minimum !== undefined && typeof given[k] === "number" && (given[k] as number) < p.minimum) return { error: `\`${k}\` must be at least ${p.minimum}; got ${given[k]}` };
    if (p.enum && !p.enum.includes(given[k])) return { error: `\`${k}\` must be one of ${p.enum.join(", ")}; got ${JSON.stringify(given[k])}` };
  }
  return { args: given };
}

/** Wrap a handler so it only ever sees checked arguments. A refusal is an `error: ` text, which `def`'s `checked` turns into a thrown error. */
export const guarded = <I>(schema: Record<string, unknown>, run: (a: any) => Promise<string>) => async (input: I): Promise<string> => {
  const c = checkArgs(schema, input);
  return "error" in c ? `error: ${c.error}` : run(c.args);
};
