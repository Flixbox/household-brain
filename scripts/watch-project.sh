#!/usr/bin/env bash
# Watches the whole project until something needs attention, then prints it and exits:
#
#   PR #<n>: CI_PASSED / CI_FAILED   CI finished for the PR's current head commit
#   PR #<n>: CI_SLOW                 a CI run (PR or deploy) has been going for more than the limit
#   PR #<n>: CONFLICT                the PR conflicts with its base branch: rebase it
#   PR #<n>: MAIN_MOVED              main got commits the PR doesn't have yet: rebase and test again
#   PR #<n>: APPROVED                the owner approved (enable auto-merge once it is well reviewed)
#   PR #<n>: READY_TO_MERGE          approved, CI green for the current head, auto-merge still off
#   PR #<n>: ACTIVITY                new comments, reviews (also a pending review's comments), review comments
#   PR #<n>: DEPLOYED / DEPLOY_FAILED  merged, and the deploy run on main finished
#   PR #<n>: CLOSED                  closed without merging
#   MAIN_ADVANCED                    main got a new commit (a merge, whoever made it)
#   MAIN_FAILED / MAIN_SLOW          the newest CI run on main failed or hangs, whichever PR caused it
#   NEW_ISSUE / ISSUE_COMMENT        a new issue (not the agent's own), or the owner commented on one
#   IDLE                             nothing happened for max-hours
#
#   scripts/watch-project.sh [ci-limit-minutes=20] [max-hours=12]
#
# Open pull requests are watched, and every one seen open stays watched until its deploy (or its
# closing) is reported; merged ones from the last few hours too, for a fresh state. Each follows its
# PR's *current* head commit, so a push needs no restart. It remembers what it reported (in
# $STATE_DIR), so start it again after handling each event and it continues with the next one. Run
# it in the background (its exit is the notification), from a copy, not from a checkout you are
# editing: bash reads a script while running it.
set -uo pipefail

