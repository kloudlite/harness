import { TextAttributes } from "@opentui/core";
import { theme } from "../theme.ts";
import { Spinner } from "./Spinner.tsx";

/** Bottom bar: context path (+ spinner while busy) left; tokens, hints right. */
export function HintBar({
  busy,
  tokens,
  queued,
  active,
  inWorkspace,
  normal,
}: {
  busy: boolean;
  tokens: number;
  queued: number;
  /** Context path: "main" or "main › <workspace>" */
  active: string;
  inWorkspace: boolean;
  normal: boolean;
}) {
  return (
    <box flexDirection="row" flexShrink={0} justifyContent="space-between">
      <box flexDirection="row" gap={2} marginLeft={1}>
        <text fg={theme.muted}>{active}</text>
        {queued > 0 && <text fg={theme.warning}>{queued} queued</text>}
        {busy && (
          <text fg={theme.fg}>
            <Spinner fg={theme.accent} />{" "}
            <span fg={theme.muted}>
              <b>esc</b> <span attributes={TextAttributes.DIM}>interrupt</span>
            </span>
          </text>
        )}
      </box>
      <box flexDirection="row" gap={2}>
        <text fg={theme.muted}>{tokens.toLocaleString()} tok</text>
        {normal ? (
          <>
            <text fg={theme.fg}>i <span fg={theme.muted}>type</span></text>
            <text fg={theme.fg}>j k <span fg={theme.muted}>workspaces</span></text>
            <text fg={theme.fg}>h l <span fg={theme.muted}>envs</span></text>
            <text fg={theme.fg}>p <span fg={theme.muted}>jump</span></text>
            <text fg={theme.fg}>a <span fg={theme.muted}>actions</span></text>
            {inWorkspace && <text fg={theme.fg}>m <span fg={theme.muted}>move</span></text>}
            <text fg={theme.fg}>/ <span fg={theme.muted}>commands</span></text>
            <text fg={theme.fg}>? <span fg={theme.muted}>help</span></text>
          </>
        ) : (
          <>
            {inWorkspace && (
              <text fg={theme.fg}>! <span fg={theme.muted}>shell</span></text>
            )}
            <text fg={theme.fg}>enter <span fg={theme.muted}>send</span></text>
            <text fg={theme.fg}>esc <span fg={theme.muted}>normal mode</span></text>
          </>
        )}
      </box>
    </box>
  );
}
