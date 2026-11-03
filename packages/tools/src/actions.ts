//! One tool per resource: `action` picks the verb, the schema is the union of the actions' properties
//! and the per-action required list is checked when the call arrives (the error carries that action's
//! own schema, so a model fixes the call without a second look-up).
import { checkArgs } from "./args.ts";
import type { ToolDef } from "./index.ts";

type Props = Record<string, unknown>;
export type Action = {
  properties: Props;
  required: string[];
  run: (a: any) => Promise<string>;
  /** Keys where an explicit `null` is a value (`session use` with `environment: null` disconnects), not "omitted". */
  nulls?: string[];
};

export function resource(name: string, description: string, actions: Record<string, Action>): ToolDef {
  const properties: Props = {};
  for (const [act, a] of Object.entries(actions))
    for (const [k, v] of Object.entries(a.properties)) {
      if (k in properties && JSON.stringify(properties[k]) !== JSON.stringify(v)) throw new Error(`${name}: property \`${k}\` has two schemas (action ${act})`);
      properties[k] = v;
    }
  const names = Object.keys(actions);
  const inputSchema = { type: "object", properties: { action: { type: "string", enum: names }, ...properties }, required: ["action"] };
  return {
    name,
    description,
    inputSchema,
    async run(input: any) {
      const act = input?.action;
      const a = typeof act === "string" ? actions[act] : undefined;
      if (!a) throw new Error(`${name}: \`action\` must be one of ${names.join(", ")}; got ${JSON.stringify(act ?? null)}`);
      const { action: _, ...rest } = input;
      const kept = (a.nulls ?? []).filter((k) => rest[k] === null);
      const schema = { type: "object", properties: a.properties, required: a.required };
      const c = checkArgs(schema, rest);
      if ("error" in c) throw new Error(`${name} ${act}: ${c.error}. Schema: ${JSON.stringify({ action: act, ...schema })}`);
      for (const k of kept) c.args[k] = null;
      const r = await a.run(c.args);
      if (r.startsWith("error: ")) throw new Error(r.slice(7));
      return r;
    },
  };
}
