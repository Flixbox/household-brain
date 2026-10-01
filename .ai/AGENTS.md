# Agent notes for household-brain

The README is the spec and the source of truth for architecture, toolchain and code rules. This file
holds what agents working in this repo have learned the hard way. Add to it when something bites.

## Babysitting a pull request

You own a pull request from the moment you open it until it is merged and deployed. "Pushed" is not
"done". These steps keep it moving without anyone having to ask what is going on.

### 1. Before you push

- **Run what CI runs, locally, once**: `pnpm lint && pnpm typecheck && pnpm test`, and for anything
  touching the app, rules or e2e setup, `pnpm test:emulated` (needs Java 21). A local run takes about
  30 seconds; a CI round trip takes minutes.
- **Batch your changes.** Every push cancels the running CI for that branch, so five quick pushes mean
  five cancelled runs and no result.
- **Check exit codes without pipes**, or with `${PIPESTATUS[0]}`. See the shell lesson below.

### 2. After every push

1. **Update the PR description** so it describes what the branch does now.
2. **Keep two watchers running in the background**, and let their exits wake you:

   ```sh
   scripts/watch-ci.sh --commit "$(git rev-parse HEAD)"   # CI result, alerts after 20 minutes
   scripts/watch-pr.sh <number>                           # comments, reviews, merge or close
   ```

   - Don't poll by hand alongside them, and don't start a second watcher for the same thing.
   - `watch-pr.sh` exits on the first new event. Handle it, then start it again. It stays armed
     until the PR is merged or closed, so comments are answered even while CI is long green.
3. **A newer push makes the old watcher's result meaningless.** It will report "cancelled". Start a
   new one for the new head commit.

### 3. When the watcher exits

| Exit | Meaning | What to do |
| --- | --- | --- |
| `0` | Green | Report it. If auto-merge is on, start watching the `main` run that the merge triggers (step 5). |
| `1` | Failed or cancelled | If cancelled by your own newer push, ignore it. Otherwise read the failing job's log (`gh run view <run> --log-failed`), reproduce locally, fix, and push once. |
| `2` | ALERT: more than 20 minutes | Something hangs; nothing here legitimately takes that long. Cancel the run (`gh run cancel <run>`), read the logs (`gh api repos/Flixbox/household-brain/actions/jobs/<job-id>/logs`), reproduce locally under `timeout`, then fix the hang **and** the missing time limit that let it run on. |

Normal durations, for comparison: `checks` about 1 minute, `e2e` about 3 minutes (most of it
installing browsers), `deploy` about 2 minutes.

### 4. Comments and review

- **Every comment gets an answer.** Fix what is asked, in one push, then reply in the thread saying
  what changed (`gh pr comment`, or a reply on the review comment). Resolve the thread once it is
  settled.
- If a comment needs the owner's decision, say so in the thread and leave it open.

- Every pull request gets one reviewer agent: read-only, reporting findings with severity and
  evidence. Fix blockers and should-fix items before merge, and say in the PR description what was
  addressed.
- Fix review findings **in one push**, then go back to step 2.

### 5. Merge and deploy

- The owner merges by enabling **auto-merge**. It merges by itself once both required checks are
  green. Owner-authored PRs can't be approved by the owner, so there is no approval step.
- After the merge, **watch the `main` run, including `deploy`**, with the same watcher:
  `scripts/watch-ci.sh --commit <merge-commit-sha>` (`gh pr view <n> --json mergeCommit`).
- **If the deploy fails, open a follow-up pull request** with the fix. Never push to `main`
  directly; it only accepts PRs with green CI.
- Finally, check the live site (`https://household-brain-sf.web.app`) responds, and report.

## Lessons learned

### CI and monitoring

- **Playwright's `webServer.command` must be the server itself** (`vite preview ...`), never a pnpm
  script or an `&&` chain. The wrappers swallowed the stop signal: all tests passed in seconds, then
  Playwright waited forever for the server to exit, and an orphaned `vite preview` kept port 4173.
- **Every job has a `timeout-minutes`, and Playwright has a `globalTimeout`.** The hang above sat
  silently for 1.5 hours in CI because nothing put a limit on it (GitHub's default is 6 hours).
- **CI test reporters must stream progress** (`list`), not only write a report at the end. With
  `github` + `html` alone, a hang produced no output at all after "Running 12 tests".
- **Watch a pipeline with a deadline**: `scripts/watch-ci.sh` (see the babysitting guide above).
- **Each push to a PR branch cancels the running CI** (`concurrency` with `cancel-in-progress`).
  Batch fixes into one push, or no run ever finishes.
- **Pushing anything under `.github/workflows/` needs the `workflow` scope** on the GitHub token
  (`gh auth refresh -h github.com -s workflow`).

- **A commit triggers more than CI.** A merge to `main` also starts Dependabot runs, and the first run
  listed for a commit was a Dependabot one, so a watcher reported "success" before the deploy had
  even started. Always filter by workflow (`--workflow ci.yml`).
- **Right after a push, GitHub can still report the PR's previous head commit.** A watcher using
  `--pr` then watched the cancelled run of the old commit. Watch by the commit you just pushed.

### Shell

- **A pipe hides the exit code.** `pnpm lint | tail` succeeds even when lint fails, and a commit
  chained after it with `&&` went through with a lint error. Check `${PIPESTATUS[0]}`, use
  `set -o pipefail`, or don't pipe a command whose exit code matters.

### Toolchain

- **oxlint loads `@stylistic/eslint-plugin` through `jsPlugins`.** There is no ESLint here.
  `.oxlintrc.json` is JSONC, so each disabled rule carries its reason as a comment.
- **npm-package-json-lint only auto-discovers `.js`/`.json` configs.** `pnpm lint` passes
  `-c npmpackagejsonlint.config.ts`. Node loads that file as an ES module, so `rules` must be a
  named export: a default export arrives wrapped as `{ default }` and reads as an empty config.
- **pnpm denies dependency install scripts.** Decide each package in `allowBuilds` in
  `pnpm-workspace.yaml`. `savePrefix: ''` keeps new dependencies exactly pinned.
- **The Firestore emulator needs Java 21** (`brew install openjdk@21`); Java 17 fails.

### App and build

- **Compare `import.meta.env.X` inline** when the branch must vanish from production builds. Passing
  `import.meta.env` through a helper function stops Vite from folding it, so the dead code ships.
- **Firebase Hosting matches header `source` against the request path, not the rewrite target.** A
  `no-cache` rule on `/index.html` does not cover `/` or SPA routes, so it needs `**`.
- **Watch the allowlist entry with `onSnapshot`, don't read it once.** A one-shot server read raced
  sign-out (stale "allowed") and locked the app out offline.

- **Never switch off "Enable create (sign-up)" in Firebase Authentication.** With sign-up off, nobody
  can sign in for the first time, the owner included (`auth/admin-restricted-operation`). The
  Firestore allowlist is the lock; anyone may create an account and still sees nothing.

### Repository and accounts

- **`main` only accepts merges from pull requests with green CI**, and force-push is blocked.
- **Pull requests opened with the owner's GitHub account can't be approved by the owner.** Merging
  is done by enabling auto-merge, never by a required review.
- **Commit as the repo-local identity** (`git config user.email`), never the machine-global work
  email. History was rewritten once to remove it.
