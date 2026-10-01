# Agent notes for household-brain

The README is the spec and the source of truth for architecture, toolchain and code rules. This file
holds what agents working in this repo have learned the hard way. Add to it when something bites.

## Working as the bot

The agent pushes, opens and updates pull requests, comments, and reads CI as **`flixbox-ai-agent[bot]`**
(the private GitHub App "Flixbox [AI Agent]", installed only on this repository). It never does
that work with the owner's account.

- **Tokens:** `agent-gh-token` (in `~/.local/bin`) signs a JWT with the app's private key
  (`~/.config/household-brain-agent/app.pem`, App ID in `app-id` next to it) and prints a 1-hour
  installation token, cached for 50 minutes. `agent-gh` is `gh` with that token. The key is never
  committed, pasted or sent anywhere except GitHub's token endpoint.
- **Each worktree**, once after creating it:

  ```sh
  git config user.name 'flixbox-ai-agent[bot]'
  git config user.email '336689584+flixbox-ai-agent[bot]@users.noreply.github.com'
  git config credential.https://github.com.helper ''
  git config --add credential.https://github.com.helper \
    '!f() { test "$1" = get || exit 0; echo username=x-access-token; echo "password=$(agent-gh-token)"; }; f'
  ```

- **Pull requests and comments:** `agent-gh pr create …`, `agent-gh pr comment …`.
- **Babysitter:** `GH=agent-gh /tmp/babysit-pr.sh <number>`. It still reads comments with the owner's
  login, because only the owner's account can see the owner's pending (unsubmitted) reviews.
- **What the bot can't do**, on purpose: change repository settings or rulesets, merge past checks,
  or approve. Settings changes the owner asks for are made with the owner's `gh` login. Merging is
  the owner's auto-merge.
- **Revoking or rotating:** suspend or uninstall the app in GitHub's settings; for a new key,
  generate one on the app's page, replace `app.pem`, and delete the old key on GitHub.

## Babysitting a pull request

You own a pull request from the moment you open it until it is merged and deployed. "Pushed" is not
"done". These steps keep it moving without anyone having to ask what is going on.

**One pull request at a time.** Open the next one only after the previous one is merged and its
deploy is green. Never stack pull requests or work on two in parallel: the owner merges with squash,
which rewrites the history a stacked branch is built on, and every open PR is one more thing for
the owner to track.

**Run long things in the background and keep working.** Test suites, builds, installs, CI and PR
watchers, reviewer agents: start them in the background (their exit is the notification) and do the
next useful thing meanwhile, such as reading review findings, updating the PR description or the
docs. Only wait in the foreground for something whose result you need for the very next step.

### 1. Before you push

- **Run what CI runs, locally, once**: `pnpm lint && pnpm typecheck && pnpm test`, and for anything
  touching the app, rules or e2e setup, `pnpm test:emulated` (needs Java 21). A local run takes about
  30 seconds; a CI round trip takes minutes.
- **Batch your changes.** Every push cancels the running CI for that branch, so five quick pushes mean
  five cancelled runs and no result.
- **Check exit codes without pipes**, or with `${PIPESTATUS[0]}`. See the shell lesson below.

### 2. After every push

1. **Update the PR description** so it describes what the branch does now.
2. **Keep the babysitter running in the background**, and let its exit wake you:

   ```sh
   cp scripts/babysit-pr.sh /tmp/babysit-pr.sh && /tmp/babysit-pr.sh <number>
   ```

   - It follows the PR's **current** head commit, so a push needs no new babysitter.
   - It remembers what it already reported, so after handling an event you simply start it again and
     it continues with the next one.
   - It runs from a copy, because bash reads a script while running it.
   - It stays armed through the merge and reports the deploy. Don't poll by hand alongside it.

### 3. When the babysitter reports

