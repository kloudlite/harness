import { theme } from "../theme.ts";
import type { FileDiff } from "../diff.ts";

const MAX_LINES = 20;

/**
 * Unified-diff hunk: line-number gutter, +/- signs, added/removed rows on
 * tinted backgrounds (Claude Code's edit rendering).
 */
export function DiffView({ diff }: { diff: FileDiff }) {
  const shown = diff.lines.slice(0, MAX_LINES);
  const hidden = diff.lines.length - shown.length;
  return (
    <box flexDirection="column">
      {shown.map((line, i) => {
        const fg =
          line.sign === "+" ? theme.diffAdded : line.sign === "-" ? theme.diffRemoved : theme.fg;
        const bg =
          line.sign === "+" ? theme.diffAddedBg : line.sign === "-" ? theme.diffRemovedBg : undefined;
        return (
          <box key={i} flexDirection="row" backgroundColor={bg}>
            <box width={6} flexShrink={0}>
              <text fg={line.sign === " " ? theme.muted : fg}>{String(line.no).padStart(4)}</text>
            </box>
            <box width={2} flexShrink={0}>
              <text fg={fg}>{line.sign === " " ? "" : line.sign}</text>
            </box>
            <text fg={fg}>{line.text || " "}</text>
          </box>
        );
      })}
      {hidden > 0 && (
        <box paddingLeft={6}>
          <text fg={theme.muted}>… +{hidden} more lines</text>
        </box>
      )}
    </box>
  );
}
