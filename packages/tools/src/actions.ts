//! One tool per resource: `action` picks the verb, the schema is the union of the actions' properties
//! and the per-action required list is checked when the call arrives (the error carries that action's
//! own schema, so a model fixes the call without a second look-up). Every failure is JSON text,
//! `{error, hint?, schema?}`, so a model reads one shape whichever layer refused.
import { checkArgs } from "./args.ts";
import type { ToolDef } from "./index.ts";

type Props = Record<string, unknown>;
export type Action = {
  properties: Props;
  required: string[];
  run: (a: any) => Promise<string>;
  /** Keys where an explicit `null` is a value (`session use` with `environment: null` disconnects), not "omitted". */
  nulls?: string[];
  /** Unlisted spellings read as the listed key (`{snapshot_id: "source"}`): kept out of the schema on purpose. */
  alias?: Record<string, string>;
};

/** What the tool knows to say after a refusal from /v1, keyed on the status the message starts with. */
function hintFor(message: string): string | undefined {
  if (/^409\b/.test(message) && /limit|quota|in use/i.test(message)) return "ask for more with request_create";
  if (/^404\b/.test(message)) return "check the list action";
  return undefined;
}

/** The text of a failure: an `Error` whose message is `{error, hint?, schema?}` as JSON. */
export function failure(message: string, schema?: unknown): Error {
  // /v1 refuses an out-of-audience call with 403 {error, missing_scope}: pass both on, with where to go instead
  const m = /^403\b[^{]*(\{.*\})\s*$/s.exec(message);
  if (m) {
    try {
      const j = JSON.parse(m[1]!);
      if (j?.missing_scope) return new Error(JSON.stringify({ error: j.error ?? message, missing_scope: j.missing_scope, hint: "use the console or the CLI as yourself", ...(schema ? { schema } : {}) }));
    } catch {}
  }
  const hint = hintFor(message);
  return new Error(JSON.stringify({ error: message, ...(hint ? { hint } : {}), ...(schema ? { schema } : {}) }));
}

/** Same property in several actions: one schema, and one description that names who reads what ("the new name (create); the session to pick (use)"). */
function merge(name: string, k: string, uses: { act: string; v: any }[], every: number): unknown {
  const bare = (v: any) => JSON.stringify({ ...v, description: undefined });
  if (uses.some((u) => bare(u.v) !== bare(uses[0]!.v))) throw new Error(`${name}: property \`${k}\` has two schemas (action ${uses.find((u) => bare(u.v) !== bare(uses[0]!.v))!.act})`);
  const groups = new Map<string, string[]>();
  for (const u of uses) {
    const d = String(u.v.description ?? "").replace(/[.\s]+$/, "");
    groups.set(d, [...(groups.get(d) ?? []), u.act]);
  }
  const who = (acts: string[]) => (acts.length === every && every > 1 ? "every action" : acts.join(", "));
  const text = [...groups].map(([d, acts]) => (d ? `${d} (${who(acts)})` : `read by ${who(acts)}`)).join("; ");
  const { description: _d, ...rest } = uses[0]!.v;
  return { ...rest, description: (groups.size > 1 ? `${k}: ` : "") + text.replace(/^./, (c) => c.toUpperCase()) + "." };
}

export function resource(name: string, description: string, actions: Record<string, Action>): ToolDef {
  const uses: Record<string, { act: string; v: any }[]> = {};
  for (const [act, a] of Object.entries(actions)) for (const [k, v] of Object.entries(a.properties)) (uses[k] ??= []).push({ act, v });
  const properties: Props = {};
  for (const [k, u] of Object.entries(uses)) properties[k] = merge(name, k, u, Object.keys(actions).length);
  const names = Object.keys(actions);
  const inputSchema = { type: "object", properties: { action: { type: "string", enum: names }, ...properties }, required: ["action"] };
  return {
    name,
    description,
    inputSchema,
    async run(input: any) {
      const act = input?.action;
      const a = typeof act === "string" ? actions[act] : undefined;
      if (!a) throw failure(`${name}: \`action\` must be one of ${names.join(", ")}; got ${JSON.stringify(act ?? null)}`);
      const { action: _, ...rest } = input;
      for (const [from, to] of Object.entries(a.alias ?? {})) if (rest[from] !== undefined) rest[to] ??= rest[from], delete rest[from];
      const kept = (a.nulls ?? []).filter((k) => rest[k] === null);
      const schema = { type: "object", properties: a.properties, required: a.required };
      const c = checkArgs(schema, rest);
      if ("error" in c) throw failure(`${name} ${act}: ${c.error}`, { action: act, ...schema });
      for (const k of kept) c.args[k] = null;
      let r: string;
      try {
        r = await a.run(c.args);
      } catch (e: any) {
        throw failure(String(e?.message ?? e));
      }
      if (r.startsWith("error: ")) throw failure(r.slice(7));
      return r;
    },
  };
}