| Event | What to do |
| --- | --- |
| `CI_PASSED` | Report it; the owner merges with auto-merge. Start the babysitter again. |
| `CI_FAILED` | Read the failing job (`agent-gh run view <run> --log-failed`), reproduce locally, fix, push once. |
| `CI_SLOW` | More than 20 minutes: something hangs. Cancel the run (`gh run cancel <run>`: the bot can only read Actions, so this uses the owner's login), read the logs (`agent-gh api repos/Flixbox/household-brain/actions/jobs/<job-id>/logs`), fix the hang **and** the missing time limit. A flaky download can just be re-run (`gh run rerun <run> --failed`, owner's login again). |
| `CONFLICT` | Rebase on `main`, run the checks, push once, reply on the PR. |
| `ACTIVITY` | Answer every comment (section 4), including those of a pending review. |
| `DEPLOYED` | Wait one minute, then check the live app in the browser (section 5). Report, and only now start the next PR. |
| `DEPLOY_FAILED` | Fix it in a follow-up PR (never push to `main`). |
| `MAIN_FAILED` / `MAIN_SLOW` | `main` is broken or hanging, whichever PR caused it. That comes first: fix it in a follow-up PR, or re-run a flaky job, before continuing. |

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
- After the merge, the same babysitter follows the `main` run through `deploy` and reports
  `DEPLOYED` or `DEPLOY_FAILED`.
- **If the deploy fails, open a follow-up pull request** with the fix. Never push to `main`
  directly; it only accepts PRs with green CI.
- **One minute after every deploy, check the live app in the browser** (Claude in Chrome), not just
  that the URL answers:
  1. Open `https://household-brain-sf.web.app` and **reload** it, so the new service worker and build
     are the ones running. If an "update available" prompt appears, take it.
  2. Check that the page renders, sign-in or the signed-in screen works, and the browser console
     shows no errors.
  3. Exercise what the PR changed, where that is safe on real data. Never create, change or delete
     real entries, or touch the real Google Calendar, just to test.
  4. Report what you saw. If it is broken, open a follow-up PR right away.

## Lessons learned

### CI and monitoring

- **Playwright's `webServer.command` must be the server itself** (`vite preview ...`), never a pnpm
  script or an `&&` chain. The wrappers swallowed the stop signal: all tests passed in seconds, then
  Playwright waited forever for the server to exit, and an orphaned `vite preview` kept port 4173.
- **Every job has a `timeout-minutes`, and Playwright has a `globalTimeout`.** The hang above sat
  silently for 1.5 hours in CI because nothing put a limit on it (GitHub's default is 6 hours).
- **CI test reporters must stream progress** (`list`), not only write a report at the end. With
  `github` + `html` alone, a hang produced no output at all after "Running 12 tests".
- **Watch a pipeline with a deadline**: `scripts/babysit-pr.sh` (see the babysitting guide above).
- **Each push to a PR branch cancels the running CI** (`concurrency` with `cancel-in-progress`).
  Batch fixes into one push, or no run ever finishes.
- **Pushing anything under `.github/workflows/` needs the `workflow` scope** on the GitHub token
  (`gh auth refresh -h github.com -s workflow`).

- **A commit triggers more than CI.** A merge to `main` also starts Dependabot runs, and the first run
  listed for a commit was a Dependabot one, so a watcher reported "success" before the deploy had
  even started. Always filter by workflow (`--workflow ci.yml`).
- **Right after a push, GitHub can still report the PR's previous head commit.** A watcher using
  `--pr` then watched the cancelled run of the old commit. Watch by the commit you just pushed.

- **Run the babysitter from a copy of the script**, e.g. in a scratch directory. Bash reads a script
  while running it, so editing or checking out `scripts/babysit-pr.sh` under a running one corrupts
  it.

- **Stacked PRs conflict after a squash merge.** PR 6 was built on PR 5's branch; squash-merging
  PR 5 rewrote that history and left PR 6 conflicting, unnoticed until the owner pointed it out. One
  PR at a time, and the babysitter reports conflicts.

- **The e2e job runs in Microsoft's Playwright image**, which already has the browsers and their system
  packages. Installing them per run took over 3 minutes and once hung for 15. The image version must
  equal `@playwright/test`: when Dependabot bumps the package, CI's first e2e step fails with a
  message, and `container.image` in `ci.yml` needs the matching tag and digest
  (`docker pull mcr.microsoft.com/playwright:vX.Y.Z-noble`, then `docker inspect` for the digest).

### Shell

- **Quote file paths that contain `$`.** TanStack route files are named like `items.$itemId.tsx`;
  unquoted in a shell command, `$itemId` expands to nothing and the file becomes `items..tsx`.
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
