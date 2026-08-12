export type SlashCommand = {
  name: string;
  description: string;
  /** Command takes an argument — typing "/cmd " opens its option list. */
  hasOptions?: boolean;
};

export const commands: SlashCommand[] = [
  { name: "/help", description: "Show available commands" },
  { name: "/tools", description: "List registered tools" },
  { name: "/clear", description: "Clear the transcript" },
  { name: "/model", description: "Set this session's model", hasOptions: true },
  { name: "/theme", description: "Switch theme", hasOptions: true },
  { name: "/login", description: "Log in to a provider", hasOptions: true },
  { name: "/settings", description: "Adjust settings", hasOptions: true },
  { name: "/env-close", description: "Close the active environment tab" },
  { name: "/exit", description: "Quit" },
];

export function matchCommands(input: string): SlashCommand[] {
  if (!input.startsWith("/")) return [];
  return commands.filter((c) => c.name.startsWith(input));
}

/** One row in the slash menu: `insert` is submitted, `label`/`hint` rendered. */
export type MenuItem = { insert: string; label: string; hint: string };

export type MenuContext = {
  models: { provider: string; id: string; hint: string }[];
  themes: string[];
  logins: { provider: string; type: string; label: string }[];
  /** flat option rows for /settings, hint marks the current value */
  settings: { key: string; value: string; hint: string }[];
};

export const MENU_MAX = 8;

/** Menu for the current input: command list, or the typed command's options. */
export function menuItems(input: string, ctx: MenuContext): MenuItem[] {
  if (!input.startsWith("/")) return [];

  const space = input.indexOf(" ");
  if (space === -1) {
    return matchCommands(input).map((c) => ({
      insert: c.hasOptions ? `${c.name} ` : c.name,
      label: c.name,
      hint: c.description,
    }));
  }

  const cmd = input.slice(0, space);
  const q = input.slice(space + 1).toLowerCase();
  const filter = (label: string) => label.toLowerCase().includes(q);

  if (cmd === "/model")
    return ctx.models
      .filter((m) => filter(`${m.provider}/${m.id}`))
      .map((m) => ({
        insert: `/model ${m.provider}/${m.id}`,
        label: `${m.provider}/${m.id}`,
        hint: m.hint,
      }));
  if (cmd === "/theme")
    return ctx.themes.filter(filter).map((name) => ({
      insert: `/theme ${name}`,
      label: name,
      hint: "theme",
    }));
  if (cmd === "/login")
    return ctx.logins
      .filter((l) => filter(`${l.provider} ${l.label}`))
      .map((l) => ({
        insert: `/login ${l.provider} ${l.type}`,
        label: `${l.provider} · ${l.label}`,
        hint: l.type === "oauth" ? "oauth" : "api key",
      }));
  if (cmd === "/settings")
    return ctx.settings
      .filter((o) => filter(`${o.key} ${o.value}`))
      .map((o) => ({
        insert: `/settings ${o.key} ${o.value}`,
        label: `${o.key} ${o.value}`,
        hint: o.hint,
      }));
  return [];
}

/** Rotating input hints. */
export const placeholders = [
  "Ask anything, or / for commands",
  "! for shell mode, backspace to leave it",
  "^j/^k workspaces · ^h/^l environments",
  "Esc to interrupt",
  "\\ + Enter for a new line",
];
