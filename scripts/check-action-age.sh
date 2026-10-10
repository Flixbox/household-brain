#!/usr/bin/env bash
# Fails when a workflow pins a GitHub Action release younger than the minimum age (#102), as
# pnpm's minimumReleaseAge does for packages (#94): a fresh release has had no time for anyone to
# notice it is compromised. Each `uses: owner/repo@<sha> # vX.Y.Z` is dated by its release, or by
# its commit when the tag has no release. Re-run it once the release is old enough.
#
#   scripts/check-action-age.sh [min-hours=48]
#
# Needs `gh` with a token that can read public repositories (GH_TOKEN in CI).
set -uo pipefail

min_hours=${1:-48}
now=$(date +%s)
failed=0

while read -r action sha tag; do
  repo=$(cut -d/ -f1-2 <<<"$action")
  published=$(gh api "repos/$repo/releases/tags/$tag" --jq .published_at 2>/dev/null) \
    || published=$(gh api "repos/$repo/commits/$sha" --jq .commit.committer.date) \
    || { echo "::error::Couldn't date $action@$tag"; failed=1; continue; }
  age=$(( (now - $(date -d "$published" +%s)) / 3600 ))
  if (( age < min_hours )); then
    echo "::error::$action $tag is ${age} h old (published $published); the minimum is ${min_hours} h. Re-run once it is old enough."
    failed=1
  else
    echo "$action $tag: ${age} h old"
  fi
done < <(grep -rhoE 'uses: [^ ]+@[0-9a-f]{40} # v[^ ]+' .github/workflows \
  | sed -E 's/uses: ([^@]+)@([0-9a-f]{40}) # (v[^ ]+)/\1 \2 \3/' | sort -u)

exit "$failed"
