#!/usr/bin/env bash
# Installs the agent bot's gh wrappers from this checkout (#358): agent-gh and agent-gh-token into
# ~/.local/bin (or the folder given), and on Windows (Git Bash) also agent-gh.exe, built from
# agent-gh.ts for Bun's shell. They stay bash: agent-gh-token also serves git's credential helper.
#
#   bash packages/tooling/install-agent-gh.sh [folder]
set -euo pipefail

src="$(dirname "$0")/src"
bin=${1:-$HOME/.local/bin}
mkdir -p "$bin"
for script in agent-gh agent-gh-token; do
  cp "$src/$script" "$bin/$script"
  chmod 755 "$bin/$script"
done
if [[ ${OS:-} == Windows_NT ]]; then
  bun build --compile "$src/agent-gh.ts" --outfile "$bin/agent-gh.exe"
fi
echo "Installed agent-gh and agent-gh-token into $bin"
