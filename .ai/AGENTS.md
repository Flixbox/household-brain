# Agent notes for household-brain

Rules for working here, and the lessons behind them. **The code explains itself**: what a module or
tool does is in its comments, kept true in the same pull request that changes it; don't restate it
here. **Decisions and their history live in the GitHub issues**, linked as `#n` below. The README
holds what a human does by hand. Add a rule here when something bites.

## Working as the bot

The agent works on GitHub only as **`flixbox-ai-agent[bot]`** (a GitHub App installed on this
repository), never with the owner's account.

- **`agent-gh`** is `gh` with the app's token; `agent-gh-token` (in `~/.local/bin`) prints one,
  signed with `~/.config/household-brain-agent/app.pem`. The key is never committed, pasted or sent
  anywhere but GitHub's token endpoint. To revoke: suspend or uninstall the app; to rotate: a new
  key on the app's page, replace `app.pem`, delete the old key.
- **Each new worktree**, once:

  ```sh
  git config user.name 'flixbox-ai-agent[bot]'
  git config user.email '336689584+flixbox-ai-agent[bot]@users.noreply.github.com'
  git config credential.https://github.com.helper ''
  git config --add credential.https://github.com.helper \
    '!f() { test "$1" = get || exit 0; echo username=x-access-token; echo "password=$(agent-gh-token)"; }; f'
  ```

- **Every pull request is assigned to the owner:** `agent-gh pr create --assignee Flixbox …`.
- **The bot can't**, on purpose: change settings or rulesets, merge past checks, approve, cancel or
  re-run CI. Those use the owner's `gh` login, when the owner asks.
- **Commit as the repo-local identity**, never the machine's global work email (history was rewritten
  once to remove it).

## How work flows

- **One pull request at a time.** Open the next one as soon as the previous one merges, so its CI
  and review run while `main` deploys. Never stack branches: the owner squash-merges, which breaks
  a branch built on another (it happened). A failed deploy's fix comes first.
