import { useRef } from "react";
import { useKeyboard } from "@opentui/react";
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import { theme } from "../theme.ts";
import { SplitBorder } from "../ui/border.ts";
import { DiffView } from "./Diff.tsx";
import type { FileDiff } from "../diff.ts";

export type Entry =
  | { kind: "user"; text: string }
  | { kind: "agent"; id?: string; text: string }
  | { kind: "thinking"; id?: string; text: string }
  | {
      kind: "tool";
      id?: string;
      name: string;
      summary: string;
      status?: "running" | "ok" | "error";
      /** Streaming / final output (rendered for bash blocks). */
      output?: string;
      error?: string;
      /** Unified diff hunk (edit/write tools). */
      diff?: FileDiff;
    }
  | { kind: "info"; text: string }
  | { kind: "error"; text: string };

const OUTPUT_MAX = 10;

function clipOutput(output?: string): string {
  if (!output) return "";
  const lines = output.trim().split("\n");
  const shown = lines.slice(-OUTPUT_MAX);
  const hidden = lines.length - shown.length;
  return (hidden > 0 ? [`… +${hidden} lines`, ...shown] : shown).join("\n");
}

/** Minimal inline markdown: **bold** and `code`. */
function Md({ text, fg }: { text: string; fg?: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <text fg={fg ?? theme.fg}>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**"))
          return <b key={i}>{part.slice(2, -2)}</b>;
        if (part.startsWith("`") && part.endsWith("`"))
          return <span key={i} fg={theme.accent}>{part.slice(1, -1)}</span>;
        return <span key={i}>{part}</span>;
      })}
    </text>
  );
}

const inlineIcon: Record<string, string> = {
  read: "→",
  glob: "→",
  grep: "→",
  write: "←",
  edit: "←",
};

const inlineVerb: Record<string, string> = {
  read: "Read",
  glob: "Glob",
  grep: "Grep",
  write: "Write",
  edit: "Edit",
};

/** Is this entry a one-line inline tool row (stacks tight, opencode-style)? */
function isInlineTool(entry: Entry): boolean {
  return entry.kind === "tool" && entry.name !== "bash";
}

/** Cap on rendered entries; older ones fall out of the scrollback. */
const SCROLLBACK = 200;

function Row({ entry }: { entry: Entry }) {
  switch (entry.kind) {
    case "user":
      // opencode UserMessage: native left border ┃ on the panel background
      return (
        <box
          border={["left"]}
          customBorderChars={SplitBorder.customBorderChars}
          borderColor={theme.accent}
        >
          <box paddingLeft={2} paddingTop={1} paddingBottom={1} backgroundColor={theme.surface}>
            <text fg={theme.fg}>{entry.text}</text>
          </box>
        </box>
      );
    case "agent":
      // opencode TextPart: markdown, paddingLeft 3
      return (
        <box paddingLeft={3}>
          <Md text={entry.text} />
        </box>
      );
    case "thinking": {
      // opencode ReasoningPart (hide mode): one dim summary line
      const summary = entry.text.trim().split("\n")[0] ?? "";
      return (
        <box paddingLeft={3} height={1} overflow="hidden">
          <text fg={theme.muted} attributes={TextAttributes.DIM | TextAttributes.ITALIC}>
            {summary}
          </text>
        </box>
      );
    }
    case "tool": {
      const running = entry.status === "running";
      const failed = entry.status === "error";

      if (entry.name === "bash") {
        // opencode Shell via BlockTool: panel bg block, $ command, output tail
        const out = clipOutput(entry.output);
        return (
          <box
            flexDirection="column"
            paddingLeft={2}
            paddingTop={1}
            paddingBottom={1}
            backgroundColor={theme.surface}
          >
            <text fg={running ? theme.fg : theme.muted}>
              {running ? "⚙ " : "$ "}
              {entry.summary}
            </text>
            {out !== "" && <text fg={theme.muted}>{out}</text>}
            {entry.error && <text fg={theme.error}>{entry.error}</text>}
          </box>
        );
      }

      if (entry.diff) {
        // Claude Code's Update block: ● Update(path), stats line, diff hunk
        const verb = entry.name === "write" ? "Write" : "Update";
        const stats = [
          entry.diff.added && `Added ${entry.diff.added} line${entry.diff.added === 1 ? "" : "s"}`,
          entry.diff.removed && `removed ${entry.diff.removed} line${entry.diff.removed === 1 ? "" : "s"}`,
        ]
          .filter(Boolean)
          .join(", ");
        return (
          <box flexDirection="column" paddingLeft={1}>
            <text>
              <span fg={failed ? theme.error : theme.success}>●</span>
              <span fg={theme.fg}> {verb}</span>
              <span fg={theme.muted}>({entry.diff.path})</span>
            </text>
            <box paddingLeft={2}>
              <text fg={theme.muted}>⎿ {stats}</text>
            </box>
            <box paddingLeft={2} flexDirection="column">
              <DiffView diff={entry.diff} />
            </box>
            {entry.error && (
              <box paddingLeft={2}>
                <text fg={theme.error}>{entry.error}</text>
              </box>
            )}
          </box>
        );
      }

      // opencode InlineToolRow: icon column (width 2) + content, tight rows
      const icon = failed ? "✗" : (inlineIcon[entry.name] ?? "·");
      const verb = inlineVerb[entry.name] ?? entry.name;
      const fg = failed ? theme.error : running ? theme.fg : theme.muted;
      return (
        <box flexDirection="column" paddingLeft={3}>
          <box flexDirection="row">
            <box width={2} flexShrink={0}>
              <text fg={fg}>{running ? "⚙" : icon}</text>
            </box>
            <text fg={fg}>
              {verb}{" "}
              <span attributes={failed ? undefined : TextAttributes.DIM}>
                {entry.summary}
              </span>
            </text>
          </box>
          {entry.error && (
            <box paddingLeft={2}>
              <text fg={theme.error}>{entry.error}</text>
            </box>
          )}
        </box>
      );
    }
    case "info":
      return (
        <box paddingLeft={3}>
          <text fg={theme.muted} attributes={TextAttributes.DIM}>
            {entry.text}
          </text>
        </box>
      );
    case "error":
      return (
        <box
          border={["left"]}
          customBorderChars={SplitBorder.customBorderChars}
          borderColor={theme.error}
        >
          <box paddingLeft={2} paddingTop={1} paddingBottom={1} backgroundColor={theme.surface}>
            <text fg={theme.error}>{entry.text}</text>
          </box>
        </box>
      );
  }
}

