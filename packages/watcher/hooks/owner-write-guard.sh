#!/bin/sh
# The PreToolUse hook on Bash (#368): src/owner-write-guard.ts reads the tool call from stdin and
# refuses a GitHub write through plain gh. Bun's own install first, as in monitor.sh: the session's
# PATH may lack it, or hold an older Bun without what the guard needs.
bun="${BUN_INSTALL:-$HOME/.bun}/bin/bun"
[ -x "$bun" ] || bun=bun
exec "$bun" "$(dirname "$0")/../src/owner-write-guard.ts"
