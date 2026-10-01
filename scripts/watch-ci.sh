#!/usr/bin/env bash
# Watches one GitHub Actions run until it finishes, or raises an alert once it has run too long.
#
#   scripts/watch-ci.sh <run-id> [max-minutes]     (default 20)
#   scripts/watch-ci.sh --pr <number> [max-minutes] (watches the newest run of the PR's head commit)
#
# Exit codes: 0 run succeeded, 1 run failed or was cancelled, 2 ALERT: still running past the limit.
# Run it in the background; its exit is the notification. Never poll by hand alongside it.
set -euo pipefail

REPO=${REPO:-Flixbox/household-brain}
if [[ ${1:-} == --pr ]]; then
  sha=$(gh pr view "$2" --repo "$REPO" --json headRefOid --jq .headRefOid)
  shift 2
  run=""
  for _ in $(seq 1 30); do
    run=$(gh run list --repo "$REPO" --commit "$sha" --json databaseId --jq '.[0].databaseId // empty')
    [[ -n $run ]] && break
    sleep 10
  done
  [[ -n $run ]] || { echo "No run appeared for ${sha:0:7} within 5 minutes"; exit 1; }
else
  run=$1
  shift
fi
limit=$(( ${1:-20} * 60 ))

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
