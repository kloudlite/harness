import { expect, test } from "bun:test";
import { pipeArgv } from "./remote-args.ts";

test("--ssh is no transport any more", () => {
  expect(pipeArgv(["bun", "kl-tui", "--ssh", "-p", "22", "kl-host"])).toBeNull();
});
test("--pipe runs the argv as given", () => {
  expect(pipeArgv(["bun", "kl-tui", "--pipe", "/bin/kloudlite", "bench-proxy"])).toEqual(["/bin/kloudlite", "bench-proxy"]);
});
test("no transport or an empty one is a usage error", () => {
  expect(pipeArgv(["bun", "kl-tui"])).toBeNull();
  expect(pipeArgv(["bun", "kl-tui", "--pipe"])).toBeNull();
});