/**
 * Message scrollback on opentui's scrollbox: cell-accurate compositing,
 * native mouse-wheel scrolling, sticky bottom while streaming (opencode's
 * own setup). PageUp/PageDown page manually via the scrollbox ref.
 */
export function Transcript({
  entries,
  active = true,
}: {
  entries: Entry[];
  /** Keyboard paging enabled (off while a modal owns the keys). */
  active?: boolean;
}) {
  const scrollRef = useRef<ScrollBoxRenderable>(null);

  useKeyboard((key) => {
    if (!active) return;
    const sb = scrollRef.current;
    if (!sb) return;
    const page = Math.max(1, sb.viewport.height - 2);
    if (key.name === "pageup") sb.scrollBy(-page);
    if (key.name === "pagedown") sb.scrollBy(page);
  });

  const visible = entries.slice(-SCROLLBACK);

  if (visible.length === 0) {
    return (
      <box flexGrow={1} flexDirection="column" paddingTop={1} paddingLeft={1} gap={1}>
        {/* opencode-style home: block wordmark, tagline, quiet shortcut table */}
        <box flexDirection="row">
          <ascii-font font="tiny" text="kloud" color={theme.muted} />
          <ascii-font font="tiny" text="lite" color={theme.accent} />
        </box>
        <text fg={theme.muted}>Orchestrate agents across your kloudlite workspaces.</text>
        <box flexDirection="column" marginTop={1}>
          {(
            [
              ["/", "commands"],
              ["^p", "jump to an environment or workspace"],
              ["^j ^k", "cycle workspaces"],
              ["^h ^l", "switch environment"],
              ["^b", "back to the main context"],
              ["!", "shell mode inside a workspace"],
            ] as const
          ).map(([key, label]) => (
            <box key={key} flexDirection="row">
              <box width={7} flexShrink={0}>
                <text fg={theme.fg}>{key}</text>
              </box>
              <text fg={theme.muted}>{label}</text>
            </box>
          ))}
        </box>
      </box>
    );
  }

  return (
    <scrollbox
      ref={scrollRef}
      // basis 0 + shrink: yoga's flex-basis auto would size the scrollbox to its
      // content and shove the prompt/hint bar off screen
      flexGrow={1}
      flexBasis={0}
      flexShrink={1}
      stickyScroll
      stickyStart="bottom"
      scrollbarOptions={{ visible: false }}
    >
      {/* opencode: one blank row above the first message */}
      <box height={1} />
      {visible.map((entry, i) => (
        <box
          key={"id" in entry && entry.id ? entry.id : `e${i}`}
          flexDirection="column"
          // opencode sibling margins: consecutive inline tool rows stack
          // tight; everything else separates by one blank line
          marginTop={
            i === 0 ? 0 : isInlineTool(entry) && isInlineTool(visible[i - 1]!) ? 0 : 1
          }
        >
          <Row entry={entry} />
        </box>
      ))}
    </scrollbox>
  );
}