REPO=${REPO:-Flixbox/household-brain}
WORKFLOW=${WORKFLOW:-ci.yml}
# The agent runs this as its bot: GH=agent-gh (see .ai/AGENTS.md). Defaults to plain gh.
GH=${GH:-gh}
# Comments are read with the owner's login: a pending (unsubmitted) review is only visible to its
# author, and the owner leaves those. Override with ACTIVITY_GH.
ACTIVITY_GH=${ACTIVITY_GH:-gh}
OWNER=${OWNER:-Flixbox}
# The agent's own comments and replies in review threads are not news to it. Its reviews (the reviewer
# agent posts as the same bot) still are.
SELF=${SELF:-flixbox-ai-agent[bot]}
# On a fresh state, pull requests merged this recently are watched for their deploy.
MERGED_HOURS=${MERGED_HOURS:-3}
limit=$(( ${1:-20} * 60 ))
hours=${2:-12}
[[ $hours =~ ^[0-9]+$ ]] || { echo "max-hours must be a whole number" >&2; exit 64; }
state_dir=${STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/watch-project/${REPO//\//_}}
mkdir -p "$state_dir"
reported=$state_dir/reported   # one line per event already reported
issues_seen=$state_dir/issues  # the first 80 characters of each issue line already reported
tracked=$state_dir/tracked     # pull requests followed until their deploy or closing is reported
main_head=$state_dir/main      # the newest commit on main already reported
touch "$reported" "$tracked"
started=$(date +%s)
pr=

report() { # report <key> <message...>: print and exit unless this key was reported before
  local key=$1
  shift
  grep -qxF "$key" "$reported" && return
  echo "$key" >>"$reported"
  [[ -n $pr ]] && set -- "PR #$pr: $1" "${@:2}"
  printf '%s\n' "$@"
  exit 0
}

# One line per item of the current PR: "<kind> <id> <author> <text>". Nx Cloud's status comment on
# every push needs no answer, nor do the agent's own comments.
activity() {
  "$ACTIVITY_GH" api --paginate "repos/$REPO/issues/$pr/comments" \
    --jq '.[] | select(.user.login != "nx-cloud[bot]" and .user.login != "'"$SELF"'") | "comment \(.id) \(.user.login): \((.body // "") | gsub("\\s+"; " ") | .[0:200])"' &&
  "$ACTIVITY_GH" api --paginate "repos/$REPO/pulls/$pr/reviews" \
    --jq '.[] | select(.state != "APPROVED" or (.body // "") != "") | select(.user.login != "'"$SELF"'" or (.body // "") != "") | "review \(.id) \(.user.login) \(.state): \((.body // "") | gsub("\\s+"; " ") | .[0:200])"' &&
  "$ACTIVITY_GH" api --paginate "repos/$REPO/pulls/$pr/comments" \
    --jq '.[] | select(.user.login != "'"$SELF"'" or .in_reply_to_id == null) | "review-comment \(.id) \(.user.login) \(.path): \((.body // "") | gsub("\\s+"; " ") | .[0:200])"'
}

ids() { awk 'NF >= 2 { print $1, $2 }' | sort -u; }

check_activity() {
  local seen=$state_dir/pr-$pr-seen now new
  now=$(activity) || return
  # Comments that existed before the PR was first watched are not news.
  [[ -e $seen ]] || { ids <<<"$now" >"$seen"; return; }
  new=$(comm -13 <(sort -u "$seen") <(ids <<<"$now"))
  [[ -z $new ]] && return
  echo "$new" >>"$seen"
  echo "PR #$pr: ACTIVITY:"
  while read -r kind id; do
    grep -m1 "^$kind $id " <<<"$now" || echo "$kind $id"
    # A pending review's comments are only visible to its author: read with the owner's login.
    [[ $kind == review ]] && "$ACTIVITY_GH" api "repos/$REPO/pulls/$pr/reviews/$id/comments" \
      --jq '.[] | "  \(.path):\(.line // .original_line // "file"): \((.body // "") | gsub("\\s+"; " ") | .[0:400])"'
  done <<<"$new"
  exit 0
}

check_run() { # check_run <sha> <label>: report a finished or slow CI run of that commit
  local sha=$1 label=$2 line run attempt status conclusion created age jobs
  # startedAt is the current attempt's start, so a re-run is timed from when it actually began.
  line=$("$GH" run list --repo "$REPO" --workflow "$WORKFLOW" --commit "$sha" \
    --json databaseId,attempt,startedAt,status,conclusion \
    --jq '.[0] // empty | "\(.databaseId) \(.attempt) \(.startedAt) \(.status) \(if (.conclusion // "") == "" then "-" else .conclusion end)"') || return
  read -r run attempt created status conclusion <<<"$line"
  [[ -z ${conclusion:-} ]] && return
  jobs=$("$GH" run view "$run" --repo "$REPO" --json jobs --jq '.jobs[] | "  \(.name): \(.status) \(.conclusion // "")"')
  # report() returns when the event was already reported, so every branch ends in `return`. Failures
  # are keyed by attempt too, so a re-run that fails again is reported again.
  if [[ $status == completed ]]; then
    if [[ $label == deploy && $conclusion == success ]]; then
      report "pr-$pr deployed $sha" "DEPLOYED: live (run $run)" "$jobs"
    elif [[ $label == deploy ]]; then
      report "pr-$pr deploy-failed $sha $attempt" "DEPLOY_FAILED: run $run on main ended $conclusion: open a follow-up PR" "$jobs"
    elif [[ $conclusion == success ]]; then
      report "pr-$pr ci-passed $sha" "CI_PASSED for ${sha:0:7} (run $run)" "$jobs"
    elif [[ $conclusion != cancelled ]]; then # cancelled: superseded by a newer push
      report "pr-$pr ci-failed $sha $attempt" "CI_FAILED for ${sha:0:7} (run $run): $conclusion. gh run view $run --repo $REPO --log-failed" "$jobs"
    fi
    return
  fi
  age=$(( $(date +%s) - $(date -d "$created" +%s) ))
  (( age > limit )) && report "pr-$pr ci-slow $run $attempt" "CI_SLOW: run $run ($label, ${sha:0:7}) still $status after $(( age / 60 )) min. Cancel it and read the logs." "$jobs"
}

check_main() { # the newest CI run on main, whichever PR it came from
  local line run attempt created status conclusion age
  line=$("$GH" run list --repo "$REPO" --workflow "$WORKFLOW" --branch main --event push --limit 1 \
    --json databaseId,attempt,startedAt,status,conclusion \
    --jq '.[0] // empty | "\(.databaseId) \(.attempt) \(.startedAt) \(.status) \(if (.conclusion // "") == "" then "-" else .conclusion end)"') || return
  read -r run attempt created status conclusion <<<"$line"
  [[ -z ${conclusion:-} ]] && return
  if [[ $status == completed ]]; then
    [[ $conclusion == success || $conclusion == cancelled ]] && return
    report "main-failed $run $attempt" "MAIN_FAILED: CI run $run on main ended $conclusion. Fix main first (follow-up PR). gh run view $run --repo $REPO --log-failed"
    return
  fi
  age=$(( $(date +%s) - $(date -d "$created" +%s) ))
  (( age > limit )) && report "main-slow $run $attempt" "MAIN_SLOW: CI run $run on main still $status after $(( age / 60 )) min. Cancel it and read the logs."
}

check_main_head() { # a new commit on main, so it never moves on unnoticed
  local line sha subject
  line=$("$GH" api "repos/$REPO/commits/main" --jq '"\(.sha) \(.commit.message | split("\n")[0])"') || return
  read -r sha subject <<<"$line"
  [[ -n ${sha:-} ]] || return 0
  # The commit main was at on the first run is not news.
  [[ -e $main_head ]] || { echo "$sha" >"$main_head"; return; }
  [[ $(<"$main_head") == "$sha" ]] && return
  echo "$sha" >"$main_head"
  report "main-head $sha" "MAIN_ADVANCED: main is at ${sha:0:7}: $subject"
}

check_moved() { # main has commits the PR's branch doesn't
  local head=$1 line ahead main_sha now
  line=$("$GH" api "repos/$REPO/compare/$head...main" --jq '"\(.ahead_by) \(.commits[-1].sha // "-")"') || return
  read -r ahead main_sha <<<"$line"
  (( ${ahead:-0} > 0 )) || return 0
  # The PR may have been merged since its state was read: then the new commit on main is its own
  # squash merge, not someone else's, and the next round reports the deploy instead.
  now=$("$GH" pr view "$pr" --repo "$REPO" --json state --jq .state) || return
  [[ $now == OPEN ]] || return 0
  report "pr-$pr main-moved $main_sha" "MAIN_MOVED: main is $ahead commit(s) ahead of the branch: rebase on main and run the checks again"
}

check_pr() {
  local line state mergeable head merge_sha decision auto
  line=$("$GH" pr view "$pr" --repo "$REPO" \
    --json state,mergeable,headRefOid,mergeCommit,reviewDecision,autoMergeRequest \
    --jq '"\(.state) \(.mergeable) \(.headRefOid) \(.mergeCommit.oid // "-") \(.reviewDecision // "-") \(if .autoMergeRequest then "on" else "off" end)"') \
    || return
  read -r state mergeable head merge_sha decision auto <<<"$line"
  case $state in
    MERGED)
      # A failed deploy stays watched: a re-run of it may still go live.
      if grep -q "^pr-$pr deployed " "$reported"; then untrack; else check_run "$merge_sha" deploy; fi
      ;;
    CLOSED)
      untrack
      report "pr-$pr closed" "CLOSED without merging"
      ;;
    OPEN)
      grep -qxF "$pr" "$tracked" || echo "$pr" >>"$tracked"
      [[ $mergeable == CONFLICTING ]] && report "pr-$pr conflict $head" "CONFLICT at ${head:0:7}: rebase on main"
      [[ $decision == APPROVED ]] && report "pr-$pr approved" "APPROVED by the owner. Once it is well reviewed, enable auto-merge: agent-gh pr merge $pr --auto --squash"
      check_run "$head" pr
      [[ $decision == APPROVED && $auto == off ]] && grep -qxF "pr-$pr ci-passed $head" "$reported" \
        && report "pr-$pr ready $head" "READY_TO_MERGE: approved and CI is green at ${head:0:7}, but auto-merge is off. Enable it: agent-gh pr merge $pr --auto --squash"
      check_moved "$head"
      check_activity
      ;;
  esac
}

