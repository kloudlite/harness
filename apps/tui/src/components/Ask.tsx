import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import { theme } from "../theme.ts";
import { SplitBorder } from "../ui/border.ts";

export type Ask = {
  /** e.g. "Permission required" or the question text */
  title: string;
  /** dim secondary line, e.g. "Shell command" */
  subtitle?: string;
  /** body block, e.g. "$ git status" */
  body?: string;
  options: { id: string; label: string }[];
  /** option chosen when the user presses esc (defaults to the last one) */
  escapeId?: string;
  resolve: (id: string) => void;
};

/**
 * Interactive prompt in opencode's question-panel grammar: native ┃ left
 * border in the warning color on the panel bg, raised button strip.
 * ⇆/arrows select, enter confirms, esc picks `escapeId`.
 */
export function AskPanel({ ask }: { ask: Ask }) {
  const [sel, setSel] = useState(0);
  const n = ask.options.length;

  useKeyboard((key) => {
    if (key.name === "left" || (key.name === "tab" && key.shift))
      return setSel((i) => (i - 1 + n) % n);
    if (key.name === "right" || key.name === "tab") return setSel((i) => (i + 1) % n);
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
      <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1}>
        <text fg={theme.fg}>
          <span fg={theme.warning}>△</span> {ask.title}
        </text>
        {ask.subtitle && <text fg={theme.muted}>  # {ask.subtitle}</text>}
        {ask.body && (
          <box flexDirection="column" marginTop={1}>
            <text fg={theme.fg}>{ask.body}</text>
          </box>
        )}
        <text> </text>
      </box>
      <box
        flexDirection="row"
        paddingLeft={2}
        paddingRight={2}
        backgroundColor={theme.surfaceRaised}
        justifyContent="space-between"
      >
        <box flexDirection="row" gap={2}>
          {ask.options.map((opt, i) => {
            const active = i === sel;
            return (
              <text
                key={opt.id}
                fg={active ? theme.bg : theme.muted}
                bg={active ? theme.warning : undefined}
                attributes={active ? TextAttributes.BOLD : undefined}
              >
                {" "}{opt.label}{" "}
              </text>
            );
          })}
        </box>
        <text fg={theme.muted}>
          <b>⇆</b> <span attributes={TextAttributes.DIM}>select</span>{"  "}
          <b>enter</b> <span attributes={TextAttributes.DIM}>confirm</span>
        </text>
      </box>
    </box>
  );
}
