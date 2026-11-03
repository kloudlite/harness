#!/bin/sh
# Copies the plugin's skills from ../skills into plugin/skills. Claude Code loads a plugin's skills only
# from inside the plugin root, so a symlink out to ../skills is not trusted; laptop-plugin.test.ts fails
# when a copy differs from its source. Run after editing any of these skills.
set -eu
cd "$(dirname "$0")"
SKILLS="kloudlite kloudlite-develop kloudlite-verify kloudlite-automate orchestrate develop"
rm -rf plugin/skills
for s in $SKILLS; do
  mkdir -p "plugin/skills/$s"
  cp "../skills/$s/SKILL.md" "plugin/skills/$s/SKILL.md"
done
