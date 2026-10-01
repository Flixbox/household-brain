#!/usr/bin/env bash
# Watches a pull request for human or bot activity: new comments, reviews, review comments, or the PR
# being merged or closed. Exits as soon as something happens, printing what it was.
#
#   scripts/watch-pr.sh <number> [max-hours]   (whole hours, default 12)
#
# Exit codes: 0 new activity, 3 PR merged or closed, 2 nothing happened before the limit.
# Run it in the background next to scripts/watch-ci.sh, and start it again after handling each event.
# Items are compared by id, so an edited comment, or a review comment that moves when a push changes
# the diff, does not count as new. A failed GitHub call is retried, never fatal.
set -uo pipefail

REPO=${REPO:-Flixbox/household-brain}
pr=$1
hours=${2:-12}
[[ $hours =~ ^[0-9]+$ ]] || { echo "max-hours must be a whole number" >&2; exit 64; }
limit=$(( hours * 3600 ))
started=$(date +%s)

# One line per item: "<kind> <id> <rest>"; the first two fields identify it.
snapshot() {
  gh api --paginate "repos/$REPO/issues/$pr/comments" \
    --jq '.[] | "comment \(.id) \(.user.login): \((.body // "") | gsub("\\s+"; " ") | .[0:160])"' &&
  gh api --paginate "repos/$REPO/pulls/$pr/reviews" \
    --jq '.[] | "review \(.id) \(.user.login) \(.state): \((.body // "") | gsub("\\s+"; " ") | .[0:160])"' &&
  gh api --paginate "repos/$REPO/pulls/$pr/comments" \
    --jq '.[] | "review-comment \(.id) \(.user.login) \(.path): \((.body // "") | gsub("\\s+"; " ") | .[0:160])"'
}

ids() { awk '{ print $1, $2 }' | sort; }

until seen=$(snapshot); do sleep 60; done
seen_ids=$(ids <<<"$seen")
echo "Watching PR #$pr ($(grep -c . <<<"$seen" || true) existing items)"

while true; do
  if (( $(date +%s) - started > limit )); then
    echo "No activity on PR #$pr for $hours h"
    exit 2
  fi
  sleep 60
  state=$(gh pr view "$pr" --repo "$REPO" --json state --jq .state) || continue
  if [[ $state != OPEN ]]; then
    echo "PR #$pr is $state"
    exit 3
  fi
  now=$(snapshot) || continue
  new_ids=$(comm -13 <(echo "$seen_ids") <(ids <<<"$now"))
  if [[ -n $new_ids ]]; then
    echo "New activity on PR #$pr:"
    while read -r kind id; do
      grep -m1 "^$kind $id " <<<"$now"
    done <<<"$new_ids"
    exit 0
  fi
done