untrack() { grep -vxF "$pr" "$tracked" >"$tracked.new"; mv "$tracked.new" "$tracked"; }

watched_prs() { # open pull requests, the ones followed until their deploy, and recently merged ones
  "$GH" pr list --repo "$REPO" --state open --json number --jq '.[].number' &&
  "$GH" pr list --repo "$REPO" --state merged --limit 20 --json number,mergedAt \
    --jq '.[] | select((.mergedAt | fromdate) > (now - '"$MERGED_HOURS"' * 3600)) | .number' &&
  cat "$tracked"
}

# One line per issue and per owner comment on an issue; its first 80 characters are its key.
issue_events() {
  "$GH" api "repos/$REPO/issues?state=all&per_page=50&sort=created&direction=desc" \
    --jq '.[] | select(.pull_request == null and .user.login != "'"$SELF"'") | "NEW_ISSUE #\(.number) \(.title)"' &&
  "$GH" api "repos/$REPO/issues/comments?per_page=50&sort=created&direction=desc" \
    --jq '.[] | select(.user.login == "'"$OWNER"'") | select(.html_url | contains("/issues/")) | "ISSUE_COMMENT \(.id) #\(.issue_url | split("/") | last): \((.body // "") | gsub("\\s+"; " ") | .[0:300])"'
}

check_issues() {
  local now new
  now=$(issue_events) || return
  # Issues and comments from before the first run are not news.
  [[ -e $issues_seen ]] || { cut -c1-80 <<<"$now" >"$issues_seen"; return; }
  new=$(while IFS= read -r line; do grep -qxF "${line:0:80}" "$issues_seen" || echo "$line"; done <<<"$now")
  [[ -z $new ]] && return
  cut -c1-80 <<<"$new" >>"$issues_seen"
  echo "$new"
  exit 0
}

while true; do
  pr=
  check_main
  check_main_head
  check_issues
  # A round with a failed listing is skipped rather than run with pull requests missing.
  if prs=$(watched_prs); then
    for pr in $(sort -un <<<"$prs"); do
      check_pr
    done
  fi
  (( $(date +%s) - started > hours * 3600 )) && { echo "IDLE: nothing happened for $hours h"; exit 0; }
  sleep 60
done
