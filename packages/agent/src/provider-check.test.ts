import { afterEach, expect, test } from "bun:test";
import { checkProvider, hfInference } from "./provider-check.ts";

const fine = (permissions: string[], scoped: unknown[] = []) => ({
  auth: { accessToken: { fineGrained: { global: permissions, scoped } } },
});

test("a classic token is judged ok; a fine-grained one needs an inference permission", () => {
  expect(hfInference({ auth: { accessToken: { role: "read" } } }).state).toBe("ok");
  expect(hfInference(fine(["repo.content.read"])).state).toBe("blocked");
  expect(hfInference(fine(["repo.write", "inference.serverless.write"])).state).toBe("ok");
  expect(hfInference(fine([], [{ permissions: ["inference.endpoints.infer.write"] }])).state).toBe("ok");
});

const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(() => {
  while (servers.length) servers.pop()!.stop(true);
  delete process.env.KLOUDLITE_HF_WHOAMI_URL;
});

let seen = "";
const hfWith = (status: number, body: unknown, auth: Record<string, unknown> = { apiKey: "hf_test" }) => {
  const s = Bun.serve({ port: 0, fetch: (r) => ((seen = r.headers.get("authorization") ?? ""), Response.json(body, { status })) });
  servers.push(s);
  process.env.KLOUDLITE_HF_WHOAMI_URL = `http://127.0.0.1:${s.port}`;
  return { getAuth: async () => ({ auth }) };
};

test("checkProvider reads the token's scope, treats 401 as blocked, and never guesses offline or for other providers", async () => {
  expect((await checkProvider(hfWith(200, fine(["repo.content.read"])), "huggingface")).state).toBe("blocked");
  expect((await checkProvider(hfWith(200, fine(["inference.serverless.write"])), "huggingface")).state).toBe("ok");
  expect((await checkProvider(hfWith(401, {}), "huggingface")).state).toBe("blocked");
  expect((await checkProvider(hfWith(500, {}), "huggingface")).state).toBe("unknown");
  expect((await checkProvider(hfWith(200, {}), "deepseek")).state).toBe("none");
  const none = { getAuth: async () => undefined };
  expect((await checkProvider(none, "huggingface")).state).toBe("unknown");
  process.env.KLOUDLITE_HF_WHOAMI_URL = "http://127.0.0.1:1";
  expect((await checkProvider({ getAuth: async () => ({ auth: { apiKey: "k" } }) }, "huggingface")).state).toBe("unknown");
});

// A linked or OAuth login has no API key: its access token rides in an Authorization header.
test("checkProvider reads an OAuth access token from the auth headers, and says why it could not verify", async () => {
  const oauth = hfWith(200, fine(["repo.content.read"]), { headers: { Authorization: "Bearer oauth-access-1" } });
  expect((await checkProvider(oauth, "huggingface")).state).toBe("blocked");
  expect(seen).toBe("Bearer oauth-access-1");
  const none = { getAuth: async () => ({ auth: {} }) };
  delete process.env.HF_TOKEN;
  const v = await checkProvider(none, "huggingface");
  expect(v).toEqual({ state: "unknown", reason: "no token to read" });
});
