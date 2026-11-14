import { expect, test } from "bun:test";
import { pipeArgv } from "./remote-args.ts";

test("--ssh is no transport any more", () => {
  expect(pipeArgv(["bun", "kd-tui", "--ssh", "-p", "22", "kl-host"])).toBeNull();
});
test("--pipe runs the argv as given", () => {
  expect(pipeArgv(["bun", "kd-tui", "--pipe", "/bin/kode", "bench-proxy"])).toEqual(["/bin/kode", "bench-proxy"]);
});
test("no transport or an empty one is a usage error", () => {
  expect(pipeArgv(["bun", "kd-tui"])).toBeNull();
  expect(pipeArgv(["bun", "kd-tui", "--pipe"])).toBeNull();
});
