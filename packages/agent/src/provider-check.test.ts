import { afterEach, expect, test } from "bun:test";
import { checkProvider, hfInference } from "./provider-check.ts";

const fine = (permissions: string[], scoped: unknown[] = []) => ({
  auth: { accessToken: { fineGrained: { global: permissions, scoped } } },
});
const classic = { auth: { accessToken: { role: "read" } } };

test("a classic token lists no permissions, so the scope read alone cannot call it verified", () => {
  expect(hfInference(classic).state).toBe("ok");
  expect(hfInference(fine(["repo.content.read"])).state).toBe("blocked");
  expect(hfInference(fine(["repo.write", "inference.serverless.write"])).state).toBe("ok");
  expect(hfInference(fine([], [{ permissions: ["inference.endpoints.infer.write"] }])).state).toBe("ok");
});

const servers: ReturnType<typeof Bun.serve>[] = [];
let seen = { whoami: "", router: "", body: "" };
afterEach(() => {
  while (servers.length) servers.pop()!.stop(true);
  delete process.env.KLOUDLITE_HF_WHOAMI_URL;
  delete process.env.KLOUDLITE_HF_ROUTER_URL;
  delete process.env.HF_TOKEN;
});

/** whoami and the router on one local server; `routerStatus` null means the router must not be called. */
const hf = (whoami: { status: number; body: unknown }, routerStatus: number | null, auth: Record<string, unknown> = { apiKey: "hf_test" }) => {
  seen = { whoami: "", router: "", body: "" };
  const s = Bun.serve({
    port: 0,
    fetch: async (r) => {
      const a = r.headers.get("authorization") ?? "";
      if (new URL(r.url).pathname === "/router") {
        seen.router = a;
        seen.body = await r.text();
        return Response.json({}, { status: routerStatus ?? 500 });
      }
      seen.whoami = a;
      return Response.json(whoami.body, { status: whoami.status });
    },
  });
  servers.push(s);
  process.env.KLOUDLITE_HF_WHOAMI_URL = `http://127.0.0.1:${s.port}/whoami`;
  process.env.KLOUDLITE_HF_ROUTER_URL = `http://127.0.0.1:${s.port}/router`;
  return { getAuth: async () => ({ auth }) };
};
const M = "deepseek-ai/DeepSeek-V3.2";

test("a fine-grained token without inference is blocked from its own permission list, spending nothing", async () => {
  const v = await checkProvider(hf({ status: 200, body: fine(["repo.content.read"]) }, null), "huggingface", M);
  expect(v).toEqual({ state: "blocked", reason: "no inference permission" });
  expect(seen.router).toBe("");
});

test("a classic token that whoami calls fine is judged by a one-token request: 403 blocks it, 200 verifies it", async () => {
  expect((await checkProvider(hf({ status: 200, body: classic }, 403), "huggingface", M)).reason).toBe("no inference permission");
  expect(JSON.parse(seen.body)).toMatchObject({ model: M, max_tokens: 1 });
  expect((await checkProvider(hf({ status: 200, body: classic }, 200), "huggingface", M)).state).toBe("ok");
  expect((await checkProvider(hf({ status: 200, body: classic }, 429), "huggingface", M)).state).toBe("ok");
  expect((await checkProvider(hf({ status: 200, body: classic }, 402), "huggingface", M)).reason).toBe("no inference credits");
  expect((await checkProvider(hf({ status: 200, body: classic }, 401), "huggingface", M)).reason).toBe("token rejected");
  expect((await checkProvider(hf({ status: 200, body: classic }, 404), "huggingface", M)).state).toBe("unknown");
});

test("a rejected token is blocked at whoami; without a model the scope alone is never called verified", async () => {
  expect((await checkProvider(hf({ status: 401, body: {} }, null), "huggingface", M)).reason).toBe("token rejected");
  expect((await checkProvider(hf({ status: 200, body: classic }, null), "huggingface")).state).toBe("unknown");
});

test("checkProvider answers none for providers it has no probe for, and unknown when it cannot read a token", async () => {
  expect((await checkProvider(hf({ status: 200, body: {} }, null), "deepseek", M)).state).toBe("none");
  expect(await checkProvider({ getAuth: async () => ({ auth: {} }) }, "huggingface", M)).toEqual({ state: "unknown", reason: "no token to read" });
  expect(await checkProvider({ getAuth: async () => undefined }, "huggingface", M)).toEqual({ state: "unknown", reason: "no token to read" });
});

// A linked or OAuth login has no API key: its access token rides in an Authorization header.
test("an OAuth access token is read from the auth headers and sent as the bearer", async () => {
  const oauth = hf({ status: 200, body: classic }, 403, { headers: { Authorization: "Bearer oauth-access-1" } });
  expect((await checkProvider(oauth, "huggingface", M)).state).toBe("blocked");
  expect(seen.whoami).toBe("Bearer oauth-access-1");
  expect(seen.router).toBe("Bearer oauth-access-1");
});

test("a token from HF_TOKEN is used when the credential carries none", async () => {
  process.env.HF_TOKEN = "hf_env";
  const m = hf({ status: 200, body: classic }, 200, {});
  expect((await checkProvider(m, "huggingface", M)).state).toBe("ok");
  expect(seen.router).toBe("Bearer hf_env");
});

test("offline decides nothing", async () => {
  process.env.KLOUDLITE_HF_WHOAMI_URL = "http://127.0.0.1:1/whoami";
  process.env.KLOUDLITE_HF_ROUTER_URL = "http://127.0.0.1:1/router";
  const v = await checkProvider({ getAuth: async () => ({ auth: { apiKey: "k" } }) }, "huggingface", M);
  expect(v.state).toBe("unknown");
});
