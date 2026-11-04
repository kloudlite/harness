import { afterAll, expect, test, mock } from "bun:test";
import * as clipboard from "./clipboard.ts";

// restore afterwards: mock.module is process-wide and clipboard.test.ts
// exercises the real reader
const real = clipboard.readClipboardImage;
mock.module("./clipboard.ts", () => ({
  ...clipboard,
  readClipboardImage: () => ({ type: "image", data: "x", mimeType: "image/png" }),
}));
afterAll(() => {
  mock.module("./clipboard.ts", () => ({ ...clipboard, readClipboardImage: real }));
});
import { testRender } from "@opentui/react/test-utils";
import { App } from "./app.tsx";
import { backend, boot, hello } from "./hello.ts";

// App reads its settings from hello() once at mount, so tests seed them by re-booting.
function writeSettings(patch: Record<string, unknown>) {
  boot(backend(), { ...hello(), settings: { ...hello().settings, ...patch } });
}

// a pasted image is a token in the value, so typing continues after it
// the badge is one thing on screen, so backspace takes all of it