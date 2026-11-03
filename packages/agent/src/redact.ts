/** Tool calls whose `value` argument is a secret: the session transcript is stored at rest, and the
 * spec accepts the value passing through the model's context but not sitting in a file. */
const SECRET_CALLS = new Set(["secret_set"]);

/** A copy of a message with the `value` of every secret-setting tool call replaced by `***`; the live message is not touched. */
export function redactSecretCalls<T>(message: T): T {
  const m: any = message;
  if (!m || !Array.isArray(m.content) || !m.content.some((b: any) => b?.type === "toolCall" && SECRET_CALLS.has(b.name) && b.arguments && "value" in b.arguments)) return message;
  return {
    ...m,
    content: m.content.map((b: any) => (b?.type === "toolCall" && SECRET_CALLS.has(b.name) && b.arguments && "value" in b.arguments ? { ...b, arguments: { ...b.arguments, value: "***" } } : b)),
  };
}

/** Make a SessionManager write redacted messages. */
export function redactingTranscript<S extends { appendMessage: (m: any) => any }>(sm: S): S {
  const append = sm.appendMessage.bind(sm);
  sm.appendMessage = (m: any) => append(redactSecretCalls(m));
  return sm;
}
