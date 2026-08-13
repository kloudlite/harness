import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { theme } from "../theme.ts";
import { SplitBorder } from "../ui/border.ts";
import { DiffView } from "./Diff.tsx";
import type { FileDiff } from "../diff.ts";

export type Ask = {
  /** e.g. "Permission required" or the question text */
  title: string;
  /** dim secondary line, e.g. "Shell command" or the file path */
  subtitle?: string;
  /** body block, e.g. "$ git status" */
  body?: string;
  /** diff hunk (edit/write permission prompts) */
  diff?: FileDiff;
  options: { id: string; label: string; hint?: string }[];
  /** "buttons": horizontal strip (few options); "list": vertical, scrolls (many) */
  layout?: "buttons" | "list";
  /** option chosen when the user presses esc (defaults to the last one) */
  escapeId?: string;
  resolve: (id: string) => void;
};

/** Rows shown at once in list layout; the window follows the selection. */
const LIST_MAX = 8;

/**
 * opencode's permission panel, ported 1:1: warning ┃ border on the panel bg,
 * "△ title" + "# subtitle" header, body, and a raised button strip —
 * highlighted button on the warning color, "⇆ select · enter confirm" hints
 * right. ⇆/arrows select, enter confirms, esc picks `escapeId`.
 */
export function AskPanel({ ask }: { ask: Ask }) {
  const [sel, setSel] = useState(0);
  const n = ask.options.length;

  const list = ask.layout === "list";

  useKeyboard((key) => {
    const prev = list ? key.name === "up" : key.name === "left" || (key.name === "tab" && key.shift);
    const next = list ? key.name === "down" : key.name === "right" || key.name === "tab";
    if (prev) return setSel((i) => (i - 1 + n) % n);
    if (next) return setSel((i) => (i + 1) % n);
    if (key.name === "return") return ask.resolve(ask.options[sel]!.id);
    if (key.name === "escape")
      return ask.resolve(ask.escapeId ?? ask.options[n - 1]!.id);
  });

  return (
    <box
      width="100%"
      flexDirection="column"
      border={["left"]}
      customBorderChars={SplitBorder.customBorderChars}
      borderColor={theme.warning}
      backgroundColor={theme.surface}
    >
      {/* opencode: gap 1, paddingLeft 1, paddingRight 3, paddingY 1 */}
      <box
        flexDirection="column"
        gap={1}
        paddingLeft={1}
        paddingRight={3}
        paddingTop={1}
        paddingBottom={1}
      >
        <box flexDirection="column">
          <box flexDirection="row" gap={1} paddingLeft={1}>
            <text fg={theme.warning}>△</text>
            <text fg={theme.fg}>{ask.title}</text>
          </box>
          {ask.subtitle && (
            <box flexDirection="row" gap={1} paddingLeft={2}>
              <text fg={theme.muted}># {ask.subtitle}</text>
            </box>
          )}
        </box>
        {ask.diff && (
          <box flexDirection="column" paddingLeft={1}>
            <DiffView diff={ask.diff} />
          </box>
        )}
        {ask.body && (
          <box paddingLeft={1}>
            <text fg={theme.fg}>{ask.body}</text>
          </box>
        )}
        {list && (
          <box flexDirection="column" paddingLeft={1}>
            {(() => {
              // scroll window that follows the selection
              const start = Math.min(Math.max(0, sel - LIST_MAX + 1), Math.max(0, n - LIST_MAX));
              return ask.options.slice(start, start + LIST_MAX).map((opt, offset) => {
                const i = start + offset;
                const active = i === sel;
                return (
                  <box
                    key={opt.id}
                    flexDirection="row"
                    justifyContent="space-between"
                    paddingLeft={1}
                    paddingRight={1}
                    backgroundColor={active ? theme.selection : undefined}
                  >
                    <text fg={active ? theme.bg : theme.fg}>{opt.label}</text>
                    <text fg={active ? theme.bg : theme.muted}>{opt.hint ?? ""}</text>
                  </box>
                );
              });
            })()}
            {n > LIST_MAX && (
              <box paddingLeft={1}>
                <text fg={theme.muted}>{sel + 1}/{n}</text>
              </box>
            )}
          </box>
        )}
      </box>

      {/* button strip: raised bg, buttons left, hints right */}
      <box
        flexDirection="row"
        flexShrink={0}
        gap={1}
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={3}
        backgroundColor={theme.surfaceRaised}
        justifyContent="space-between"
        alignItems="center"
      >
        <box flexDirection="row" gap={1} flexShrink={0}>
          {!list &&
            ask.options.map((opt, i) => {
              const active = i === sel;
              return (
                <box
                  key={opt.id}
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={active ? theme.warning : undefined}
                >
                  <text fg={active ? theme.bg : theme.muted}>{opt.label}</text>
                </box>
              );
            })}
        </box>
        <box flexDirection="row" gap={2} flexShrink={0}>
          <text fg={theme.fg}>
            {list ? "↑↓" : "⇆"} <span fg={theme.muted}>select</span>
          </text>
          <text fg={theme.fg}>
            enter <span fg={theme.muted}>confirm</span>
          </text>
          <text fg={theme.fg}>
            esc <span fg={theme.muted}>cancel</span>
          </text>
        </box>
      </box>
    </box>
  );
}
