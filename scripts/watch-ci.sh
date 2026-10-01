#!/usr/bin/env bash
# Watches the CI run for one commit until it finishes, or raises an alert once it has run too long.
#
#   scripts/watch-ci.sh <run-id> [max-minutes]          a specific run
#   scripts/watch-ci.sh --commit <sha> [max-minutes]    the CI run of that commit (e.g. after a push or a merge)
#   scripts/watch-ci.sh --pr <number> [max-minutes]     the CI run of the PR's head commit
#
# Default limit: 20 minutes. Only runs of the CI workflow count (WORKFLOW, default ci.yml), so
# Dependabot and other workflows triggered by the same commit are never picked up by mistake.
# Prefer --commit "$(git rev-parse HEAD)" right after a push: --pr asks GitHub for the PR's head,
# which can still be the previous commit for a few seconds.
#
# Exit codes: 0 run succeeded, 1 run failed or was cancelled, 2 ALERT: still running past the limit.
# Run it in the background; its exit is the notification. Never poll by hand alongside it.
set -euo pipefail

REPO=${REPO:-Flixbox/household-brain}
WORKFLOW=${WORKFLOW:-ci.yml}

run_for_commit() {
  local sha=$1 run=""
  for _ in $(seq 1 30); do
    run=$(gh run list --repo "$REPO" --workflow "$WORKFLOW" --commit "$sha" --json databaseId \
      --jq '.[0].databaseId // empty')
    [[ -n $run ]] && { echo "$run"; return; }
    sleep 10
  done
  echo "No $WORKFLOW run appeared for ${sha:0:7} within 5 minutes" >&2
  exit 1
}

case ${1:-} in
  --commit) run=$(run_for_commit "$(git rev-parse "$2")"); shift 2 ;;
  --pr) run=$(run_for_commit "$(gh pr view "$2" --repo "$REPO" --json headRefOid --jq .headRefOid)"); shift 2 ;;
  *) run=$1; shift ;;
esac
limit=$(( ${1:-20} * 60 ))
echo "Watching run $run (limit $(( limit / 60 )) min)"

jobs() { gh run view "$run" --repo "$REPO" --json jobs --jq '.jobs[] | "  \(.name): \(.status) \(.conclusion // "")"'; }

while true; do
  # A running job reports conclusion as "", not null, so default it explicitly; fields stay aligned.
  read -r created status conclusion < <(gh run view "$run" --repo "$REPO" --json status,conclusion,createdAt \
    --jq '"\(.createdAt) \(.status) \(if (.conclusion // "") == "" then "-" else .conclusion end)"')
  age=$(( $(date +%s) - $(date -d "$created" +%s) ))
  if [[ $status == completed ]]; then
    echo "Run $run finished after $(( age / 60 )) min: $conclusion"
    jobs
    [[ $conclusion == success ]] && exit 0 || exit 1
  fi
  if (( age > limit )); then
    echo "ALERT: run $run still $status after $(( age / 60 )) min (limit $(( limit / 60 )))"
    jobs
    exit 2
  fi
  sleep 30
done
