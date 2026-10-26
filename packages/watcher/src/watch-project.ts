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
 *   PR #<n>: BLOCKED_BY_REVIEW       approved, CI green, but GitHub blocks the merge (#278): names each open
 *                                    thread the agent answered last (reply `Resolved: <reason>` once settled),
 *                                    and each change request left on an older commit (the owner dismisses it)
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
 *                                    last on every notification: the owner's Claude usage (#233)
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
 * one watcher lasts the whole session; the reminders and the usage close each look that found any.
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
