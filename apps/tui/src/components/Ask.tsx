import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { theme } from "../theme.ts";
import { SplitBorder } from "../ui/border.ts";
import { DiffView } from "./Diff.tsx";
import type { FileDiff } from "../diff.ts";

export type Ask = {
  /** e.g. "Edit file" or the question text */
  title: string;
  /** dim secondary line, e.g. the file path or "Shell command" */
  subtitle?: string;
  /** body block, e.g. "$ git status" */
  body?: string;
  /** diff hunk (edit/write permission prompts) */
  diff?: FileDiff;
  /** confirmation line above the options, e.g. "Do you want to make this edit?" */
  question?: string;
  options: { id: string; label: string }[];
  /** option chosen when the user presses esc (defaults to the last one) */
  escapeId?: string;
  resolve: (id: string) => void;
};

/**
 * Interactive prompt, Claude Code style: header + optional diff/body, then a
 * numbered vertical option list. ↑/↓ or digits select, enter confirms, esc
 * picks `escapeId`.
 */
export function AskPanel({ ask }: { ask: Ask }) {
  const [sel, setSel] = useState(0);
  const n = ask.options.length;

  useKeyboard((key) => {
    if (key.name === "up" || (key.name === "tab" && key.shift))
      return setSel((i) => (i - 1 + n) % n);
    if (key.name === "down" || key.name === "tab") return setSel((i) => (i + 1) % n);
    if (/^[1-9]$/.test(key.name)) {
      const idx = Number(key.name) - 1;
      if (idx < n) return ask.resolve(ask.options[idx]!.id);
    }
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
      <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
        <text fg={theme.fg}><b>{ask.title}</b></text>
        {ask.subtitle && <text fg={theme.muted}>{ask.subtitle}</text>}

        {ask.diff && (
          <box flexDirection="column" marginTop={1}>
            <DiffView diff={ask.diff} />
          </box>
        )}
        {ask.body && (
          <box flexDirection="column" marginTop={1}>
            <text fg={theme.fg}>{ask.body}</text>
          </box>
        )}

        {ask.question && (
          <box marginTop={1}>
            <text fg={theme.fg}>{ask.question}</text>
          </box>
        )}
        <box flexDirection="column" marginTop={ask.question ? 0 : 1}>
          {ask.options.map((opt, i) => {
            const active = i === sel;
            return (
              <text key={opt.id} fg={active ? theme.fg : theme.muted}>
                {active ? "❯ " : "  "}
                {i + 1}. {opt.label}
              </text>
            );
          })}
        </box>
      </box>
    </box>
  );
}
