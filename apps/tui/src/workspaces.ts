/**
 * MOCK DATA — placeholder shape only, so the sidebar has something to render
 * while we settle the UI. Nothing here reflects real kloudlite semantics yet;
 * replace wholesale once attach/clone is designed.
 */
export type WorkspaceStatus = "running" | "attached" | "stopped" | "cloning";

export type Workspace = {
  id: string;
  name: string;
  /** User that owns (and can attach to) this workspace. */
  owner: string;
  status: WorkspaceStatus;
  /** Clone progress, e.g. "42%" — only meaningful while status is "cloning". */
  progress?: string;
  /** Ports the workspace exposes. */
  ports: number[];
  repo: string;
  branch: string;
};

export type Service = {
  name: string;
  port: number;
  /** Workspace currently intercepting this service's traffic, if any. */
  interceptedBy?: string;
};

export type Environment = {
  id: string;
  name: string;
  /** User (or team) that owns this environment. */
  owner: string;
  workspaces: Workspace[];
  services: Service[];
};

/** The signed-in user (mock until kloudlite auth is wired). */
export const CURRENT_USER = "karthik";

/** Display label: own environments by name, others as owner/name. */
export function envLabel(e: Environment): string {
  return e.owner === CURRENT_USER ? e.name : `${e.owner}/${e.name}`;
}

export const MOCK_ENVIRONMENTS: Environment[] = [
  {
    id: "e1",
    name: "production",
    owner: "karthik",
    workspaces: [
      { id: "w1", name: "api-gateway", owner: "karthik", status: "attached", ports: [8080, 9090], repo: "kloudlite/api-gateway", branch: "feat/rate-limits" },
      { id: "w2", name: "billing-svc", owner: "karthik", status: "running", ports: [8081], repo: "kloudlite/billing-svc", branch: "main" },
      { id: "w3", name: "console-web", owner: "karthik", status: "cloning", progress: "42%", ports: [], repo: "kloudlite/console-web", branch: "main" },
      { id: "w4", name: "infra-iac", owner: "karthik", status: "stopped", ports: [], repo: "kloudlite/infra-iac", branch: "main" },
    ],
    services: [
      { name: "postgres", port: 5432 },
      { name: "redis", port: 6379 },
      { name: "api", port: 8080, interceptedBy: "api-gateway" },
      { name: "console", port: 3000 },
    ],
  },
  {
    id: "e2",
    name: "staging",
    owner: "karthik",
    workspaces: [
      { id: "w5", name: "api-gateway", owner: "karthik", status: "running", ports: [8080], repo: "kloudlite/api-gateway", branch: "staging" },
      { id: "w6", name: "console-web", owner: "karthik", status: "stopped", ports: [], repo: "kloudlite/console-web", branch: "staging" },
    ],
    services: [
      { name: "postgres", port: 5432 },
      { name: "api", port: 8080, interceptedBy: "api-gateway" },
    ],
  },
  {
    id: "e4",
    name: "qa",
    owner: "karthik",
    workspaces: [
      { id: "w8", name: "e2e-runner", owner: "karthik", status: "running", ports: [7070], repo: "kloudlite/e2e", branch: "main" },
    ],
    services: [
      { name: "postgres", port: 5432 },
      { name: "api", port: 8080 },
    ],
  },
  {
    id: "e3",
    name: "dev-karthik",
    owner: "karthik",
    workspaces: [
      { id: "w7", name: "playground", owner: "karthik", status: "attached", ports: [3000, 8080], repo: "karthik/playground", branch: "main" },
    ],
    services: [{ name: "postgres", port: 5432 }],
  },
  // other users' environments — workspaces can connect into them
  {
    id: "e5",
    name: "payments",
    owner: "sara",
    workspaces: [
      { id: "w9", name: "checkout-svc", owner: "sara", status: "running", ports: [8080], repo: "kloudlite/checkout-svc", branch: "main" },
    ],
    services: [
      { name: "postgres", port: 5432 },
      { name: "payments-api", port: 8080, interceptedBy: "checkout-svc" },
      { name: "ledger", port: 8081 },
    ],
  },
  {
    id: "e6",
    name: "ml-serving",
    owner: "arjun",
    workspaces: [],
    services: [
      { name: "inference", port: 9000 },
      { name: "feature-store", port: 6566 },
      { name: "redis", port: 6379 },
    ],
  },
  {
    id: "e7",
    name: "staging",
    owner: "devops",
    workspaces: [
      { id: "w10", name: "loadgen", owner: "devops", status: "stopped", ports: [], repo: "kloudlite/loadgen", branch: "main" },
    ],
    services: [
      { name: "postgres", port: 5432 },
      { name: "api", port: 8080 },
      { name: "grafana", port: 3000 },
    ],
  },
];
