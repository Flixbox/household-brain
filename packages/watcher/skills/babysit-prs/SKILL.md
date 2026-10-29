---
name: babysit-prs
description: Watch a GitHub repository's pull requests, CI runs, deploys and issues with the project watcher, and act on each event it reports (CI results, approvals, comments, conflicts, deploys, new issues). Use when owning a pull request from push to deploy, or when asked to keep an eye on a repository.
---

# Babysitting pull requests with the project watcher

You own a pull request from the moment you open it until it is merged and deployed. The project
watcher tells you when something needs you; this is what to do with what it says. The repository's
own notes (its `AGENTS.md` or `CLAUDE.md`) come first where they say more: which login to use,
how merging works there, how to check a deploy.

## Running it

One watcher for the whole repository: every open pull request, merged ones until their deploy, the
default branch's CI, new issues, the owner's comments on issues, and issues closed or reopened.

- **It runs by itself** once the project has a `.claude/watcher.env` with its settings (below, one
  `NAME=value` per line, no secrets): this plugin starts it the first time this skill runs in a
  session and keeps it running until the session ends, and every line it prints reaches you as a
  notification. Nothing to start or re-arm. Without the file it prints one line saying so and stops.
- **Without the file**, or outside an interactive session, run it yourself under Claude Code's
  `Monitor` with `--follow`:

  ```sh
  SELF='<your login>' bun --env-file=.claude/watcher.env "${CLAUDE_PLUGIN_ROOT}/src/watch-project.ts" --follow
  ```

  `--env-file` reads the same settings file when there is one (Bun ignores a missing one), and the
  environment still wins.

  A `Monitor` stops after 30 minutes at most: re-arm it when its expiry notice comes; the watcher
  remembers what it reported and picks up where it left off. Without `--follow` it exits after one
  look, with every event that look found: start it again after handling them.
- **Any number of watchers can watch the same repository at once**, one per Claude Code session, and
  each gets every event: each remembers what it reported on its own, under the session's id. **A
  subagent shares its session's id**: when it runs a watcher of its own beside its session's, it
  sets `WATCHER_ID` (below), or the two split the events between them.
- **Following**, it prints each event the moment it finds it and ends each one with a `---` line.
  The owner's comments and new issues have their own poller, every 30 s, so they never wait for CI
  and deploys. `IDLE` is a heartbeat, not an exit.
- **Each event starts with when it was found**, and a comment or issue also with when it was
  written (`[12:27:03, written 12:09:20] ISSUE_COMMENT …`): the gap is how late it came. Without
  `--follow`, a look prints every pending event, the ones to answer first (comments, reviews,
  approvals, conflicts, new issues), then CI, deploys and the rest: handle the answers before anything else.
