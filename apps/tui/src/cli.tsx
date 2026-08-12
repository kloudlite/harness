#!/usr/bin/env bun
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { Registry } from "@kloudlite-tui/tools";
import { App } from "./app.tsx";

// No built-in tools. Register your own set here.
const registry = new Registry();

// opentui owns the terminal: alternate screen, kitty keyboard protocol,
// SGR mouse, and a cell-diff compositor (no stale-cell artifacts).
const renderer = await createCliRenderer({
  exitOnCtrlC: false, // the app handles ctrl+c (and /exit) itself
  useMouse: true, // wheel scrolling in the transcript
});

// xterm modifyOtherKeys: terminals without kitty-protocol support enabled
// (WezTerm default config) otherwise send ctrl+h as a bare backspace byte,
// making it indistinguishable from Backspace. opentui's parser understands
// the CSI 27;…~ encodings this turns on.
process.stdout.write("\x1b[>4;2m");
process.on("exit", () => process.stdout.write("\x1b[>4;0m"));

createRoot(renderer).render(<App registry={registry} />);
