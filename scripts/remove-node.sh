#!/usr/bin/env bash
# Removes every Node on the PATH, so nothing in CI can quietly fall back to it (#140). Runner images
# and the Playwright image both ship one. `bun run` gives scripts that still call `node` a `node` that
# is Bun itself (bunfig.toml: run.bun), so they keep working, on Bun.
set -euo pipefail
sudo=$([ "$(id -u)" -eq 0 ] && echo || echo sudo)
while path=$(command -v node); do
  $sudo rm -f "$(readlink -f "$path")" "$path"
  hash -r
done
echo 'Node removed'
