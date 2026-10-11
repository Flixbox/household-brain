#!/usr/bin/env bash
# Installs the Bun that package.json names (`packageManager`) from its official GitHub release and
# checks the download against the checksum pinned below (#140). CI uses this instead of
# oven-sh/setup-bun: the repository only allows GitHub-owned and google-github-actions/* actions.
#
# A Bun bump changes `packageManager` and BUN_SHA256 together: the release's checksum is in its
# SHASUMS256.txt (https://github.com/oven-sh/bun/releases/download/bun-v<version>/SHASUMS256.txt).
#
#   scripts/install-bun.sh        installs into ~/.bun/bin and adds it to $GITHUB_PATH when set
set -euo pipefail

BUN_VERSION=1.4.2
BUN_SHA256=36368faef7527875d5ffa52e53cd48021741f2a83eb6208a8dd64068d422a913 # bun-linux-x64.zip

wanted=$(sed -n 's/.*"packageManager": "bun@\([^"]*\)".*/\1/p' package.json)
if [ "$wanted" != "$BUN_VERSION" ]; then
  echo "::error::package.json wants bun@$wanted, but scripts/install-bun.sh pins $BUN_VERSION: update both"
  exit 1
fi

dir=$HOME/.bun/bin
zip=$(mktemp --suffix=.zip)
curl -fsSL --retry 3 -o "$zip" "https://github.com/oven-sh/bun/releases/download/bun-v$BUN_VERSION/bun-linux-x64.zip"
echo "$BUN_SHA256  $zip" | sha256sum --check --quiet
mkdir -p "$dir"
# The Playwright image has no unzip, but Python.
if command -v unzip >/dev/null; then
  unzip -qjo "$zip" 'bun-linux-x64/bun' -d "$dir"
else
  python3 -c 'import sys, zipfile; open(sys.argv[2], "wb").write(zipfile.ZipFile(sys.argv[1]).read("bun-linux-x64/bun"))' "$zip" "$dir/bun"
fi
chmod +x "$dir/bun"
rm -f "$zip"
[ -n "${GITHUB_PATH:-}" ] && echo "$dir" >>"$GITHUB_PATH"
"$dir/bun" --version
