//! Platform sessions: the person's named working scope (`/v1/sessions`). `session_start` is the
//! one resolver every client uses before work starts: reuse the saved pick, the only session,
//! create `main` when there is none, or hand back a list to choose from. Persisting the pick is
//! the CLIENT's job (laptop door: kl-connect mcp; bench: kl-tui), so `saved` comes in as an arg.
import type { ToolDef } from "./index.ts";
import { apiJson, def, qs, seg } from "./platform.ts";

export type Mine = { id: string; name: string; environment: string }[];
export type Followed = { team: string; environment: string }[];
export type Env = { id: string; name: string };
export type Outcome =
  | { use: string; how: "saved" | "only" }
  | { create: string }
  | { choose: Mine }
  | { choose_environment: Env[] };

/** The decision alone: no IO. A saved id that is no longer in `mine` falls through to the count rules. */
export function decide(mine: Mine, saved: string | undefined, followed: Followed, envs: Env[], team?: string): Outcome {
  if (saved && mine.some((s) => s.id === saved)) return { use: saved, how: "saved" };
  if (mine.length === 1) return { use: mine[0]!.id, how: "only" };
  if (mine.length > 1) return { choose: mine };
  // ponytail: with no `team` the followed entry is taken only when it is the single one; add the caller's handle if that proves too strict.
  const f = team ? followed.find((x) => x.team === team) : followed.length === 1 ? followed[0] : undefined;
  if (f) return { create: f.environment };
  if (envs.length === 1) return { create: envs[0]!.id };
  return { choose_environment: envs };
}

const full = (id: string) => apiJson<any>("GET", `/v1/sessions/${seg(id)}`);

export function sessionTools(): ToolDef[] {
  const team = { type: "string", description: "The team slug. Leave out for the personal space." };
  return [
    def(
      "session_start",
      "Pick the platform session to work in. Call this first. It returns `{session, how}` (how: saved, only or created), or `{choose}` (several sessions: ask the person, then call session_use with the chosen id), or `{choose_environment}` (no session and no environment to start from: ask the person, then call session_create with name `main`). `saved` is the id the client remembered.",
      { team, saved: { type: "string" } },
      [],
      async (a) => {
        const mine = await apiJson<Mine>("GET", `/v1/sessions${qs({ team: a.team })}`);
        const followed = await apiJson<Followed>("GET", "/v1/me/environments");
        const o = decide(mine, a.saved, Array.isArray(followed) ? followed : [], [], a.team);
        // Environments are read only when nothing followed settles it.
        const out =
          "choose_environment" in o
            ? decide(mine, a.saved, [], await apiJson<Env[]>("GET", `/v1/environments${qs({ owner: a.team })}`), a.team)
            : o;
        if ("use" in out) return JSON.stringify({ session: await full(out.use), how: out.how }, null, 2);
        if ("create" in out) {
          const c = await apiJson<any>("POST", "/v1/sessions", { name: "main", ...(a.team ? { team: a.team } : {}), environment: out.create });
          return JSON.stringify({ session: c, how: "created" }, null, 2);
        }
        if ("choose" in out) return JSON.stringify({ choose: out.choose.map(({ id, name, environment }) => ({ id, name, environment })) }, null, 2);
        return JSON.stringify({ choose_environment: out.choose_environment.map(({ id, name }) => ({ id, name })) }, null, 2);
      },
    ),
    def("session_use", "Use one platform session, by id.", { id: { type: "string", description: "The session id from session_start's `choose`." } }, ["id"], async (a) =>
      JSON.stringify({ session: await full(a.id), how: "chosen" }, null, 2)),
    def(
      "session_create",
      "Create a platform session on an environment (after session_start returned `choose_environment`).",
      { name: { type: "string" }, environment: { type: "string", description: "The environment id." }, team },
      ["name", "environment"],
      async (a) => {
        const c = await apiJson<any>("POST", "/v1/sessions", { name: a.name, environment: a.environment, ...(a.team ? { team: a.team } : {}) });
        return JSON.stringify({ session: c, how: "created" }, null, 2);
      },
    ),
  ];
}
