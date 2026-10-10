#!/usr/bin/env bash
# Fails when a workflow pins a GitHub Action release younger than the minimum age (#102), as
# pnpm's minimumReleaseAge does for packages (#94): a fresh release has had no time for anyone to
# notice it is compromised. Each `uses: owner/repo@<sha> # vX.Y.Z` is dated by its release, or by
# its commit when the tag has no release (or there is no version comment). Re-run it once the
# release is old enough.
#
#   scripts/check-action-age.sh [min-hours=48]
#
# Needs `gh` with a token that can read public repositories (GH_TOKEN in CI).
set -uo pipefail

min_hours=${1:-48}
now=$(date +%s)
failed=0

# "<action> <sha> <tag or ->", one per pinned action.
pins=$(grep -rhoE 'uses: [^ ]+@[0-9a-f]{40}( # v[^ ]+)?' .github/workflows \
  | sed -E 's/uses: ([^@]+)@([0-9a-f]{40})( # (v[^ ]+))?/\1 \2 \4/' | awk '{ print $1, $2, ($3 == "" ? "-" : $3) }' | sort -u)
# Every workflow pins its actions by commit: finding none means the scan itself broke.
[[ -n $pins ]] || { echo "::error::No pinned actions found in .github/workflows"; exit 1; }

released_at() { # released_at <repo> <sha> <tag>: when the tag was released, else when its commit was made
  local published=''
  [[ $3 != - ]] && published=$(gh api "repos/$1/releases/tags/$3" --jq '.published_at // empty' 2>/dev/null)
  [[ -n $published ]] || published=$(gh api "repos/$1/commits/$2" --jq '.commit.committer.date // empty')
  [[ -n $published ]] && echo "$published"
}

while read -r action sha tag; do
  repo=$(cut -d/ -f1-2 <<<"$action")
  published=$(released_at "$repo" "$sha" "$tag") || { echo "::error::Couldn't date $action@${sha:0:7} ($tag)"; failed=1; continue; }
  age=$(( (now - $(date -d "$published" +%s)) / 3600 ))
  if (( age < min_hours )); then
    echo "::error::$action $tag is ${age} h old (published $published); the minimum is ${min_hours} h. Re-run once it is old enough."
    failed=1
  else
    echo "$action $tag: ${age} h old"
  fi
done <<<"$pins"

exit "$failed"
