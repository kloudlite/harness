import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import { theme } from "../theme.ts";
import { SPECIAL } from "./Input.tsx";

export type PaletteItem = {
  label: string;
  /** dim right-hand annotation, e.g. "open", "attached" */
  hint: string;
  /** section header this item is listed under, e.g. "Environments" */
  group: string;
  run: () => void;
};

/**
 * Ctrl+P jump palette: type to filter, ↑/↓ to move, enter to run, esc to
 * close. Items are grouped under quiet section headers.
 */
export function Palette({
  items,
  onClose,
}: {
  items: PaletteItem[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);

  const matches = items.filter((item) =>
    item.label.toLowerCase().includes(query.toLowerCase()),
  );
  const selected = Math.min(sel, Math.max(0, matches.length - 1));

  // group order follows first appearance in the (already ordered) item list
  const groups: { name: string; items: { item: PaletteItem; index: number }[] }[] = [];
  matches.forEach((item, index) => {
    let group = groups.find((g) => g.name === item.group);
    if (!group) {
      group = { name: item.group, items: [] };
      groups.push(group);
    }
    group.items.push({ item, index });
  });

  useKeyboard((key) => {
    if (key.name === "escape") return onClose();
    if (key.name === "return") {
      matches[selected]?.run();
      onClose();
      return;
    }
    if (key.name === "down") return setSel((i) => (i + 1) % Math.max(1, matches.length));
    if (key.name === "up")
      return setSel((i) => (i - 1 + matches.length) % Math.max(1, matches.length));
    if (key.name === "backspace" || key.name === "delete") {
      setQuery((q) => q.slice(0, -1));
      setSel(0);
      return;
    }
    if (key.ctrl || key.meta || key.option || SPECIAL.has(key.name)) return;
    const text = key.sequence;
    if (text && !text.startsWith("\x1b") && text >= " ") {
      setQuery((q) => q + text);
      setSel(0);
    }
  });

  return (
    <box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1} paddingTop={1}>
      <text>
        <span fg={theme.accent}><b>› </b></span>
        <span fg={theme.fg}>{query}</span>
        <span attributes={TextAttributes.INVERSE}> </span>
        {query === "" && <span fg={theme.placeholder}>Jump to…</span>}
      </text>

      {matches.length === 0 ? (
        <box marginTop={1} paddingLeft={1}>
          <text fg={theme.muted}>No matches</text>
        </box>
      ) : (
        groups.map((group) => (
          <box key={group.name} flexDirection="column" marginTop={1}>
            <box paddingLeft={1}>
              <text fg={theme.muted}><b>{group.name}</b></text>
            </box>
            {group.items.map(({ item, index }) => {
              const active = index === selected;
              return (
                <box
                  key={item.label}
                  flexDirection="row"
                  paddingLeft={2}
                  paddingRight={1}
                  justifyContent="space-between"
                  backgroundColor={active ? theme.selection : undefined}
                >
                  <text
                    fg={active ? theme.bg : theme.fg}
                    attributes={active ? TextAttributes.BOLD : undefined}
                  >
                    {item.label}
                  </text>
                  <text fg={active ? theme.bg : theme.placeholder}>{item.hint}</text>
                </box>
              );
            })}
          </box>
        ))
      )}
    </box>
  );
}
