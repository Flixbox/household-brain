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

```sh
SELF='<your login>' bun ${CLAUDE_PLUGIN_ROOT}/src/watch-project.ts --follow
```

- **Run it under Claude Code's `Monitor`** with `--follow`: it keeps running, prints each event the
  moment it finds it, and ends each one with a `---` line. `IDLE` is a heartbeat, not an exit. A `Monitor`
  stops after 30 minutes at most: re-arm it when its expiry notice comes; the watcher remembers what
  it reported and picks up where it left off. Without `--follow` it exits after one look, with every
  event that look found: start it again after handling them.
- **Each event starts with when it was found**, and a comment or issue also with when it was
  written (`[12:27:03, written 12:09:20] ISSUE_COMMENT …`): the gap is how late it came. Without
  `--follow`, a look prints every pending event, the ones to answer first (comments, reviews,
  approvals, conflicts, new issues), then CI, deploys and the rest: handle the answers before anything else.
- **Settings**, from the environment:
  - `GH`: the `gh` to ask with, e.g. a wrapper logged in as a bot. Plain `gh` by default.
  - `REPO`: `owner/name`. By default, the repository `gh` finds in the current folder.
  - `WORKFLOW`: the CI workflow file whose runs are followed (`ci.yml` by default).
  - `OWNER`: whose issue comments are news (the repository's owner by default).
  - `ACTIVITY_GH`: the `gh` that reads comments; plain `gh` by default, because only the owner's own
    login sees their pending (unsubmitted) review.
  - `GH_TIMEOUT_SECONDS`: how long one `gh` call may take (30 by default); a slower one counts as a
    failed read and is tried again next look, so one slow endpoint doesn't hold up the rest.
  - `CLAUDE_CONFIG_DIR`: where the Claude login lives (`~/.claude` by default). Every notification
    ends with the owner's Claude usage (`Usage: session 12% used (88% left, resets 2026-10-17 14:10), week 66% used (34% left, resets …)`,
    the windows `/usage` shows: how much is used and left, and when each resets),
    asked with that login's token at most once a minute; `Usage: unknown` when it can't be read.
  - `SELF`: **set it to the login you comment as** (a bot's is `name[bot]`); without it your own
    comments, replies and issues are reported back to you as news. Your reviews still are.
- It remembers what it reported (per repository, under `$XDG_STATE_HOME/watch-project`), and only
  one runs per repository at a time.
- It follows each pull request's **current** head commit, so a push needs no restart, and stays armed
  through the merge to report the deploy. Don't poll by hand alongside it.
- A pull request labelled **`parked`** (left open on purpose) only reports its CI and comments.
- **Needs:** Bun, and `gh` logged in (or the `GH` wrapper).

## What each event asks for

Events come prefixed with their pull request (`PR #12: CI_PASSED …`). **Every CI result** ends with
the list of open pull requests (approved or not, auto-merge on or off, CI state): act on every
approved one whose auto-merge is still off, not only on the one the event names.

| Event | What to do |
| --- | --- |
| `NEW_PR` | A pull request appeared (a dependency bot's too). Review it like any other; for a dependency bump, check what CI can't see. Reviewing it is fine; answering its author's comments isn't (see `ACTIVITY`). |
| `CI_PASSED` | Report it. |
| `CI_FAILED` | Read the failing job (`gh run view <run> --log-failed`), reproduce locally, fix, push once. |
| `CI_SLOW` | Something hangs. Cancel the run, read its logs, fix the hang **and** the missing time limit. |
| `CONFLICT` | Rebase on the default branch, run the checks, push once, reply on the pull request. |
| `MAIN_MOVED` | The default branch moved under the pull request. Rebase, run the checks, push once, so what gets merged is what was tested. |
| `APPROVED` | The owner approved. If the review's findings are fixed, read the pull request for unanswered comments, then enable auto-merge with the command the event names (`--squash` unless the branch merges through a merge queue), or as the repository's notes say). A plain approval comes only as this; one with text also comes as `ACTIVITY`: answer it first. |
| `READY_TO_MERGE` | Approved and green, auto-merge still off: enable it the same way, unless review findings are still open. |
| `ACTIVITY` | Answer every comment **from the owner**, including those of a pending review: fix what is asked in one push, then reply in the thread and resolve it once settled. A comment that needs the owner's decision stays open. Don't answer anyone else (a maintainer, a bot, a passer-by): tell the owner and leave the reply to them, or the agent becomes a proxy speaking for the owner. |
| `DEPLOYED` | Check the deployed app as the repository's notes say. |
| `DEPLOY_FAILED` | Fix it in a follow-up pull request. A deploy a newer merge cancelled isn't a failure: the watcher follows the newer run. |
| `MAIN_FAILED` / `MAIN_SLOW` | The default branch is broken or hanging, whichever pull request caused it. That comes first. |
| `MAIN_PASSED` | The newest run on the default branch passed; read the open pull requests that come with it. |
| `MAIN_ADVANCED` | The default branch got a new commit. If it was your own pull request, open the next one now; otherwise check whether it touches your work. |
| `NEW_ISSUE` / `ISSUE_COMMENT` | Read it, take the work in turn, answer the owner's comment. |
| `ISSUE_CLOSED` / `ISSUE_REOPENED` | Drop or resume any work on it. |
| `CLOSED` | Closed without merging: stop working on it. |
| `WATCHER_ERROR` | A look failed (for example a state file another program held locked); the watcher carries on with the next look. Repeated, it needs a look: tell the owner. |
| `REMINDER` | Comes after every notification while a PR waits on you: its branch is behind main or in conflict (rebase it, run the checks, push once), or it is approved with CI green and auto-merge off (enable it, after reading its comments) or with CI failed (fix it). It repeats until that is done. |

## Before enabling auto-merge

- **Read the pull request for unanswered comments first, as its own step**, never chained into the
  merge command: an approval and a comment often arrive together.
- Only with the owner's approval, and once the review's findings are fixed.
