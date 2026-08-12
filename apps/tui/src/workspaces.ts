/**
 * MOCK DATA — placeholder shape only, so the sidebar has something to render
 * while we settle the UI. Nothing here reflects real kloudlite semantics yet;
 * replace wholesale once attach/clone is designed.
 */
export type WorkspaceStatus = "running" | "attached" | "stopped" | "cloning";

export type Workspace = {
  id: string;
  name: string;
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
  workspaces: Workspace[];
  services: Service[];
};

export const MOCK_ENVIRONMENTS: Environment[] = [
  {
    id: "e1",
    name: "production",
    workspaces: [
      { id: "w1", name: "api-gateway", status: "attached", ports: [8080, 9090], repo: "kloudlite/api-gateway", branch: "feat/rate-limits" },
      { id: "w2", name: "billing-svc", status: "running", ports: [8081], repo: "kloudlite/billing-svc", branch: "main" },
      { id: "w3", name: "console-web", status: "cloning", progress: "42%", ports: [], repo: "kloudlite/console-web", branch: "main" },
      { id: "w4", name: "infra-iac", status: "stopped", ports: [], repo: "kloudlite/infra-iac", branch: "main" },
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
    workspaces: [
      { id: "w5", name: "api-gateway", status: "running", ports: [8080], repo: "kloudlite/api-gateway", branch: "staging" },
      { id: "w6", name: "console-web", status: "stopped", ports: [], repo: "kloudlite/console-web", branch: "staging" },
    ],
    services: [
      { name: "postgres", port: 5432 },
      { name: "api", port: 8080, interceptedBy: "api-gateway" },
    ],
  },
  {
    id: "e4",
    name: "qa",
    workspaces: [
      { id: "w8", name: "e2e-runner", status: "running", ports: [7070], repo: "kloudlite/e2e", branch: "main" },
    ],
    services: [
      { name: "postgres", port: 5432 },
      { name: "api", port: 8080 },
    ],
  },
  {
    id: "e3",
    name: "dev-karthik",
    workspaces: [
      { id: "w7", name: "playground", status: "attached", ports: [3000, 8080], repo: "karthik/playground", branch: "main" },
    ],
    services: [{ name: "postgres", port: 5432 }],
  },
];
