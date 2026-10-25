/**
 * Skill paths pi loads (`index.ts`). The skill files live in `skills/` at the repo root, one folder each; the
 * agent reads them from there and so does `npx skills add kloudlite/harness`.
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SKILLS = fileURLToPath(new URL("../../../skills", import.meta.url));
export const CODEMODE_SKILL = join(SKILLS, "codemode");
export const KLOUDLITE_SKILL = join(SKILLS, "kloudlite");
// Terse replies: output tokens were the waste (2026-10-12). Vendored from github.com/JuliusBrussee/caveman (MIT).
export const CAVEMAN_SKILL = join(SKILLS, "caveman");
export type Role = "main" | "workspace" | "subagent";
export const roleSkill = (role: Role) => join(SKILLS, `${role}-session`);
