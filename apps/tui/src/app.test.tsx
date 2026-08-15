import { expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { Registry } from "@kloudlite-tui/tools";
import { App } from "./app.tsx";

const COLS = 200;
const ROWS = 32;

const tick = () => new Promise((r) => setTimeout(r, 60));

async function mount() {
  const setup = await testRender(<App registry={new Registry()} />, {
    width: COLS,
    height: ROWS,
    // kitty protocol on: shift+enter etc. arrive as CSI-u like modern terminals
    kittyKeyboard: true,
  });
  await tick();
  await setup.renderOnce();
  const frame = async () => {
    await tick();
    await setup.renderOnce();
    return setup.captureCharFrame();
  };
  const insert = async () => {
    setup.mockInput.pressKey("i"); // NAV → INSERT
    await tick();
    await setup.renderOnce();
  };
  return { ...setup, frame, insert, done: () => setup.renderer.destroy() };
}

test("sidebar renders", async () => {
  const t = await mount();
  const f = await t.frame();
  expect(f).toContain("main");
  expect(f).toContain("api-gateway");
  expect(f).toContain("NAV"); // modal keyboard starts in NAV
  t.done();
});

test("slash menu opens and fits the frame", async () => {
  const t = await mount();
  await t.mockInput.typeText("/");
  const f = await t.frame();
  expect(f).toContain("/help");
  expect(f.trimEnd().split("\n").length).toBeLessThanOrEqual(ROWS);
  expect(f).toContain("Orchestrator");
  t.done();
});

test("menu navigation: arrow selects, enter runs the highlighted command", async () => {
  const t = await mount();
  await t.mockInput.typeText("/");
  await t.frame();
  t.mockInput.pressKey("ARROW_DOWN"); // select /tools
  await t.frame();
  t.mockInput.pressKey("RETURN");
  const f = await t.frame();
  expect(f).toContain("question"); // the built-in question tool
  t.done();
});

test("card keeps its shape after submit", async () => {
  const t = await mount();
  await t.insert();
  await t.mockInput.typeText("hi");
  await t.frame();
  t.mockInput.pressKey("RETURN");
  const f = await t.frame();
  expect(f.trimEnd().split("\n").length).toBeLessThanOrEqual(ROWS);
  expect(f).toContain("Orchestrator"); // context row still in place
  expect(f).toContain("hi"); // user turn in the transcript
  t.done();
});

test("tab cycles focus, shift-tab cycles back", async () => {
  const t = await mount();
  t.mockInput.pressKey("\t"); // main → first workspace
  expect(await t.frame()).toContain("main › api-gateway");
  t.mockInput.pressKey("[Z"); // shift-tab → back to main (in the ring)
  expect(await t.frame()).not.toContain("main ›");
  t.mockInput.pressKey("[Z"); // again → wraps to the last workspace
  expect(await t.frame()).toContain("main › infra-iac");
  t.done();
});

test("ctrl+j / ctrl+b cycle focus without polluting the input", async () => {
  const t = await mount();
  t.mockInput.pressKey("j", { ctrl: true });
  expect(await t.frame()).toContain("main › api-gateway");
  t.mockInput.pressKey("b", { ctrl: true }); // steps out to main context
  const f = await t.frame();
  expect(f).not.toContain("main ›");
  expect(f).not.toContain("Ask anything, or / for commandsk");
  t.done();
});

test("in INSERT, plain j and k type; in NAV they navigate", async () => {
  const t = await mount();
  await t.insert();
  await t.mockInput.typeText("jk");
  const f = await t.frame();
  expect(f).toContain("jk");
  expect(f).not.toContain("main ›"); // typing, not navigating
  t.done();
});

test("NAV mode: j enters a workspace without typing", async () => {
  const t = await mount();
  t.mockInput.pressKey("j");
  const f = await t.frame();
  expect(f).toContain("main › api-gateway");
  t.done();
});

test("backslash-enter continues on a new line; enter submits the whole thing", async () => {
  const t = await mount();
  await t.insert();
  await t.mockInput.typeText("first\\");
  await t.frame();
  t.mockInput.pressKey("RETURN"); // continuation, not submit
  await t.frame();
  await t.mockInput.typeText("second");
  let f = await t.frame();
  expect(f).toContain("first");
  expect(f).toContain("second");
  t.mockInput.pressKey("RETURN"); // submit both lines
  f = await t.frame();
  expect(f).toContain("first");
  expect(f).toContain("second");
  t.done();
});

test("shift+enter inserts a newline instead of submitting", async () => {
  const t = await mount();
  await t.insert();
  await t.mockInput.typeText("hi");
  await t.frame();
  t.mockInput.pressEnter({ shift: true });
  await t.frame();
  await t.mockInput.typeText("there");
  const f = await t.frame();
  expect(f).toContain("hi");
  expect(f).toContain("there");
  expect(f).not.toContain("interrupt"); // no submit happened
  t.done();
});

test("ctrl+p palette jumps to an environment", async () => {
  const t = await mount();
  t.mockInput.pressKey("p", { ctrl: true });
  expect(await t.frame()).toContain("Jump to");
  await t.mockInput.typeText("stag");
  await t.frame();
  t.mockInput.pressKey("RETURN");
  const f = await t.frame();
  expect(f).toContain("staging"); // now open + active as a tab
  expect(f).not.toContain("Jump to"); // palette closed
  t.done();
});

test("input history is per session and recalled with arrows", async () => {
  const t = await mount();
  await t.insert();
  await t.mockInput.typeText("first prompt");
  await t.frame();
  t.mockInput.pressKey("RETURN");
  await t.frame();

  // main session: up recalls
  t.mockInput.pressKey("ARROW_UP");
  expect(await t.frame()).toContain("first prompt");
  t.mockInput.pressKey("ARROW_DOWN"); // back to empty
  await t.frame();

  // workspace session has its own (empty) history — up recalls nothing
  t.mockInput.pressKey("j", { ctrl: true });
  await t.frame();
  t.mockInput.pressKey("ARROW_UP");
  const f = await t.frame();
  expect(f).toContain("› api-gateway"); // in workspace
  // the prompt card shows no recalled text (transcript may still show the turn)
  expect(f).not.toContain("Agent · first prompt");
  t.done();
});

test("ctrl+h / ctrl+l navigate environment tabs", async () => {
  const t = await mount();
  // open staging via palette (becomes active tab)
  t.mockInput.pressKey("p", { ctrl: true });
  await t.frame();
  await t.mockInput.typeText("staging");
  await t.frame();
  t.mockInput.pressKey("RETURN");
  expect(await t.frame()).not.toContain("infra-iac"); // staging has no infra-iac

  t.mockInput.pressKey("h", { ctrl: true }); // ← production
  expect(await t.frame()).toContain("infra-iac");

  t.mockInput.pressKey("l", { ctrl: true }); // → staging again
  expect(await t.frame()).not.toContain("infra-iac");
  t.done();
});

test("selecting /login from the menu allows typing the sub-option filter", async () => {
  const t = await mount();
  await t.mockInput.typeText("/"); // NAV: "/" jumps straight into INSERT
  await t.frame();
  await t.mockInput.typeText("login");
  await t.frame();
  t.mockInput.pressKey("RETURN"); // menu enter → inserts "/login "
  await t.frame();
  await t.mockInput.typeText("codex"); // must append at the end, not at position 0
  const f = await t.frame();
  expect(f).toContain("/login codex");
  expect(f).toContain("openai-codex");
  t.done();
});
