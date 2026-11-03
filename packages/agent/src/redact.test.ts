import { expect, test } from "bun:test";
import { redactSecretCalls, redactingTranscript } from "./redact.ts";

const msg = { role: "assistant", content: [{ type: "text", text: "x" }, { type: "toolCall", id: "1", name: "secret_set", arguments: { owner: "o", name: "N", value: "hunter2" } }, { type: "toolCall", id: "2", name: "exec", arguments: { value: "keep" } }] };

test("the value of secret_set is redacted in a copy, other calls are kept", () => {
  const r: any = redactSecretCalls(msg);
  expect(r.content[1].arguments).toEqual({ owner: "o", name: "N", value: "***" });
  expect(r.content[2].arguments.value).toBe("keep");
  expect((msg.content[1] as any).arguments.value).toBe("hunter2");
});

test("a transcript writer stores the redacted message", () => {
  const seen: any[] = [];
  const sm = redactingTranscript({ appendMessage: (m: any) => seen.push(m) });
  sm.appendMessage(msg);
  sm.appendMessage({ role: "user", content: "hi" });
  expect(JSON.stringify(seen)).not.toContain("hunter2");
  expect(seen[1]).toEqual({ role: "user", content: "hi" });
});
