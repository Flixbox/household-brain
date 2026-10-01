#!/usr/bin/env bash
# Watches a pull request for human or bot activity: new comments, reviews, review comments, or the PR
# being merged or closed. Exits as soon as something happens, printing what it was.
#
#   scripts/watch-pr.sh <number> [max-hours]   (default 12)
#
# Exit codes: 0 new activity, 3 PR merged or closed, 2 nothing happened before the limit.
# Run it in the background next to scripts/watch-ci.sh, and start it again after handling each event.
set -euo pipefail

REPO=${REPO:-Flixbox/household-brain}
pr=$1
limit=$(( ${2:-12} * 3600 ))
started=$(date +%s)

snapshot() {
  gh api --paginate "repos/$REPO/issues/$pr/comments" --jq '.[] | "comment \(.id) \(.user.login): \(.body | gsub("\\s+"; " ") | .[0:160])"'
  gh api --paginate "repos/$REPO/pulls/$pr/reviews" --jq '.[] | "review \(.id) \(.user.login) \(.state): \(.body | gsub("\\s+"; " ") | .[0:160])"'
  gh api --paginate "repos/$REPO/pulls/$pr/comments" --jq '.[] | "review-comment \(.id) \(.user.login) \(.path):\(.line // .original_line): \(.body | gsub("\\s+"; " ") | .[0:160])"'
}

seen=$(snapshot | sort)
echo "Watching PR #$pr ($(wc -l <<<"$seen" | tr -d ' ') existing items)"
while true; do
  state=$(gh pr view "$pr" --repo "$REPO" --json state --jq .state)
  if [[ $state != OPEN ]]; then
    echo "PR #$pr is $state"
    exit 3
  fi
  now=$(snapshot | sort)
  new=$(comm -13 <(echo "$seen") <(echo "$now"))
  if [[ -n $new ]]; then
    echo "New activity on PR #$pr:"
    echo "$new"
    exit 0
  fi
  if (( $(date +%s) - started > limit )); then
    echo "No activity on PR #$pr for $(( limit / 3600 )) h"
    exit 2
  fi
  sleep 60
done
