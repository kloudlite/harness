import { TextAttributes } from "@opentui/core";
import { theme } from "../theme.ts";

const PAD = 2; // aligns with the main column's paddingLeft
const GAP = 1;

/**
 * Environment tabs: active tab raised + bold with an accent underline segment;
 * everything else sits on one continuous thin hairline.
 */
export function Tabs({
  names,
  active,
  width,
}: {
  names: string[];
  active: number;
  width: number;
}) {
  // Hairline: thin ─ everywhere, one heavy accent segment under the active tab.
  const rule: { text: string; accent: boolean }[] = [
    { text: "─".repeat(PAD), accent: false },
  ];
  names.forEach((name, i) => {
    if (i > 0) rule.push({ text: "─".repeat(GAP), accent: false });
    if (i === active) rule.push({ text: "━".repeat(name.length + 2), accent: true });
    else rule.push({ text: "─".repeat(name.length + 2), accent: false });
  });
  const used = rule.reduce((n, seg) => n + seg.text.length, 0);
  rule.push({ text: "─".repeat(Math.max(0, width - used)), accent: false });

  return (
    <box flexDirection="column" width={width} paddingTop={1}>
      <box flexDirection="row" paddingLeft={PAD} gap={GAP}>
        {names.map((name, i) => {
          const isActive = i === active;
          return (
            <text
              key={name}
              fg={isActive ? theme.fg : theme.muted}
              bg={isActive ? theme.surfaceRaised : undefined}
              attributes={isActive ? TextAttributes.BOLD : undefined}
            >
              {" "}{name}{" "}
            </text>
          );
        })}
      </box>
      <text>
        {rule.map((seg, i) => (
          <span
            key={i}
            fg={seg.accent ? theme.accent : theme.border}
            attributes={seg.accent ? undefined : TextAttributes.DIM}
          >
            {seg.text}
          </span>
        ))}
      </text>
    </box>
  );
}
