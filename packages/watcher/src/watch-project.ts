/**
 * Watches the whole project until something needs attention, then prints every event pending, the
 * ones someone waits for an answer to (ACTIVITY, APPROVED, …, new issues and comments) first (#222).
 * Each event starts with when it was found, and for a comment or issue when it was written
 * (`[12:27:03, written 12:09:20] ISSUE_COMMENT …`, #240); a comment or review under ACTIVITY names
 * when it was written after its author:
 *
 *   PR #<n>: NEW_PR                  a pull request opened (by anyone, Dependabot included)
 *   PR #<n>: CI_PASSED / CI_FAILED   CI finished for the PR's current head commit
 *   PR #<n>: CI_SLOW                 a CI run (PR or deploy) has been going for more than the limit
 *   PR #<n>: CONFLICT                the PR conflicts with its base branch: rebase it
 *   PR #<n>: MAIN_MOVED              main got commits the PR doesn't have yet: rebase and test again
 *   PR #<n>: APPROVED                the owner approved (enable auto-merge once it is well reviewed)
 *   PR #<n>: READY_TO_MERGE          approved, CI green for the current head, auto-merge still off
 *   PR #<n>: APPROVED_DRAFT          approved but still a draft (#298): mark it ready, queue (after the review a bot was asked for)
 *   PR #<n>: DRAFT_READIED           with READY_APPROVED_DRAFTS=1 (off by default, #301): the owner's latest review
 *                                    approves a draft, on any commit (#317, named), and the watcher marked it
 *                                    ready (`$GH pr ready <n>`) instead of reporting APPROVED_DRAFT: queue
 *                                    (after the review a bot was asked for).
 *                                    DRAFT_READY_FAILED: it couldn't (it tries again on every look; APPROVED_DRAFT too)
 *   PR #<n>: BLOCKED_BY_REVIEW       the owner approved, CI green, but GitHub blocks the merge (#278): names
 *                                    each open thread the agent answered last (reply `Resolved: <reason>`
 *                                    once settled), and each change request still counted, on an older
 *                                    commit or the head (the owner dismisses it, or, for a bot's on the
 *                                    head, `Resolved:` replies settle it, #290; GitHub's decision stays
 *                                    CHANGES_REQUESTED until then, #286)
 *   PR #<n>: REVIEW_DISMISSED        with DISMISS_STALE_BOT_REVIEWS=1 (off by default, #285): the owner approved,
 *                                    no review thread is open unsettled, and the watcher dismissed a bot's
 *                                    change request left on an older commit, or on the head once the agent
 *                                    or the owner settled it with `Resolved:` replies (in each of its threads,
 *                                    or on the PR when it has none, #290), with its `GH` token. Also without
 *                                    the owner's approval on a PR labelled CLEARED_LABEL (`subagent-cleared`
 *                                    by default, #327) with CI green; the label comes off once it dismissed.
 *                                    REVIEW_DISMISS_FAILED: it couldn't (it tries again on every look)
 *   PR #<n>: BOT_RESOLVE_ASKED       with RESOLVE_BOT_REVIEWS naming a bot (none by default, #303): its latest
 *                                    review requests changes on the head, every review thread is resolved,
 *                                    CI passed, and the PR is no draft, not the owner's and not approved by
 *                                    them: the watcher posted `@<bot> resolve` (once per head), and the bot's
 *                                    own risk limit decides whether it approves. BOT_RESOLVE_FAILED: it
 *                                    couldn't (it tries again on every look)
 *   PR #<n>: BOT_REVIEW_ASKED        with REVIEW_BOTS naming a bot, the PR got the label BOT_REVIEW_LABEL (`bot-review`
 *                                    by default, #324): the watcher posted `@<bot> review`, once per PR ever, and
 *                                    took the label off; READY_TO_MERGE and its reminder then wait for that review
 *                                    (or for one in progress), and only then. BOT_REVIEW_SKIPPED: the bot reviewed
 *                                    the PR or was asked already, so it isn't asked again. BOT_REVIEW_FAILED: the
 *                                    comment failed (it tries again on every look, the label stays)
 *   PR #<n>: THREAD_RESOLVED         the watcher resolved a review thread whose last comment, from anyone,
 *                                    starts `Resolved: <reason>` (#279), with its `GH` token; agents never
 *                                    resolve threads themselves. THREAD_RESOLVE_FAILED: it couldn't (it
 *                                    tries again on every look)
 *   PR #<n>: ACTIVITY                new comments, reviews (also a pending review's comments), review comments
 *   PR #<n>: DEPLOYED / DEPLOY_FAILED  merged, and the deploy run on main finished
 *   PR #<n>: CLOSED                  closed without merging
 *   PR #<n>: QUEUED / DEQUEUED       entered the merge queue, or left it without merging (#251)
 *   MAIN_ADVANCED                    main got a new commit (a merge, whoever made it)
 *   MAIN_PASSED / MAIN_FAILED        the newest CI run on main passed, or failed whichever PR caused it
 *   MAIN_SLOW                        the newest CI run on main hangs
 *   NEW_ISSUE / ISSUE_COMMENT        a new issue (not the agent's own), or the owner commented on one
 *   ISSUE_CLOSED / ISSUE_REOPENED    an issue was closed (by anyone; also deleted or transferred, #263)
 *                                    or reopened
 *   IDLE                             nothing happened for max-hours (with --follow: a heartbeat, then it goes on)
 *   WATCHER_ERROR                    a look failed (e.g. a state file stayed locked); it goes on with the next
 *   WATCHER_OUTDATED                 its code changed in its checkout after it started (#265); it exits:
 *                                    start it again
 *   LOOKUPS_FAILING / LOOKUPS_RECOVERED  no `gh` call has succeeded for minutes (on every look while it
 *                                    lasts), or they succeed again (#253)
 *   Usage: session <n>% used (<m>% left, resets …), week <n>% used (<m>% left, resets …)
 *                                    last on a notification: the owner's Claude usage (#233), only when the
 *                                    session's or the week's use crossed a 2.5% step since this watcher's
 *                                    last one (at most once a minute), or 10 minutes after it (#318); with
 *                                    --follow also on its own when no event brought it; old numbers end
 *                                    with `(as of HH:MM)`
 *   REMINDER: PR #<n> …              after every notification, each open PR that waits on the agent: a
 *                                    branch behind main or in conflict, or approved with CI finished
 *                                    (auto-merge to enable, or CI to fix)
 *
 * Every CI result (a PR's, a deploy's or main's) ends with the list of open PRs.
 *
 *   bun packages/watcher/src/watch-project.ts [--follow] [ci-limit-minutes=20] [max-hours=12]
 *
 * Open pull requests are watched, and every one seen open stays watched until its deploy (or its
 * closing) is reported; merged ones from the last few hours too, for a fresh state. Each follows its
 * PR's *current* head commit, so a push needs no restart. It remembers what it reported
 * (watch-state.ts), so start it again after handling the events and it continues with the next ones.
 * Any number of watchers can watch the same repository at once, and each reports every event (#264):
 * each remembers on its own (WATCHER_ID), and they share `gh`'s answers for a moment (watch-gh.ts).
 * Run it in the background: its exit is the notification. Bun reads the watcher's files once, when
 * it loads them, so editing the checkout meanwhile changes nothing; once a commit changes its code,
 * it says WATCHER_OUTDATED and exits (#265).
 *
 * With `--follow` it keeps running instead (#196): each event is printed the moment it is found
 * (#240), ending with a `---` line, for a harness that wakes on new output (Claude Code's Monitor), so
 * one watcher lasts the whole session; the reminders and the usage (when due) close each look that found any, and a
 * due usage line comes on its own after a quiet look.
 * Following, two pollers run side by side (#240): one for what someone waits for an answer to (new
 * issues, the owner's comments, every followed PR's comments and reviews), every 30 s; one for main
 * and each PR's CI, reviews and deploy, every 60 s. The PRs are checked at once, with at most
 * GH_PARALLEL `gh` calls running, so one slow call holds back only its own events.
 */
// Which code this watcher runs is read before the rest of it is loaded (#265): a pull that finishes
// while it loads then shows as a change, never as the version it started on.
import { readStartedOn } from './watch-version'

await readStartedOn()
await import('./watch-main')
