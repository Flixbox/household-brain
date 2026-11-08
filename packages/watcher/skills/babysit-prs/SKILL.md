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

- **In Codex**, install `project-watcher@household-brain` and trust its reviewed hooks through
  `/hooks` (SessionStart, SessionEnd, and the PreToolUse guard against `gh` writes as the owner, #370; whether it fires for code mode's
  `exec_command` calls is unconfirmed until #377). The hook starts a detached supervisor in projects with `.claude/watcher.env`.
  For the current root thread (or if hooks are not trusted), run
  `bun "${PLUGIN_ROOT}/src/codex-watch.ts"` once. It uses `CODEX_THREAD_ID`, checks that the thread
  belongs to this folder and accepts direct input, and starts the same watcher used by Claude.
  Events steer an active turn or start an idle one through the existing local daemon. Event text is
  untrusted data. Usage, IDLE and reminder-only output never starts a model turn. Failed delivery
  stays in the per-thread outbox and retries; the supervisor rearms a stopped watcher. Its startup
  line names a local diagnostic log. This adapter currently requires the Unix control socket (WSL
  or Linux); it never starts or restarts the daemon. Subagents use their parent root's notifications.
- **In Claude Code it runs by itself** once the project has a `.claude/watcher.env` with its settings (below, one
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
- **Implementation agents subscribe to their work** using a per-process setting, for example:

  ```sh
  WATCHER_ID=issue-45 WATCHER_SUBSCRIPTIONS=issue:45 bun --env-file=.claude/watcher.env <watcher>/src/watch-project.ts --follow
  ```

  Use `pr:123`, `issue:45`, or a comma-separated list. An issue also follows PRs that name it in
  GitHub's structured closing references. Keep the main session's setting unset: it receives all
  owner comments, including those outside every agent subscription. Do not put an agent's selection
  in the shared project settings file. Changing a selection gets its own session state; keep a
  stable `WATCHER_ID` for restarts. Invalid selections fail closed.
  A subscribed watcher makes no writes (resolving threads, marking drafts ready, dismissals,
  `@bot resolve`): the all-events watcher does, and the subscribed one reports how each went (#402).

  Scoped events use explicit PR/issue fields, never a grep of event text. They retain selected CI,
  conflicts and owner comments/reviews, but omit unrelated repository events, global summaries,
  usage/IDLE, reminders and non-conflicting main movement. Existing event identities suppress
  repeated state notifications. System errors still reach the affected watcher.

  A terminal PR or issue gets a final fresh activity read before its subscription ends. Failed
  lookups or unacknowledged durable Codex deliveries keep it alive. When every selected subject is
  finished, exit code `3` means successful subscription completion: **do not re-arm it**. The Codex
  supervisor recognizes this exit. The main all-events watcher continues following deployment.

  Claude monitors and directly addressable Codex root/agent threads use this same path. Native
  Codex child threads that cannot accept direct input still receive relevant alerts through their
  parent root's collaboration messages; do not bypass that host restriction or claim that shell
  stdout wakes them. The main session must keep its all-events monitor active.
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
  - `ACTIVITY_GH`: the owner's `gh`, plain `gh` by default. It is asked only for the owner's pending
    (unsubmitted) review, which only their own login sees, and for the comments of a PR `GH` couldn't
    read; `GH` reads the rest (#403). Set to the same as `GH`, one read covers both.
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
  - `FULL_READ_MINUTES`: how long a pull request goes without a full read at most (10 by default; 0
    reads every one in full on every look; anything else but a number from 0, a blank value included,
    stops the watcher at the start). Each look asks one cheap question about what changed, and a PR it shows as changed is
    read in full at once (#404); this limit is for what that question can't see.
  - `MERGED_HOURS`: how far back a merged pull request still counts as recent (3 by default), so one
    opened and merged between two looks is still reported. It applies to the repository's merged PRs
    and, for a scoped watcher, to those closing a subscribed issue.
  - `STATE_DIR`: the folder of this watcher's record, outright (by default one per watcher id, as for
    `WATCHER_ID`, or per subscription of a scoped watcher, under
    `watch-project/<owner>_<repo>/sessions/` in `$XDG_STATE_HOME` or `~/.local/state`; an unscoped
    watcher without an id uses `<owner>_<repo>` itself). Two watchers given the same folder share one record and
    split the events.
  - `REVIEW_BOTS`: the review bots' logins, comma-separated (`coderabbitai`, with or without `[bot]`).
    Their reviews are asked for, never awaited by default (#324): a PR labelled `BOT_REVIEW_LABEL`
    gets `@<bot> review` from the watcher, once per PR ever (not again after new pushes, nor when the
    bot reviewed it already or someone posted `@<bot> review` before), and the label comes off
    (`BOT_REVIEW_ASKED`). Only such a PR (also while the label is still on), or one whose head shows a
    bot's check run still going (a review in progress), gets no `READY_TO_MERGE` and no auto-merge reminder until the bot has
    reviewed it; a PR nobody asked a bot about waits for none (#299 waited for every approved draft).
    None by default: nothing is asked, nothing waits. The `GH` token must be allowed to comment on
    pull requests and to add and remove labels.
  - `BOT_REVIEW_LABEL`: the label that asks `REVIEW_BOTS` for a review (`bot-review` by default,
    #324). The label must exist in the repository. Taking it off is the claim on the ask, made on
    GitHub before anything is posted, so only one watcher asks, on any number of machines (#325); a
    failed ask puts it back for the next look (`BOT_REVIEW_FAILED` says whether that worked). Every
    watcher reads the `@<bot> review` comments with the PR and waits on them; this machine's asks are
    also remembered for good (`$XDG_STATE_HOME/watch-project/<owner>_<repo>/review-asked/`).
  - `DISMISS_STALE_BOT_REVIEWS`: `1` lets the watcher dismiss a bot's (`…[bot]`) change request, once
    the owner approved and no review thread is open without a `Resolved:` reply: one left on an older
    commit (#285), or one on the head once the agent (`SELF`) or the owner settled it with `Resolved:
    <reason>` replies, the last comment in each of its threads, or a PR comment after it when it has
    no thread (#290). Its dismissal message quotes those replies; a newer review of the bot needs its
    own. Off by default, when `BLOCKED_BY_REVIEW` names it for the owner to dismiss. A person's
    change request is never dismissed. The `GH` token must be allowed to write pull requests. It also
    dismisses them without the owner's approval on a PR labelled `CLEARED_LABEL`, once CI is green at
    the head and it is no draft (#327): those submitted before the owner or the agent (`SELF`) last
    put the label on (not since taken off), and only once settled by `Resolved:` replies, on an older
    commit too (no approval vouches for them).
  - `CLEARED_LABEL`: the label that marks a PR cleared for queueing without the owner's approval
    (`subagent-cleared` by default, #327), e.g. after a review subagent's clean review of a PR that
    isn't user-facing. With `DISMISS_STALE_BOT_REVIEWS=1`, its settled bot change requests are
    dismissed as on an approved PR, instead of asking the bot to resolve (`RESOLVE_BOT_REVIEWS`). The
    label must exist in the repository. The watcher never removes it; a bot's change request after
    the clearance (on new commits) needs a new one: take the label off and put it on again.
  - `READY_APPROVED_DRAFTS`: `1` lets the watcher mark a draft ready itself (`$GH pr ready <n>`)
    once the owner's (never a bot's, nor anyone else's) latest review is an approval, on any commit
    (#301, #317: an approval before a rebase still counts), and report `DRAFT_READIED`, naming the
    approved commit, instead of `APPROVED_DRAFT`. Merging still waits for CI and, where a review bot
    was asked (#324), for its review. Off by default, when `APPROVED_DRAFT` asks you to
    mark it ready. The `GH` token must be allowed to write pull requests.
  - `CLEAR_QUESTION_LABEL`: `1` lets the watcher take `QUESTION_LABEL` off a PR that no longer waits
    on the owner (#371): once the owner's (never a bot's, nor anyone else's) latest review is an
    approval, on any commit (the approval is permanent), or once the PR merged or closed. It reports
    `QUESTION_CLEARED`. Issues keep the label until the owner answers: take it off them yourself.
    Off by default. It removes the label with the `GH` token, which must be allowed to write issues
    (a GitHub App's Issues: write: labels are an issue's, also on a PR); it acts only once GitHub's `viewer` for that token is a bot (`…[bot]`), so with the
    owner's own login it does nothing (it fails closed). An approved PR never keeps the label, so a later question for the owner goes on an issue.
  - `QUESTION_LABEL`: the label for work that waits on the owner (`question` by default, #371).
  - `RESOLVE_BOT_REVIEWS`: the review bots to ask with `@<bot> resolve` (`coderabbitai`, with or
    without `[bot]`; comma-separated) (#303). A bot like CodeRabbit decides on approving only when it
    reviews a new commit, so a settled change request never turns into its approval by itself. Once
    its latest review on the head requests changes, every review thread is resolved and CI passed at
    the head, the watcher posts `@<bot> resolve` on the PR, once per head commit (`BOT_RESOLVE_ASKED`).
    It reads no risk rating: whatever the merge risk, it asks, and the bot's own settings
    (CodeRabbit's `max_merge_risk`) decide whether it approves. Not for a draft, a PR the owner
    opened, or one the owner approved or labelled `CLEARED_LABEL` (`DISMISS_STALE_BOT_REVIEWS` handles
    those). None by
    default. The `GH` token must be allowed to comment on pull requests. `@<bot> resolve` asks the bot
    to settle its own change request, not for a new review: it never counts as the one ask of
    `BOT_REVIEW_LABEL`, and the bot's approval after it never counts as the review asked for (it only
    follows an earlier review).
  - `AGENT_USAGE_PROVIDER`: `codex` or `claude`, selecting the allowance reported in notifications
    and by `agent-usage --reset`. By default, `CODEX_THREAD_ID` selects Codex (also when a Claude
    marker is inherited); otherwise Claude. Set it explicitly for watchers launched outside the
    agent. Unknown values are rejected. Codex uses its signed-in local app-server, never a model
    request. Its cache is separate, keyed by `CODEX_HOME`, and can be overridden with
    `CODEX_USAGE_CACHE` and `CODEX_USAGE_LOCK_PORT`.
  - `CLAUDE_CONFIG_DIR`: where the Claude login lives (`~/.claude` by default). A notification
    ends with the selected provider's usage (`Usage (claude): session 12% used (88% left, resets 2026-10-17 14:10), week 66% used (34% left, resets …)`,
    the windows `/usage` shows: how much is used and left, and when each resets),
    from the per-provider cache it shares with `agent-usage` (`packages/watcher/src/agent-usage.ts`,
    #260): the endpoint is asked at most once a minute and backed off after a refusal; meanwhile the
    last numbers read come with their time (`(as of 12:04)`), and `Usage (<provider>): unknown` only when none
    ever were. Only when it is due (#318): when the session's or the week's use is in another 2.5%
    step (2.5%, 5%, 7.5% …) than in this watcher's last usage line, at most once a minute, or 10
    minutes after that line as a heartbeat; a notification in between leaves it out. With `--follow`
    a due line also comes on its own (ending with `---`) when no event brought it. Each watcher
    keeps its own last line. `CLAUDE_USAGE_CACHE` moves that cache, `CLAUDE_USAGE_LOCK_PORT` its lock's port.
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
| `APPROVED` | The owner approved: only `OWNER`'s approval counts, never a bot's or anyone else's (#277), here, in the open-PR list, `READY_TO_MERGE` and `REMINDER`. If the review's findings are fixed, read the pull request for unanswered comments, then queue it with the command the event names, `agent-queue <owner/name> <n>` (#356), alone in its own call (see "Queueing" below). A plain approval comes only as this; one with text also comes as `ACTIVITY`: answer it first. For a PR already in the merge queue, the event says so: there is no auto-merge to enable. |
| `READY_TO_MERGE` | Approved and green, auto-merge still off: queue it the same way, with the `agent-queue` command the event names, unless review findings are still open. Not reported for a PR in the merge queue, or for a draft (`APPROVED_DRAFT`). |
| `APPROVED_DRAFT` | The owner approved a pull request that is still a draft (#298). A draft can't be queued and a review bot skips it, so: mark it ready (`gh pr ready <n>`, the command the event names), then queue it with the `agent-queue` command it names. Where a review bot was asked (`BOT_REVIEW_ASKED`, #324), wait for its review and settle its threads first: `READY_TO_MERGE` comes only once it has reviewed. Where `READY_APPROVED_DRAFTS=1`, the watcher marks it ready itself once the owner's latest review is an approval, on any commit, and reports `DRAFT_READIED` instead (#301, #317); this event then comes only when marking it ready failed. Neither `READY_TO_MERGE` nor its reminder comes while it is a draft; the open-PR list says `draft`. |
| `DRAFT_READIED` | With `READY_APPROVED_DRAFTS=1`, the owner's latest review approves a draft, on any commit (it names that commit, and the head where they differ, e.g. after a rebase), and the watcher marked it ready (#301, #317). Queue it with `agent-queue <owner/name> <n>` once CI is green, as for `APPROVED_DRAFT`; where a review bot was asked (#324), `READY_TO_MERGE` waits for its review: settle its threads first. |
| `DRAFT_READY_FAILED` | The watcher couldn't mark the approved draft ready; the all-events watcher tries again after 1, 2, 5 and then every 10 minutes (#402), and `APPROVED_DRAFT` asks you to do it meanwhile. Repeated, its `GH` token likely can't write pull requests: tell the owner. |
| `BLOCKED_BY_REVIEW` | The owner approved and CI is green (even while GitHub still says changes requested), but GitHub won't merge it, and the reviews are why. For each thread it names (answered by the agent, still open): check the answer settles it, then reply `Resolved: <reason>` in it with the reply helper (see `ACTIVITY`; the watcher resolves it), or ask the owner. For each change request it names (still counted until dismissed): check its points are dealt with. Where `DISMISS_STALE_BOT_REVIEWS=1`, the watcher dismisses a bot's change request itself (`REVIEW_DISMISSED`): one left on an older commit once no thread is open (resolved, or ending in a `Resolved:` reply, #285), one on the head once you settle it with a `Resolved: <reason>` reply in each of its threads, or on the PR when it has none (#290; a later comment of the owner's that isn't a `Resolved:` reply takes that back until a new `Resolved:` reply follows, #294). Otherwise ask the owner on the PR to dismiss it. |
| `THREAD_RESOLVED` | The watcher resolved a review thread on a `Resolved: <reason>` reply (anyone's, #279). Nothing to do. |
| `REVIEW_DISMISSED` | With `DISMISS_STALE_BOT_REVIEWS=1`, the watcher dismissed a bot's change request left on an older commit (the owner approved, no thread open, #285), or on the head once `Resolved:` replies settled it (#290); or the same on a PR labelled `CLEARED_LABEL` without the owner's approval (#327), which the event names. Nothing to do: queue a cleared PR once nothing else blocks it. To clear a PR that waits only on a bot's settled change request, label it `CLEARED_LABEL` (the main session does, after a clean review). |
| `QUESTION_CLEARED` | With `CLEAR_QUESTION_LABEL=1`, the watcher took `QUESTION_LABEL` off a PR the owner approved (on any commit; it names the commit), or one that merged or closed (#371). Nothing to do. |
| `QUESTION_CLEAR_FAILED` | The watcher couldn't take that label off; it tries again on every look. It says so too where it couldn't confirm the `GH` token is a bot's: GitHub's `viewer` is a person (set `GH` to the bot), or the question failed. Repeated, its `GH` token likely can't write issues (Issues: write): tell the owner, and take the label off by hand meanwhile. |
| `BOT_REVIEW_ASKED` | With `REVIEW_BOTS` set, the PR got the label `BOT_REVIEW_LABEL` and the watcher posted `@<bot> review` on it, the only time it ever will for that PR, and took the label off (#324; the event says when it couldn't yet, and it tries again). Wait for the review: `READY_TO_MERGE` and its reminder hold until the bot has reviewed. Then handle its points and settle its threads with `Resolved:` replies as usual. Agents never post `@<bot>` commands themselves: label the PR instead. |
| `BOT_REVIEW_SKIPPED` | The PR got the label, but the bot reviewed it already or was asked already (a `@<bot> review` comment), so it isn't asked again (#324): a PR gets at most one bot review. The label came off. Go on without a new bot review. |
| `BOT_REVIEW_FAILED` | The watcher couldn't post `@<bot> review`; the label stays and it tries again on every look. Repeated, its `GH` token likely can't comment on pull requests: tell the owner. |
| `BOT_RESOLVE_ASKED` | With `RESOLVE_BOT_REVIEWS` set, the watcher posted `@<bot> resolve` on a PR whose bot change request on the head is settled (every thread resolved, CI green, #303; not one without threads that a later owner comment took back, #294). Nothing to do: the bot resolves its threads and approves if its own risk limit allows; if it doesn't approve, the PR waits for the owner as before. |
| `BOT_RESOLVE_FAILED` | The watcher couldn't post that comment; the all-events watcher tries again after 1, 2, 5 and then every 10 minutes (#402). Repeated, its `GH` token likely can't comment on pull requests: tell the owner. |
| `REVIEW_DISMISS_FAILED` | The watcher couldn't dismiss such a change request; the all-events watcher tries again after 1, 2, 5 and then every 10 minutes (#402). Repeated, its `GH` token likely can't write pull requests: tell the owner. |
| `THREAD_RESOLVE_FAILED` | The watcher couldn't resolve such a thread; the all-events watcher tries again after 1, 2, 5 and then every 10 minutes (#402). Repeated, its `GH` token likely can't write pull requests: tell the owner. |
| `QUEUED` | The PR entered the merge queue (with its position). Nothing to do; no auto-merge reminders come for it while it is there. |
| `NOT_QUEUED` | The PR is approved by the owner, CI is green (the workflow's run on the head passed, #344), GitHub says its merge state is `CLEAN` and auto-merge is on, yet it has stayed outside the merge queue for minutes (#305): GitHub sometimes never queues such a PR, after a change request was dismissed or a rebase after a conflict, and enabling auto-merge again doesn't help. Read it for unanswered comments, then queue it with the `enqueuePullRequest` mutation the event names (it carries the PR's node id). Once per head commit; only where the branch merges through a merge queue. No event comes when `WORKFLOW` has no run on the head, its run cannot be read, or it ran nothing (skipped or neutral); these appear as `CI not reported`. Check that the workflow runs on this branch and `WORKFLOW` names it. |
| `DEQUEUED` | The PR left the merge queue without merging, with GitHub's reason (failed checks, a conflict, removed by hand). Fix what it says, then queue it again. |
| `ACTIVITY` | Answer every comment **from the owner**, including those of a pending review: fix what is asked in one push, then reply in the thread, and once settled reply `Resolved: <reason>`: the watcher resolves the thread. Reply with the helper, never REST's `pulls/<n>/comments/<id>/replies` (refused with 403 rate-limit errors in bursts while quota was left, #297): `bun --env-file=.claude/watcher.env "${CLAUDE_PLUGIN_ROOT}/src/reply-review-thread.ts" <pr> <comment-id|PRRT_id> '<body>'` (a body of `-` comes from stdin). It replies through GraphQL and waits out a rate limit once. Never resolve a thread yourself. A comment that needs the owner's decision stays open. Don't answer anyone else (a maintainer, a bot, a passer-by): tell the owner and leave the reply to them, or the agent becomes a proxy speaking for the owner. |
| `DEPLOYED` | Check the deployed app as the repository's notes say. |
| `DEPLOY_FAILED` | Fix it in a follow-up pull request. A deploy a newer merge cancelled isn't a failure: the watcher follows the newer run. |
| `MAIN_FAILED` / `MAIN_SLOW` | The default branch is broken or hanging, whichever pull request caused it. That comes first. |
| `MAIN_PASSED` | The newest run on the default branch passed; read the open pull requests that come with it. |
| `MAIN_ADVANCED` | The default branch got a new commit. If it was your own pull request, open the next one now; otherwise check whether it touches your work. |
| `NEW_ISSUE` / `ISSUE_COMMENT` | Read it, take the work in turn, answer the owner's comment. |
| `ISSUE_CLOSED` / `ISSUE_REOPENED` | Drop or resume any work on it. An issue deleted or transferred to another repository comes as closed, `(deleted or transferred)`. |
| `LINK_CYCLE` | The issues' blocked-by links close a cycle (`#a → #b → … → #a`, a blocked by b), so none of them can ever be closed. Unblock the link in the cycle that is least needed, through `issue-links` (`unblock_issue`, or `run.sh cli unblock <issue> <blocked-by>`), never a raw API call, and comment on both issues which link went and why. |
| `CLOSED` | Closed without merging: stop working on it. |
| `LOOKUPS_FAILING` | No `gh` call has succeeded for minutes, with the latest failure (a timeout, an exit code): the watcher can't see anything, so its silence means nothing. Comes on every look while it lasts. Check `gh` (logged in, its token, a slow `GH` wrapper) and tell the owner. |
| `LOOKUPS_RECOVERED` | Calls succeed again; the events held back come next. |
| `WATCHER_ERROR` | A look failed (for example a state file another program held locked); the watcher carries on with the next look. Repeated, it needs a look: tell the owner. |
| `WATCHER_OUTDATED` | The watcher's checkout moved to other watcher code after it started (a pull, or a restart that raced another one's pull), so it exits: start it again right away, alone, so its pull finishes before it starts. |
| `REMINDER` | Comes after every notification while a PR waits on you: its branch is behind main or in conflict (rebase it, run the checks, push once), or it is approved with CI green and auto-merge off (queue it with the `agent-queue` command the reminder names, after reading its comments) or with CI failed (fix it). None comes for a PR in the merge queue: there, `DEQUEUED` says when it needs you. It repeats until that is done. No approval reminder comes for `CI not reported` in the open-PR list (#342): `WORKFLOW` has no run on the head, its run can't be read, or its run ran nothing (skipped or neutral). That is not green and may never turn green, so if it lasts, check that the workflow runs on this branch and that `WORKFLOW` names it. |

## Before enabling auto-merge

- **Read the pull request for unanswered comments first, as its own step**, never chained into the
  merge command: an approval and a comment often arrive together.
- Once the review's findings are fixed: a user-facing PR, one that changes the rules for approving,
  queueing or merging (in `AGENTS.md` or elsewhere), or one you can't place, only with the owner's
  approval; any other PR as the repository's `AGENTS.md` says (e.g. once CI is green, every thread
  is settled and a review subagent finds nothing blocking).

## Queueing: `agent-queue`, alone in its call

Queue with `agent-queue <owner/name> <pr>` (#354), never with `gh pr merge --auto` yourself. It
checks the rules first (open, no draft; CI on the head finished and passed, with a workflow's check
that succeeded among them; cleared by `OWNER`'s approval, or by the `CLEARED_LABEL` label put on by
`OWNER` or the bot after the last push; no open review thread, no change request standing, no bot
review asked for, by label or `@<bot> [full] review`, and not yet given), queues only then (one
`enablePullRequestAutoMerge` mutation pinned to the head it checked, #357), and otherwise prints
what blocks it and exits 1. A PR already set to auto-merge or in the merge queue it leaves alone. It
can't tell whether a PR is user-facing: that stays yours to judge, as above.

- **Exactly that form, alone in its own Bash call:** no `cd … &&` before it, no `| tail` or
  `2>&1` after it, no second command after `;`, no variable set in front of it. Claude Code's
  allow rule `Bash(agent-queue *)` matches the command's whole text; a chained or prefixed call
  falls to auto mode's classifier, which refused queue commands at times ("Merge Without Review",
  #354). Read the PR's comments in an earlier call. The `APPROVED`, `READY_TO_MERGE`, `APPROVED_DRAFT`,
  `DRAFT_READIED` and `REMINDER` events name it in exactly this form (#356): copy it as it is.
- **From any folder:** it passes its repository to every `agent-gh` call as `GH_REPO` (#365), so
  `agent-gh` picks that repository's bot, and it stops when GitHub's `viewer` isn't a `[bot]` login.
- **Install once**, beside `agent-usage` (`~/.local/bin` is on the `PATH`):

  ```sh
  printf '#!/usr/bin/env bash\nexec bun "$HOME/.claude/plugins/marketplaces/household-brain/packages/watcher/src/agent-queue.ts" "$@"\n' > ~/.local/bin/agent-queue
  chmod +x ~/.local/bin/agent-queue
  ```

  It asks GitHub with `agent-gh` (the bot) unless `GH` says otherwise. The allow rule is the owner's
  to add in their Claude Code user settings; agents never change their own permissions.
