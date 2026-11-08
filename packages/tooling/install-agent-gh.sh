#!/usr/bin/env bash
# Installs the agent bot's gh wrappers from this checkout (#358): agent-gh and agent-gh-token, and
# guard-bash-probe (#395), the runner for the owner-write guard's reviews, into
# ~/.local/bin (or the folder given), and on Windows (Git Bash) also agent-gh.exe, built from
# agent-gh.ts for Bun's shell. They stay bash: agent-gh-token also serves git's credential helper.
#
#   bash packages/tooling/install-agent-gh.sh [folder]
set -euo pipefail

src="$(dirname "$0")/src"
bin=${1:-$HOME/.local/bin}
mkdir -p "$bin"
for script in agent-gh agent-gh-token guard-bash-probe; do
  source_file="$src/$script"
  [[ -f $source_file ]] || source_file="$source_file.ts"
  cp "$source_file" "$bin/$script"
  chmod 755 "$bin/$script"
done
if [[ ${OS:-} == Windows_NT ]]; then
  bun build --compile "$src/agent-gh.ts" --outfile "$bin/agent-gh.exe"
fi
echo "Installed agent-gh, agent-gh-token and guard-bash-probe into $bin"
