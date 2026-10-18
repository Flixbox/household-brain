#!/bin/sh
# Runs one of this plugin's entry points with Bun (#256): `run.sh mcp` (the MCP server Claude Code
# starts) or `run.sh cli <command> …`. Bun's own install (~/.bun/bin) first: the session's PATH may
# lack it, or hold an older Bun without the Temporal the code needs.
bun="${BUN_INSTALL:-$HOME/.bun}/bin/bun"
[ -x "$bun" ] || bun=bun
entry=$1
shift
exec "$bun" "$(dirname "$0")/src/$entry.ts" "$@"