- **One pull request per coherent change** (owner's rule): one feature, fix or refactor, whole. Side
  findings, refactors and tooling tweaks go into their own follow-up, never along for the ride. A
  coherent change is never split just to be smaller.
- **Low complexity** (owner's rule): the simplest thing that works; an out-of-the-box tool over a
  hand-built one, a dependency over in-house machinery. Unavoidable complexity goes into its own
  package, not across the app.
- **No docs-only pull requests**, unless the owner asks for one (#156): a docs or agent-note change
  rides along with the next real PR, and that PR's description says so.
- **Abstract only when it pays:** a shared helper only when it makes the code simpler or two places
  need the same logic.
- **Rules live in this file**, not in an agent's memory. A rule the owner states goes in here, in the
  next PR.
- **Nothing personal on GitHub: the repository is public.** No real amounts, balances, codes, card
  or phone numbers, providers tied to the owner or names, anywhere (issues, PRs, commits, code,
  tests). Use made-up examples. Edit history keeps a slip, so delete and recreate the issue (owner's
  `gh`), or tell the owner for a PR.
- **Queued work is an issue** (assigned to the owner, an existing label), never only a chat. The
  delivering PR says `Closes #n`; a PR that does part of an issue says `Related to #n` from the start,
  because changing it later doesn't undo GitHub's link (#191 closed #172 that way).
- **The agent doesn't answer third parties** (owner's rule): a comment from anyone but the owner (an
  upstream maintainer, a passer-by) gets no reply from the bot. Answering for the owner would make it
  a meat proxy. Tell the owner instead, and leave the reply to them.
- **Read an issue and all its comments before starting it:** the owner decides in comments (#43).
- **Keep going without being asked.** After a deploy and its live check, take the next issue; tech
  debt, refactors, tooling and bugs before features. Ask only for what is the owner's to decide. The
  work isn't done while issues remain open.
- **Stuck? File an issue** for what blocks you, assigned to the owner, and carry on with other work.
- **"Blocked by" links between issues go through `issue-links`** (owner's rule, #256): the plugin's
  `block_issue` / `unblock_issue` / `issue_links` tools, or
  `sh packages/issue-links/run.sh cli block <issue> <blocked-by>` (also `unblock`, `links`), never raw
  API calls. It refuses a link that would close a cycle, and prints the cycle.
- **Long things run in the background** (tests, builds, CI, watchers, reviewers); do the next thing
  meanwhile.

## A pull request, from push to deploy

### Before pushing

- `bun run lint && bun run test` locally (`test` type-checks first). Leave the e2e suite to CI;
  run it locally only to debug a failure.
- **One push per batch of changes:** each push cancels the branch's running CI.
- **Never pipe a command whose exit code matters** (`bun run lint | tail` succeeded on a failing
  lint once); use `set -o pipefail` or `${PIPESTATUS[0]}`.
- **e2e tests are a few long journeys**, not many small tests: each test pays for emulator resets,
  seeding and sign-in on every device. Add a `test.step` to the journey for that area, and keep an
  area's journeys together in its spec (e2e files have no length limit); find what a step checks by
  its own title or id, not by position (earlier steps leave data behind).

### A GIF for every UI change

Every PR that changes the UI shows it in a GIF in its description (after the
[record-browser-gif skill](https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/skills/record-browser-gif/SKILL.md)):

- **Record only CI's e2e videos with demo data, never the live app** (real entries, public PRs).
  `bun packages/tooling/src/pr-gif.ts` turns a run's video into a GIF of at most 10 MB.
- A step only shows on video if it waits for the changed state; crop to what changed and slow it down.
- Publish it on the `assets` branch (never merged; `gh pr edit --attach` refuses the bot's token) and
  embed `https://github.com/Flixbox/household-brain/blob/assets/pr-<n>-<what>.gif?raw=true`. Never
  commit a GIF to the PR's branch.
- No visible change: say so in the description.

### After every push

- **Update the PR description** to what the branch does now.
- **Keep the project watcher running.** It is this repository's Claude Code plugin
  (`packages/watcher`, #200); its `babysit-prs` skill has the routine (what each event asks for).
  With the plugin installed, it starts by itself when that skill runs, as the bot
  (`.claude/watcher.env`, #241). Without it, run it under a `Monitor` and re-arm it on expiry:

  ```sh
  GH=agent-gh SELF='flixbox-ai-agent[bot]' bun packages/watcher/src/watch-project.ts --follow
  ```

  It reads comments with the owner's login, the only one that sees the owner's pending reviews. It
  follows a merged PR through `main`'s deploy: `DEPLOYED` asks for the live check below,
  `DEPLOY_FAILED` for a follow-up PR.

### Comments and review

- **Every comment of the owner's gets an answer** (a third party's doesn't, see above): fix what is
  asked in one push, reply in the thread, resolve it once settled. One that needs the owner's
  decision stays open.
- **One reviewer agent per PR** (read-only, findings with severity and evidence). Fix blockers and
  should-fix items in one push and say in the description what was addressed.

### Merge

- **Enable auto-merge** (`agent-gh pr merge <n> --auto --squash`) only with the owner's approval and
  once the PR is well reviewed: the findings fixed and the fixes looked at. Four review rounds is the
  soft cap; after it, fix and merge, and say what wasn't re-reviewed.
- **Read the PR for unanswered comments first, as its own step**, never chained to the merge command
  (#154): an approval and a comment often arrive together.
- `main` only takes PRs with green CI; never push to it. A failed deploy gets a follow-up PR.

### The live check after every deploy

Mandatory, never blocking: if it finds something broken, or the browser fails, carry on and fix it
in the next PR (first, if the app is unusable). Report what it showed.

1. Open `https://household-brain-sf.web.app` and reload until the page runs the new build (take an
   "update available" prompt if one shows): compare the `/assets/index-*.js` it loaded with
   `curl https://household-brain-sf.web.app/`. The service worker serves the old build for a few
   reloads, and answers a page `fetch` from its cache.
2. Check the page renders, sign-in or the signed-in screen works, and the console shows no errors.
3. Exercise what the PR changed, where safe. **Never create, change or delete real entries, or touch
   the real Google Calendar, to test.**

## Rules for the code

- **Arrow functions only** (#67), components too: an arrow isn't hoisted, so what runs at module load
  comes after what it uses.
- **No `as` casts in app code** (#68; `as const` is fine): narrow with a type guard or a parser
  (Firestore documents go through `lib/documents.ts`). Tests may cast their fixtures.
- **`Date` is banned; use `Temporal`.** Due dates are calendar dates at 17:00 Europe/Berlin; convert
  only at the edges (Google's RFC 3339 strings).
- **No measured numbers in docs or comments** (durations, sizes, counts): they go stale. They belong
  in the PR or issue that measured them.
- **Other repositories' issues and PRs only as code text** (`` `owner/repo#123` ``), never linked,
  and not at all in commit messages: every link from this public repo notifies theirs (#146).
- **Tailwind classes in a constant:** its name ends in `Class`, an object of them in `Classes`; the
  Tailwind lint (#187) checks only those and `className`.
- **Example and test domains use `.test`**, never `example.com` or a real-looking host.
- **oxlint runs every category as an error, with type information**, and a disable comment that no
  longer turns anything off fails the lint.
- **A rule switched off for one file is switched off at its top, with a reason** (owner's rule,
  #181): `/* oxlint-disable <rule> -- <reason> */`, never for a single line. A rule off for a kind of
  file or the whole repository goes into `oxlint.config.ts` with its reason. Before switching a rule
  on, check it isn't listed as `off` further down (the last duplicate wins), and prove it with a file
  that breaks it.
- **Effects return only a cleanup:** `useEffect(() => { doIt() }, [])` with a block; an expression
  body returned Chrome's `scrollTo` promise and blanked the app (#165).
- **React Compiler memoises** (#69): no `useMemo`, `useCallback` or `memo`; follow the Rules of React,
  read values from outside React through a store, and name components.
- **No imports from parent folders** (#77): import by the package's own name and path.
- **No barrel files**: packages expose modules by path, and code imports from the defining module.
- **The shell knows no features**, and features don't wire into it; `apps/web/src/main.tsx` connects
  them. Packages never import from `apps/web`. fallow enforces which package may import which
  (`.fallowrc.jsonc`); change the boundaries there, not around them.
- **State lives in nanostores**, `@nanostores/persistent` for what survives a reload; no direct
  `localStorage`. Firestore data a screen shows comes from a live store
  (`@household-brain/firebase/live`), not an `onSnapshot` per component; a listener with special needs
  (pending-write metadata, server-only answers, the allowlist) stays explicit.
- **Helpers two packages share go into `packages/core`** (#171): `stringify()` for any value as text,
  never `String(error)`. A failure dropped on purpose goes to `ignoreFailure` with a comment saying
  why nothing is lost (#174); one someone should see goes to `reportError`. A `catch` that turns a
  failure into a value (`.catch(() => null)` meaning "not there") is neither, and stays.
- **A tool's options go into its config file** (owner's rule, #183), a typed one where the tool
  reads it, not into the `package.json` script.
- **Read `process.env.BUN_PUBLIC_*` literally and compare it inline** where a branch must vanish from
  production (#146): the bundler only inlines a literal read.
- **Calling a new outside service means adding its origin to `connect-src`** in `firebase.json` in
  the same PR (#113), or the browser blocks it in production.
- **Watch the allowlist entry with `onSnapshot`**, don't read it once: a one-shot read raced sign-out
  and locked the app out offline.
- **Firebase Hosting header rules match the request path**, not the rewrite target: a rule for every
  page needs `**`.
- **Current Chrome and Firefox only, no Safari** (#179). Bun's bundler adds no polyfills: check a new
  browser function exists in both before using it.
- **Icons, manifest and head links come from `packages/pwa`** (#148): change `apps/web/pwa.config.ts`
  or the icons, never hand-write them.
- **The emulator wiring and the e2e sign-in hook must never ship in the production build**: they sit
  behind an inline `process.env.BUN_PUBLIC_USE_EMULATORS` comparison, and CI checks the production
  build for them.
- **No server.** If a feature ever needs one, look at a free Cloudflare Worker first and file an issue
  saying why, rather than adding a backend.

## Dependencies, CI and tooling

- **Bun, and only Bun** (#140): package manager, runtime, test runner. Run tools and scripts through
  Bun (`bun run`, `bun --bun`, `bun <file>`), never `npx`; there is no Node fallback.
- **Run tasks through Nx at the root:** `bun run test`, `bun run typecheck`, `bun run build`.
- **Every dependency pinned exactly; nothing younger than 48 hours** (#94, #102): CI refuses a too
  young package or action; wait and re-run. An urgent exception goes into
  `install.minimumReleaseAgeExcludes` with its reason.
- **No dependency install scripts:** `trustedDependencies` holds only a placeholder, because an empty
  list lets Bun's own list through (a native module once crashed the deploy, #145). Add a package
  only when it truly needs its script, with the reason in the PR.
- **CI uses only GitHub-owned and `google-github-actions/*` actions, pinned to full SHAs.** Never
  `pull_request_target` or `workflow_run`, never self-hosted runners.
- **Every CI job has a time limit, Playwright a `globalTimeout`,** and test reporters stream
  progress: a hang once ran silently for hours.
- **Filter runs by workflow** (`--workflow ci.yml`): a merge also starts Dependabot runs.
- **One TypeScript config to change: `tsconfig.base.json`** (#79).
- **A new package** gets its own `package.json` and `tsconfig.json`, and goes into the `workspace:*`
  exceptions in `npmpackagejsonlint.config.ts` once another package depends on it. That config's
  `rules` stay a named export: Bun loads it as a module, and a default export reads as empty.
- **A whole-repository Nx target takes `{workspaceRoot}/**/*` as input**: the root project's default
  inputs leave out other projects' files, which once served a stale green from cache.
- **Nothing runs on code that doesn't type-check** (owner's rule, #193): tests and builds depend on
  the type check in Nx.
- **Review the e2e task's Nx inputs** when the tests come to depend on something new outside the app
  and packages (#71), or a cached green hides a broken journey.
- **The e2e job's Playwright image must match `@playwright/test`**: when Dependabot bumps it, update
  the image tag, digest and `PLAYWRIGHT_IMAGE_VERSION` in `ci.yml`.
- **Change hosting headers, CSP and rewrites in `firebase.json` only**; the e2e config is generated
  from it (#150).
- Pushing under `.github/workflows/` needs the `workflow` scope on the token.
- **`bun test`'s `toEqual` wants the expected value to fit the actual one's type**; write
  `expect<unknown>(x)` for a deliberately loose comparison.
- **The Firestore emulator needs Java 21**; Java 17 fails.

## Manual steps no code does

- **The Gemini Gem "Household Brain v2"** follows `packages/entries/src/lib/gemini-gem.md` (#119).
  A unit test fails when it doesn't list exactly the app's category slugs and price intervals, so
  changing either changes the instructions in the same PR. After a PR that changes them is merged, paste it into the Gem (Gemini as the owner → Gems →
  Household Brain v2 → Instructions → Save), and say so in the PR.
- **New sign-ups are switched off** in Firebase Authentication. To add a person: switch sign-up on
  (console → Authentication → Settings → User actions), let them sign in once, allowlist their uid
  (copied from Authentication → Users, not a screenshot), switch it off again. While it is off,
  nobody can sign in for the first time.
- **Merging is the owner's auto-merge**, never a required review: the owner can't approve PRs opened
  with their own account.
