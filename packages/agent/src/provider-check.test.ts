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

const hfWith = (status: number, body: unknown) => {
  const s = Bun.serve({ port: 0, fetch: () => Response.json(body, { status }) });
  servers.push(s);
  process.env.KLOUDLITE_HF_WHOAMI_URL = `http://127.0.0.1:${s.port}`;
  return { getAuth: async () => ({ auth: { apiKey: "hf_test" } }) };
};

test("checkProvider reads the token's scope, treats 401 as blocked, and never guesses offline or for other providers", async () => {
  expect((await checkProvider(hfWith(200, fine(["repo.content.read"])), "huggingface")).state).toBe("blocked");
  expect((await checkProvider(hfWith(200, fine(["inference.serverless.write"])), "huggingface")).state).toBe("ok");
  expect((await checkProvider(hfWith(401, {}), "huggingface")).state).toBe("blocked");
  expect((await checkProvider(hfWith(500, {}), "huggingface")).state).toBe("unknown");
  expect((await checkProvider(hfWith(200, {}), "deepseek")).state).toBe("unknown");
  const none = { getAuth: async () => undefined };
  expect((await checkProvider(none, "huggingface")).state).toBe("unknown");
  process.env.KLOUDLITE_HF_WHOAMI_URL = "http://127.0.0.1:1";
  expect((await checkProvider({ getAuth: async () => ({ auth: { apiKey: "k" } }) }, "huggingface")).state).toBe("unknown");
});
