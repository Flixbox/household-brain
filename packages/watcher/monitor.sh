#!/bin/sh
# The plugin's own monitor (#241): Claude Code starts this in the session's folder the first time the
# babysit-prs skill runs, and keeps it running for the whole session, so no Monitor has to be re-armed.
# The settings come from the project's .claude/watcher.env (the environment still wins), because a
# plugin monitor gets none of its own; a project without the file isn't watched.
settings=.claude/watcher.env
if [ ! -f "$settings" ]; then
  echo "project-watcher: not set up here (no $settings), so not watching; the babysit-prs skill says how"
  exit 0
fi
# Bun's own install (~/.bun/bin) first: the session's PATH may lack it, or hold an older Bun from
# another package manager, without the Temporal the watcher needs.
bun="${BUN_INSTALL:-$HOME/.bun}/bin/bun"
[ -x "$bun" ] || bun=bun
exec "$bun" --env-file="$settings" "$(dirname "$0")/src/watch-project.ts" --follow
