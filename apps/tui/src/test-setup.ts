// Tests must never touch the real ~/.config/kode.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.KODE_CONFIG_DIR = mkdtempSync(join(tmpdir(), "kode-test-"));
const { boot } = await import("./hello.ts");
const { fixtureTeam } = await import("./fixtures.ts");
const { FakeBackend, fakeHello } = await import("./test-backend.ts");
const local = new FakeBackend();
// the demo team view stands in for the platform: tests have no KD_API_URL, and the sidebar is real data now
local.teamView = async () => fixtureTeam();
boot(local as any, fakeHello());
