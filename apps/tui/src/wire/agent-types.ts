//! The few types the wire shares with the agent that used to live in-process (packages/agent, now the Kode
//! runtime), copied as they were so the frames keep their shape.
export type ModelRef = { provider: string; id: string };
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type ProviderCheck = {
  /** `unknown`: a probe exists but could not decide (no token found, offline); `none`: no probe exists for the provider. */
  state: "ok" | "blocked" | "unknown" | "none";
  reason?: string;
};
