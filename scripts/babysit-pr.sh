#!/usr/bin/env bash
# Babysits one pull request until something needs attention, then prints it and exits:
#
#   CI_PASSED / CI_FAILED     CI finished for the PR's current head commit
#   CI_SLOW                   a CI run (PR or deploy) has been going for more than the limit
#   MAIN_FAILED / MAIN_SLOW   the newest CI run on main failed or hangs, whichever PR caused it
#   CONFLICT                  the PR conflicts with its base branch: rebase it
#   ACTIVITY                  new comments, reviews (including a pending review's comments), review comments
#   DEPLOYED / DEPLOY_FAILED  the PR was merged and the deploy run on main finished
#   CLOSED                    closed without merging
#   IDLE                      nothing happened for max-hours
#
#   scripts/babysit-pr.sh <number> [ci-limit-minutes=20] [max-hours=12]
#
# It always follows the PR's *current* head commit, so a push needs no new watcher. It remembers what
# it already reported (in $STATE_DIR), so start it again after handling each event and it continues
# with the next one. Run it in the background; its exit is the notification. Run it from a copy of
# the script, not from a checkout you are editing (bash reads a script while running it).
set -uo pipefail

REPO=${REPO:-Flixbox/household-brain}
WORKFLOW=${WORKFLOW:-ci.yml}
# The agent runs this as its bot: GH=agent-gh (see .ai/AGENTS.md). Defaults to plain gh.
GH=${GH:-gh}
# Comments are read with the owner's login: a pending (unsubmitted) review is only visible to its
# author, and the owner leaves those. Override with ACTIVITY_GH.
ACTIVITY_GH=${ACTIVITY_GH:-gh}
pr=$1
limit=$(( ${2:-20} * 60 ))
hours=${3:-12}
[[ $hours =~ ^[0-9]+$ ]] || { echo "max-hours must be a whole number" >&2; exit 64; }
state_dir=${STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/babysit-pr/${REPO//\//_}/$pr}
mkdir -p "$state_dir"
reported=$state_dir/reported   # one line per event already reported
seen=$state_dir/seen           # ids of comments and reviews already reported
touch "$reported" "$seen"  # "started" marks that existing items were recorded
started=$(date +%s)

report() { # report <key> <message...>: print and exit unless this key was reported before
  local key=$1
  shift
  grep -qxF "$key" "$reported" && return
  echo "$key" >>"$reported"
  printf '%s\n' "$@"
  exit 0
}

activity() { # one line per item: "<kind> <id> <author> <text>"
  "$ACTIVITY_GH" api --paginate "repos/$REPO/issues/$pr/comments" \
    --jq '.[] | "comment \(.id) \(.user.login): \((.body // "") | gsub("\\s+"; " ") | .[0:200])"' &&
  "$ACTIVITY_GH" api --paginate "repos/$REPO/pulls/$pr/reviews" \
    --jq '.[] | "review \(.id) \(.user.login) \(.state): \((.body // "") | gsub("\\s+"; " ") | .[0:200])"' &&
  "$ACTIVITY_GH" api --paginate "repos/$REPO/pulls/$pr/comments" \
    --jq '.[] | "review-comment \(.id) \(.user.login) \(.path): \((.body // "") | gsub("\\s+"; " ") | .[0:200])"'
}

ids() { awk 'NF >= 2 { print $1, $2 }' | sort -u; }

check_activity() {
  local now new
  now=$(activity) || return
  new=$(comm -13 <(sort -u "$seen") <(ids <<<"$now"))
  [[ -z $new ]] && return
  echo "$new" >>"$seen"
  echo "ACTIVITY on PR #$pr:"
  while read -r kind id; do
    grep -m1 "^$kind $id " <<<"$now" || echo "$kind $id"
    # A pending review's comments are only visible to its author: read with the owner's login.
    [[ $kind == review ]] && "$ACTIVITY_GH" api "repos/$REPO/pulls/$pr/reviews/$id/comments" \
      --jq '.[] | "  \(.path):\(.line // .original_line // "file"): \((.body // "") | gsub("\\s+"; " ") | .[0:400])"'
  done <<<"$new"
  exit 0
}

check_run() { # check_run <sha> <label>: report a finished or slow CI run of that commit
  local sha=$1 label=$2 run status conclusion created age
  # startedAt is the current attempt's start, so a re-run is timed from when it actually began.
  read -r run created status conclusion < <("$GH" run list --repo "$REPO" --workflow "$WORKFLOW" --commit "$sha" \
    --json databaseId,startedAt,status,conclusion \
    --jq '.[0] // empty | "\(.databaseId) \(.startedAt) \(.status) \(if (.conclusion // "") == "" then "-" else .conclusion end)"') || return
  [[ -z ${run:-} ]] && return
  local jobs
  jobs=$("$GH" run view "$run" --repo "$REPO" --json jobs --jq '.jobs[] | "  \(.name): \(.status) \(.conclusion // "")"')
  # report() returns when the event was already reported, so every branch ends in `return`.
  if [[ $status == completed ]]; then
    if [[ $label == deploy && $conclusion == success ]]; then
      report "deployed $sha" "DEPLOYED: PR #$pr is live (run $run)" "$jobs"
    elif [[ $label == deploy ]]; then
      report "deploy-failed $sha" "DEPLOY_FAILED: run $run on main ended $conclusion: open a follow-up PR" "$jobs"
    elif [[ $conclusion == success ]]; then
      report "ci-passed $sha" "CI_PASSED for ${sha:0:7} (run $run)" "$jobs"
    elif [[ $conclusion != cancelled ]]; then # cancelled: superseded by a newer push
      report "ci-failed $sha" "CI_FAILED for ${sha:0:7} (run $run): $conclusion. gh run view $run --repo $REPO --log-failed" "$jobs"
    fi
    return
  fi
  age=$(( $(date +%s) - $(date -d "$created" +%s) ))
  (( age > limit )) && report "ci-slow $run" "CI_SLOW: run $run ($label, ${sha:0:7}) still $status after $(( age / 60 )) min. Cancel it and read the logs." "$jobs"
}

check_main() { # the newest CI run on main, whichever PR it came from
  local run started status conclusion age
  read -r run started status conclusion < <("$GH" run list --repo "$REPO" --workflow "$WORKFLOW" --branch main --event push --limit 1 \
    --json databaseId,startedAt,status,conclusion \
    --jq '.[0] // empty | "\(.databaseId) \(.startedAt) \(.status) \(if (.conclusion // "") == "" then "-" else .conclusion end)"') || return
  [[ -z ${run:-} ]] && return
  if [[ $status == completed ]]; then
    [[ $conclusion == success || $conclusion == cancelled ]] && return
    report "main-failed $run" "MAIN_FAILED: CI run $run on main ended $conclusion. Fix main first (follow-up PR). gh run view $run --repo $REPO --log-failed"
    return
  fi
  age=$(( $(date +%s) - $(date -d "$started" +%s) ))
  (( age > limit )) && report "main-slow $run" "MAIN_SLOW: CI run $run on main still $status after $(( age / 60 )) min. Cancel it and read the logs."
}

# Comments that existed before the first run are not news.
if [[ ! -e $state_dir/started ]]; then
  until existing=$(activity); do sleep 30; done
  ids <<<"$existing" >"$seen"
  touch "$state_dir/started"
fi

while true; do
  read -r state mergeable head merge_sha < <("$GH" pr view "$pr" --repo "$REPO" --json state,mergeable,headRefOid,mergeCommit \
    --jq '"\(.state) \(.mergeable) \(.headRefOid) \(.mergeCommit.oid // "-")"') || { sleep 30; continue; }
  check_main
  case $state in
    MERGED) check_run "$merge_sha" deploy ;;
    CLOSED) report "closed" "CLOSED: PR #$pr was closed without merging" ;;
    *)
      [[ $mergeable == CONFLICTING ]] && report "conflict $head" "CONFLICT: PR #$pr conflicts with its base branch at ${head:0:7}: rebase on main"
      check_run "$head" pr
      check_activity
      ;;
  esac
  (( $(date +%s) - started > hours * 3600 )) && { echo "IDLE: nothing happened on PR #$pr for $hours h"; exit 0; }
  sleep 30
done
