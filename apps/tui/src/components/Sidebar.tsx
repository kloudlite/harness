import { TextAttributes } from "@opentui/core";
import { theme } from "../theme.ts";
import type { Service, Workspace, WorkspaceStatus } from "../workspaces.ts";

// resolved per render: the theme singleton mutates on /theme
const dot = (status: WorkspaceStatus) =>
  ({ attached: theme.accent, running: theme.success, cloning: theme.warning, stopped: theme.muted })[status];

/** opencode-style: quiet sections — bold header, plain rows, color carries state. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <box flexDirection="column">
      <text fg={theme.fg}><b>{title}</b></text>
      {children}
    </box>
  );
}

export function Sidebar({
  workspaces,
  services,
  envName,
  running,
  focus,
  width,
  tokens,
}: {
  workspaces: Workspace[];
  services: Service[];
  envName: string;
  /** Per-workspace: session has a turn running */
  running: boolean[];
  /** 0 = main context, 1..N = workspace */
  focus: number;
  width: number;
  tokens: number;
}) {
  const ws = focus > 0 ? workspaces[focus - 1] : undefined;
  return (
    <box
      flexDirection="column"
      width={width}
      height="100%"
      flexShrink={0}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
      backgroundColor={theme.sidebarBg}
    >
      <scrollbox flexGrow={1} flexBasis={0} flexShrink={1} scrollbarOptions={{ visible: false }}>
      <box flexDirection="column" flexShrink={0} gap={1} paddingRight={1}>
      <Section title="Workspaces">
        {workspaces.map((w, i) => {
          const active = focus === i + 1;
          return (
            <text key={w.id}>
              <span fg={dot(w.status)}>•</span>{" "}
              <span
                fg={active ? theme.accent : theme.muted}
                attributes={active ? TextAttributes.BOLD : undefined}
              >
                {w.name}
              </span>{" "}
              <span fg={theme.muted} attributes={TextAttributes.DIM}>
                {w.status === "cloning" ? (w.progress ?? w.status) : w.status}
              </span>
              {running[i] ? <span fg={theme.warning}> ⋯</span> : ""}
            </text>
          );
        })}
      </Section>

      <Section title="Services">
        {services.map((svc) => (
          <text key={svc.name}>
            <span fg={theme.muted} attributes={TextAttributes.DIM}>
              {svc.name}.{envName}:{svc.port}
            </span>
            {svc.interceptedBy ? (
              <span fg={theme.warning}> → {svc.interceptedBy}</span>
            ) : (
              ""
            )}
          </text>
        ))}
      </Section>

      <Section title="Context">
        <text fg={theme.muted}>{tokens.toLocaleString()} tokens</text>
        <text fg={theme.muted}>0% used</text>
        <text fg={theme.muted}>$0.00 spent</text>
      </Section>

      </box>
      </scrollbox>

      {/* pinned footer, opencode: flexShrink 0, gap 1, paddingTop 1 */}
      <box flexDirection="column" flexShrink={0} gap={1} paddingTop={1}>
      {ws && (
        <box flexDirection="column">
          <text fg={theme.accent}><b>{ws.name}</b></text>
          <text fg={theme.muted} attributes={TextAttributes.DIM}>{ws.repo}</text>
          <text fg={theme.muted}>⎇ {ws.branch}</text>
          <text fg={theme.muted}>
            {ws.ports.length > 0
              ? `ports ${ws.ports.map((p) => `:${p}`).join(" ")}`
              : "no exposed ports"}
          </text>
        </box>
      )}
      <text fg={theme.muted}>
        <span fg={theme.accent}>•</span> kloud<b>lite</b>{" "}
        <span attributes={TextAttributes.DIM}>v0.0.0</span>
      </text>
      </box>
    </box>
  );
}
