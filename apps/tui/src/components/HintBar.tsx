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
}: {
  busy: boolean;
  tokens: number;
  queued: number;
  /** Context path: "main" or "main › <workspace>" */
  active: string;
  inWorkspace: boolean;
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
        {inWorkspace && (
          <text fg={theme.fg}>
            ! <span fg={theme.muted}>shell</span>
          </text>
        )}
        {inWorkspace && (
          <text fg={theme.fg}>
            ^e <span fg={theme.muted}>attach</span>
          </text>
        )}
        <text fg={theme.fg}>
          ^a <span fg={theme.muted}>actions</span>
        </text>
        <text fg={theme.fg}>
          ^p <span fg={theme.muted}>jump</span>
        </text>
        <text fg={theme.fg}>
          / <span fg={theme.muted}>commands</span>
        </text>
      </box>
    </box>
  );
}
