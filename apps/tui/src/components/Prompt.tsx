import { useEffect, useState } from "react";
import { useKeyboard } from "@opentui/react";
import { Input } from "./Input.tsx";
import { theme } from "../theme.ts";
import { MENU_MAX, type MenuItem } from "../slash.ts";
import { EmptyBorder, SplitBorder } from "../ui/border.ts";

/**
 * Input card, opencode's prompt pattern: native left border ┃ capped by ╹,
 * raised background, paddingX 2, context row under the input.
 */
export function Prompt({
  value,
  onChange,
  onSubmit,
  placeholder,
  mode,
  model,
  provider,
  workspace,
  inputActive = true,
  menu,
  jump = false,
  nav = false,
  onPick,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  placeholder: string;
  mode: "agent" | "shell";
  model: string;
  provider: string;
  workspace?: string;
  inputActive?: boolean;
  menu: MenuItem[];
  /** Jump mode (^p): Enter runs the highlighted item via onPick. */
  jump?: boolean;
  /** NAV mode: dimmed card, no cursor, badge row. */
  nav?: boolean;
  onPick?: (insert: string) => void;
}) {
  const matches = menu;
  const [sel, setSel] = useState(0);
  const bar = nav ? theme.border : mode === "shell" ? theme.warning : theme.accent;

  // Clamp selection when the filter narrows.
  useEffect(() => {
    if (sel >= matches.length) setSel(0);
  }, [matches.length, sel]);

  useKeyboard((key) => {
    if (matches.length === 0 || !inputActive) return;
    if (key.name === "down") setSel((i) => (i + 1) % matches.length);
    if (key.name === "up") setSel((i) => (i - 1 + matches.length) % matches.length);
    if (key.name === "tab") onChange(matches[sel]!.insert);
  });

  function handleSubmit(text: string) {
    // Menu open → run the highlighted entry, not the partial text.
    if (matches.length > 0 && onPick) return onPick(matches[sel]!.insert);
    onSubmit(matches.length > 0 ? matches[sel]!.insert : text);
  }

  return (
    <box flexDirection="column" width="100%" flexShrink={0}>
      {matches.length > 0 && (
        // opencode autocomplete: ┃ rails both sides, menu bg, paddingX 1
        <box {...SplitBorder} borderColor={theme.border} backgroundColor={theme.surfaceRaised}>
          <box flexDirection="column">
            {(() => {
              // scroll window that follows the selection
              const start = Math.min(
                Math.max(0, sel - MENU_MAX + 1),
                Math.max(0, matches.length - MENU_MAX),
              );
              return matches.slice(start, start + MENU_MAX).map((c, offset) => {
                const i = start + offset;
                const active = i === sel;
                return (
                  <box
                    key={c.insert}
                    flexDirection="row"
                    backgroundColor={active ? theme.selection : undefined}
                    paddingLeft={1}
                    paddingRight={1}
                  >
                    <text fg={active ? theme.bg : theme.fg}>{c.label.padEnd(10)}</text>
                    <text fg={active ? theme.bg : theme.muted}> {c.hint}</text>
                    <box flexGrow={1} />
                  </box>
                );
              });
            })()}
          </box>
        </box>
      )}

      <box
        border={["left"]}
        borderColor={bar}
        customBorderChars={SplitBorder.customBorderChars}
      >
        <box
          flexDirection="column"
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          backgroundColor={theme.surfaceRaised}
        >
          <box minHeight={1}>
            <Input
              value={value}
              onChange={onChange}
              onSubmit={handleSubmit}
              placeholder={placeholder}
              showCursor={inputActive}
              active={inputActive}
            />
          </box>
          <text> </text>
          <text>
            <span fg={nav ? theme.muted : bar}>
              <b>{nav ? "NAV" : jump ? "Jump" : mode === "shell" ? "Shell" : workspace ? "Agent" : "Orchestrator"}</b>
            </span>
            {nav ? (
              <span fg={theme.muted}> · i to type · ? for help</span>
            ) : jump ? (
              <span fg={theme.muted}> · type to filter, esc to close</span>
            ) : (
              <span>
                <span fg={theme.muted}> · {model} </span>
                <span fg={theme.placeholder}>{provider}</span>
              </span>
            )}
          </text>
        </box>
      </box>

      {/* opencode's closing strip: ╹ cap in the border color, ▀ row in the
          card bg — a half-height bottom edge under the card */}
      <box
        height={1}
        border={["left"]}
        borderColor={bar}
        customBorderChars={{ ...EmptyBorder, vertical: "╹" }}
      >
        <box
          height={1}
          border={["bottom"]}
          borderColor={theme.surfaceRaised}
          customBorderChars={{ ...EmptyBorder, horizontal: "▀" }}
        />
      </box>
    </box>
  );
}
