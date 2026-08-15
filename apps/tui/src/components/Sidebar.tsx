import { TextAttributes } from "@opentui/core";
import { theme } from "../theme.ts";
import { CURRENT_USER, type Service, type Workspace, type WorkspaceStatus } from "../workspaces.ts";

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
  envOwner,
  running,
  focus,
  width,
  tokens,
}: {
  workspaces: Workspace[];
  services: Service[];
  envName: string;
  /** Environment owner, shown when it isn't the signed-in user. */
  envOwner?: string;
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
      {/* the hierarchy: env › main › your workspaces, current level marked */}
      <box flexDirection="column">
        <text fg={theme.fg}><b>{envName}</b></text>
        {envOwner && (
          <text fg={theme.muted}>owned by <span fg={theme.accent}>{envOwner}</span></text>
        )}
        <text>
          <span fg={theme.muted}>└ </span>
          {focus === 0 ? (
            <span fg={theme.accent}><b>main</b></span>
          ) : (
            <span fg={theme.muted}>main</span>
          )}
          {focus === 0 ? <span fg={theme.muted}> ‹ you are here</span> : ""}
        </text>
        {workspaces.filter((w) => w.owner === CURRENT_USER).length === 0 && (
          <text fg={theme.muted} attributes={TextAttributes.DIM}>{"   └ "}no workspaces — ^a to create one</text>
        )}
        {workspaces.map((w, i) => {
          if (w.owner !== CURRENT_USER) return null;
          const active = focus === i + 1;
          return (
            <text key={w.id}>
              <span fg={theme.muted}>{"   └ "}</span>
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
              {active ? <span fg={theme.muted}> ‹ here</span> : ""}
            </text>
          );
        })}
      </box>
      {workspaces.some((w) => w.owner !== CURRENT_USER) && (
        <Section title="Other workspaces">
          {workspaces.map((w) =>
            w.owner === CURRENT_USER ? null : (
              <text key={w.id}>
                <span fg={dot(w.status)}>•</span>{" "}
                <span fg={theme.muted}>{w.name}</span>{" "}
                <span fg={theme.muted} attributes={TextAttributes.DIM}>
                  {w.status} · {w.owner}
                </span>
              </text>
            ),
          )}
        </Section>
      )}

      <Section title="Services">
        {services.map((svc) => (
          <text key={svc.name}>
            <span fg={theme.muted} attributes={TextAttributes.DIM}>
              {svc.name}.{envName}:{svc.port}
            </span>
            {svc.interceptedBy ? (
              <span fg={theme.warning}>
                {" "}→ {svc.interceptedBy}
                {(() => {
                  const owner = workspaces.find((w) => w.name === svc.interceptedBy)?.owner;
                  return owner && owner !== CURRENT_USER ? ` · ${owner}` : "";
                })()}
              </span>
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
