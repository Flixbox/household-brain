#!/usr/bin/env bash
# The repository's one shell script: it installs Bun, so it can't be a Bun program (#142).
#
# Installs the Bun that package.json names (`packageManager`) from its official GitHub release and
# checks the download against the checksum pinned below (#140). CI uses this instead of
# oven-sh/setup-bun: the repository only allows GitHub-owned and google-github-actions/* actions.
#
# A Bun bump changes `packageManager` and BUN_SHA256 together: the release's checksum is in its
# SHASUMS256.txt (https://github.com/oven-sh/bun/releases/download/bun-v<version>/SHASUMS256.txt).
#
#   packages/tooling/install-bun.sh        installs into ~/.bun/bin and adds it to $GITHUB_PATH when set
set -euo pipefail

BUN_VERSION=1.4.3
BUN_SHA256=3e730528d89775f03f87f05c06787c4df4099d0a37f3f252e7b829cb23816e18 # bun-linux-x64.zip

wanted=$(sed -n 's/.*"packageManager": "bun@\([^"]*\)".*/\1/p' package.json)
if [ "$wanted" != "$BUN_VERSION" ]; then
  echo "::error::package.json wants bun@$wanted, but packages/tooling/install-bun.sh pins $BUN_VERSION: update both"
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