- **Settings**, from the environment, or else from the project's `.claude/watcher.env`:
  - `GH`: the `gh` to ask with, e.g. a wrapper logged in as a bot. Plain `gh` by default.
  - `REPO`: `owner/name`. By default, the repository `gh` finds in the current folder.
  - `WORKFLOW`: the CI workflow file whose runs are followed (`ci.yml` by default).
  - `OWNER`: whose issue comments are news and whose approval counts. By default the repository's
    owner; when an organisation owns it, its one human admin (bots left out, #295). With no human
    admin or several, it stays the organisation, so no approval counts, and the watcher says so once
    at the start: set `OWNER` then.
  - `ACTIVITY_GH`: the `gh` that reads comments; plain `gh` by default, because only the owner's own
    login sees their pending (unsubmitted) review.
  - `GH_TIMEOUT_SECONDS`: how long one `gh` call may take (30 by default); a slower one counts as a
    failed read and is tried again next look, so one slow endpoint doesn't hold up the rest. A `GH`
    wrapper has to answer within it too, also when it first makes a token: one that never does
    never gets a token cached, and every call fails (`LOOKUPS_FAILING`).
  - `WATCHER_ID`: which watcher this is, so it remembers on its own (the Claude Code session's id by
    default; a watcher started again with the same id goes on where the last one stopped). Without
    either, every watcher of the repository shares one record and they split the events.
  - `GH_SHARE_SECONDS`: how long a `gh` answer is shared with the other watchers on this machine (20
    by default, at most 3600; 0 shares none): watchers asking the same question within it ask GitHub once, so
    several watchers cost hardly more than one.
  - `GH_PARALLEL`: how many `gh` calls run at once (4 by default); the pull requests are checked in
    parallel, and the cap keeps the bursts within GitHub's rate limits.
  - `REVIEW_BOTS`: the review bots' logins, comma-separated (`coderabbitai`, with or without `[bot]`).
    A PR the owner approved while it was a draft gets no `READY_TO_MERGE` and no auto-merge reminder
    until one of them has reviewed its current head (#299), since a review bot skips drafts. None by
    default: nothing waits.
  - `DISMISS_STALE_BOT_REVIEWS`: `1` lets the watcher dismiss a bot's (`…[bot]`) change request, once
    the owner approved and no review thread is open without a `Resolved:` reply: one left on an older
    commit (#285), or one on the head once the agent (`SELF`) or the owner settled it with `Resolved:
    <reason>` replies, the last comment in each of its threads, or a PR comment after it when it has
    no thread (#290). Its dismissal message quotes those replies; a newer review of the bot needs its
    own. Off by default, when `BLOCKED_BY_REVIEW` names it for the owner to dismiss. A person's
    change request is never dismissed. The `GH` token must be allowed to write pull requests.
  - `READY_APPROVED_DRAFTS`: `1` lets the watcher mark a draft ready itself (`$GH pr ready <n>`)
    once the owner (never a bot, nor anyone else) approved its current head (#301), and report
    `DRAFT_READIED` instead of `APPROVED_DRAFT`. Off by default, when `APPROVED_DRAFT` asks you to
    mark it ready. The `GH` token must be allowed to write pull requests.
  - `RESOLVE_BOT_REVIEWS`: the review bots to ask with `@<bot> resolve` (`coderabbitai`, with or
    without `[bot]`; comma-separated) (#303). A bot like CodeRabbit decides on approving only when it
    reviews a new commit, so a settled change request never turns into its approval by itself. Once
    its latest review on the head requests changes, every review thread is resolved and CI passed at
    the head, the watcher posts `@<bot> resolve` on the PR, once per head commit (`BOT_RESOLVE_ASKED`).
    It reads no risk rating: whatever the merge risk, it asks, and the bot's own settings
    (CodeRabbit's `max_merge_risk`) decide whether it approves. Not for a draft, a PR the owner
    opened, or one the owner approved (`DISMISS_STALE_BOT_REVIEWS` handles that one). None by
    default. The `GH` token must be allowed to comment on pull requests.
  - `CLAUDE_CONFIG_DIR`: where the Claude login lives (`~/.claude` by default). Every notification
    ends with the owner's Claude usage (`Usage: session 12% used (88% left, resets 2026-10-17 14:10), week 66% used (34% left, resets …)`,
    the windows `/usage` shows: how much is used and left, and when each resets),
    from the cache it shares with the `claude-usage` command (`packages/watcher/src/claude-usage.ts`,
    #260): the endpoint is asked at most once a minute and backed off after a refusal; meanwhile the
    last numbers read come with their time (`(as of 12:04)`), and `Usage: unknown` only when none
    ever were. `CLAUDE_USAGE_CACHE` moves that cache, `CLAUDE_USAGE_LOCK_PORT` its lock's port.
  - `SELF`: **set it to the login you comment as** (a bot's is `name[bot]`); without it your own
    comments, replies and issues are reported back to you as news. Your reviews still are.
- It remembers what it reported under `$XDG_STATE_HOME/watch-project`, per repository and watcher
  (`<owner>_<repo>/sessions/<hash of the id>/`, or `<owner>_<repo>/` without an id); a session's record is
  removed once it has been left untouched for two weeks.
- It follows each pull request's **current** head commit, so a push needs no restart, and stays armed
  through the merge to report the deploy. Don't poll by hand alongside it.
- A pull request labelled **`parked`** (left open on purpose) only reports its CI and comments.
- **Needs:** Bun, and `gh` logged in (or the `GH` wrapper).

## What each event asks for

Events come prefixed with their pull request (`PR #12: CI_PASSED …`). **Every CI result** ends with
the list of open pull requests (approved or not, auto-merge on or off, CI state): act on every
approved one whose auto-merge is still off and that isn't in the merge queue, not only on the one the event names.

| Event | What to do |
| --- | --- |
| `NEW_PR` | A pull request appeared (a dependency bot's too). Review it like any other; for a dependency bump, check what CI can't see. Reviewing it is fine; answering its author's comments isn't (see `ACTIVITY`). |
| `CI_PASSED` | Report it. |
| `CI_FAILED` | Read the failing job (`gh run view <run> --log-failed`), reproduce locally, fix, push once. |
| `CI_SLOW` | Something hangs. Cancel the run, read its logs, fix the hang **and** the missing time limit. |
| `CONFLICT` | Rebase on the default branch, run the checks, push once, reply on the pull request. |
| `MAIN_MOVED` | The default branch moved under the pull request. Rebase, run the checks, push once, so what gets merged is what was tested. |
| `APPROVED` | The owner approved: only `OWNER`'s approval counts, never a bot's or anyone else's (#277), here, in the open-PR list, `READY_TO_MERGE` and `REMINDER`. If the review's findings are fixed, read the pull request for unanswered comments, then enable auto-merge with the command the event names (`--squash` unless the branch merges through a merge queue), or as the repository's notes say). A plain approval comes only as this; one with text also comes as `ACTIVITY`: answer it first. For a PR already in the merge queue, the event says so: there is no auto-merge to enable. |
| `READY_TO_MERGE` | Approved and green, auto-merge still off: enable it the same way, unless review findings are still open. Not reported for a PR in the merge queue, or for a draft (`APPROVED_DRAFT`). |
| `APPROVED_DRAFT` | The owner approved a pull request that is still a draft (#298). A draft can't be queued and a review bot skips it, so: mark it ready (`gh pr ready <n>`, the command the event names), wait for the bot's review on the head and settle its threads, then enable auto-merge. Where `REVIEW_BOTS` names the bot, `READY_TO_MERGE` comes only once it has reviewed the head (#299). Where `READY_APPROVED_DRAFTS=1` and the owner approved the head, the watcher marks it ready itself and reports `DRAFT_READIED` instead (#301); this event then comes only for an approval of an older head, or when marking it ready failed. Neither `READY_TO_MERGE` nor its reminder comes while it is a draft; the open-PR list says `draft`. |
| `DRAFT_READIED` | With `READY_APPROVED_DRAFTS=1`, the owner approved a draft's head and the watcher marked it ready (#301). Wait for the bot's review on the head and settle its threads, then enable auto-merge, as for `APPROVED_DRAFT`; where `REVIEW_BOTS` names the bot, `READY_TO_MERGE` waits for its review. |
| `DRAFT_READY_FAILED` | The watcher couldn't mark the approved draft ready; it tries again on every look, and `APPROVED_DRAFT` asks you to do it meanwhile. Repeated, its `GH` token likely can't write pull requests: tell the owner. |
| `BLOCKED_BY_REVIEW` | The owner approved and CI is green (even while GitHub still says changes requested), but GitHub won't merge it, and the reviews are why. For each thread it names (answered by the agent, still open): check the answer settles it, then reply `Resolved: <reason>` in it with the reply helper (see `ACTIVITY`; the watcher resolves it), or ask the owner. For each change request it names (still counted until dismissed): check its points are dealt with. Where `DISMISS_STALE_BOT_REVIEWS=1`, the watcher dismisses a bot's change request itself (`REVIEW_DISMISSED`): one left on an older commit once no thread is open (resolved, or ending in a `Resolved:` reply, #285), one on the head once you settle it with a `Resolved: <reason>` reply in each of its threads, or on the PR when it has none (#290; a later comment of the owner's that isn't a `Resolved:` reply takes that back until a new `Resolved:` reply follows, #294). Otherwise ask the owner on the PR to dismiss it. |
| `THREAD_RESOLVED` | The watcher resolved a review thread on a `Resolved: <reason>` reply (anyone's, #279). Nothing to do. |
| `REVIEW_DISMISSED` | With `DISMISS_STALE_BOT_REVIEWS=1`, the watcher dismissed a bot's change request left on an older commit (the owner approved, no thread open, #285), or on the head once `Resolved:` replies settled it (#290). Nothing to do. |
| `BOT_RESOLVE_ASKED` | With `RESOLVE_BOT_REVIEWS` set, the watcher posted `@<bot> resolve` on a PR whose bot change request on the head is settled (every thread resolved, CI green, #303; not one without threads that a later owner comment took back, #294). Nothing to do: the bot resolves its threads and approves if its own risk limit allows; if it doesn't approve, the PR waits for the owner as before. |
| `BOT_RESOLVE_FAILED` | The watcher couldn't post that comment; it tries again on every look. Repeated, its `GH` token likely can't comment on pull requests: tell the owner. |
| `REVIEW_DISMISS_FAILED` | The watcher couldn't dismiss such a change request; it tries again on every look. Repeated, its `GH` token likely can't write pull requests: tell the owner. |
| `THREAD_RESOLVE_FAILED` | The watcher couldn't resolve such a thread; it tries again on every look. Repeated, its `GH` token likely can't write pull requests: tell the owner. |
| `QUEUED` | The PR entered the merge queue (with its position). Nothing to do; no auto-merge reminders come for it while it is there. |
| `NOT_QUEUED` | The PR is approved by the owner, CI is green, GitHub says its merge state is `CLEAN` and auto-merge is on, yet it has stayed outside the merge queue for minutes (#305): GitHub sometimes never queues such a PR, after a change request was dismissed or a rebase after a conflict, and enabling auto-merge again doesn't help. Read it for unanswered comments, then queue it with the `enqueuePullRequest` mutation the event names (it carries the PR's node id). Once per head commit; only where the branch merges through a merge queue. |
| `DEQUEUED` | The PR left the merge queue without merging, with GitHub's reason (failed checks, a conflict, removed by hand). Fix what it says, then queue it again. |
| `ACTIVITY` | Answer every comment **from the owner**, including those of a pending review: fix what is asked in one push, then reply in the thread, and once settled reply `Resolved: <reason>`: the watcher resolves the thread. Reply with the helper, never REST's `pulls/<n>/comments/<id>/replies` (refused with 403 rate-limit errors in bursts while quota was left, #297): `bun --env-file=.claude/watcher.env "${CLAUDE_PLUGIN_ROOT}/src/reply-review-thread.ts" <pr> <comment-id|PRRT_id> '<body>'` (a body of `-` comes from stdin). It replies through GraphQL and waits out a rate limit once. Never resolve a thread yourself. A comment that needs the owner's decision stays open. Don't answer anyone else (a maintainer, a bot, a passer-by): tell the owner and leave the reply to them, or the agent becomes a proxy speaking for the owner. |
| `DEPLOYED` | Check the deployed app as the repository's notes say. |
| `DEPLOY_FAILED` | Fix it in a follow-up pull request. A deploy a newer merge cancelled isn't a failure: the watcher follows the newer run. |
| `MAIN_FAILED` / `MAIN_SLOW` | The default branch is broken or hanging, whichever pull request caused it. That comes first. |
| `MAIN_PASSED` | The newest run on the default branch passed; read the open pull requests that come with it. |
| `MAIN_ADVANCED` | The default branch got a new commit. If it was your own pull request, open the next one now; otherwise check whether it touches your work. |
| `NEW_ISSUE` / `ISSUE_COMMENT` | Read it, take the work in turn, answer the owner's comment. |
| `ISSUE_CLOSED` / `ISSUE_REOPENED` | Drop or resume any work on it. An issue deleted or transferred to another repository comes as closed, `(deleted or transferred)`. |
| `CLOSED` | Closed without merging: stop working on it. |
| `LOOKUPS_FAILING` | No `gh` call has succeeded for minutes, with the latest failure (a timeout, an exit code): the watcher can't see anything, so its silence means nothing. Comes on every look while it lasts. Check `gh` (logged in, its token, a slow `GH` wrapper) and tell the owner. |
| `LOOKUPS_RECOVERED` | Calls succeed again; the events held back come next. |
| `WATCHER_ERROR` | A look failed (for example a state file another program held locked); the watcher carries on with the next look. Repeated, it needs a look: tell the owner. |
| `WATCHER_OUTDATED` | The watcher's checkout moved to other watcher code after it started (a pull, or a restart that raced another one's pull), so it exits: start it again right away, alone, so its pull finishes before it starts. |
| `REMINDER` | Comes after every notification while a PR waits on you: its branch is behind main or in conflict (rebase it, run the checks, push once), or it is approved with CI green and auto-merge off (enable it, after reading its comments) or with CI failed (fix it). None comes for a PR in the merge queue: there, `DEQUEUED` says when it needs you. It repeats until that is done. |

## Before enabling auto-merge

- **Read the pull request for unanswered comments first, as its own step**, never chained into the
  merge command: an approval and a comment often arrive together.
- Only with the owner's approval, and once the review's findings are fixed.
