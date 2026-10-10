# Agent notes for household-brain

There is no separate spec. **The code explains itself**, with short comments next to it for the
reasons a reader can't see (keep them true in the same pull request that changes the code).
**Decisions and their history live in the GitHub issues.** The README holds only what a human has to
do by hand (setup) and how to run things. This file holds the rules for working here and what agents
have learned the hard way; add to it when something bites.

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

- **Pull requests and comments:** `agent-gh pr create --assignee Flixbox …`, `agent-gh pr comment …`.
  Every pull request is assigned to the owner (`Flixbox`), always.
- **Project watcher:** `GH=agent-gh /tmp/watch-project.sh`. It still reads comments with the owner's
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

**Keep each pull request tight: one topic.** Side findings, refactors and tooling tweaks go into
their own follow-up PR, never along for the ride.

**No pull requests that only change docs.** A README or agent-note change (a new rule, a docs issue)
rides along with the next real feature, refactor or fix PR, the one exception to "one topic", and
that PR's description says so and closes the docs issue.

**Abstract only when it pays.** Introduce or extend a shared helper, or file an issue proposing one,
only when it makes the code simpler or two or more places depend on the same logic. Otherwise leave
the special cases explicit and say why.

**Rules live in this file, not in an agent's memory.** An agent's memory is ephemeral. When the owner
states a rule for this repository, write it here (in the next real PR, see above).

**Nothing personal goes on GitHub: the repository is public.** Issues, pull requests, comments,
commits, code and tests never contain the household's real entries: amounts, balances, codes, card
or phone numbers, providers tied to the owner, names of people. Use made-up examples ("a gift card
credit", "Coupon 10 €"). Editing a slip away isn't enough, because GitHub keeps the edit history:
delete and recreate the issue (owner's `gh`), or tell the owner for a pull request.

**Track queued work as GitHub issues.** Every idea or request that isn't being built right now gets
an issue (assigned to the owner, an existing label such as `enhancement`), and the pull request that
delivers it says `Closes #n`. Nothing waits only in a chat.

**Read the issue and all its comments before starting work on it.** The owner decides things in
issue comments (e.g. #43); the description alone can be out of date.

**Keep going without being asked.** Once a pull request is deployed and its browser check is done,
start the next planned piece of work, or fix what the owner reported, without waiting to be told.
Ask only for decisions that belong to the owner (security trade-offs, product decisions, scope).
The work isn't done while open issues remain: when one pull request is deployed, take the next issue.
**Tech debt and refactors come first:** take open refactor, cleanup, tooling and bug issues before
new feature issues.

**Stuck? File an issue and move on.** When something can't be finished without the owner (a
setting the bot can't change, a decision, a broken tool), file an issue describing what is blocked
and why, assigned to the owner, and continue with the next work instead of waiting.

**Run long things in the background and keep working.** Test suites, builds, installs, CI and PR
watchers, reviewer agents: start them in the background (their exit is the notification) and do the
next useful thing meanwhile, such as reading review findings, updating the PR description or the
comments. Only wait in the foreground for something whose result you need for the very next step.

### 1. Before you push

- **Run the quick checks locally**: `pnpm lint && pnpm typecheck && pnpm test` (seconds). Leave the
  e2e suite (`pnpm test:emulated`) to CI, which runs it on every push anyway; run it locally only to
  debug a failure CI found.
- **Write e2e tests as a few full user journeys, not many small tests.** Every test resets the
  emulators and seeds data in `beforeEach`, then signs in and usually mocks Google, on each of the
  three devices; that repeated setup is a large share of the e2e time. So extend the journey that
  covers the area (one sign-in, then a `test.step(...)` per behaviour) instead of adding a new
  `test(...)`; open a new journey only for a new area or a setup that can't be shared.
  - e2e files have no length limit (`max-lines` is off for `apps/web/e2e/**`): keep an area's
    journeys together in its spec rather than splitting them up for size.
  - Inside a journey, find what a step checks by its own title or id (`google.live().find(...)`),
    not by position: earlier steps leave their entries and events behind.
- **Batch your changes.** Every push cancels the running CI for that branch, so five quick pushes mean
  five cancelled runs and no result.
- **Check exit codes without pipes**, or with `${PIPESTATUS[0]}`. See the shell lesson below.

**Every pull request that changes the UI shows it in a GIF**, in its description: the part of the
screen that changed, in use. This follows the [record-browser-gif
skill](https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/skills/record-browser-gif/SKILL.md),
adapted to this repository:
- **Record only the e2e build with demo data**, never the live app: it shows the household's real
  entries, and pull requests are public. CI films every e2e test and uploads the videos per device
  (`e2e-videos-<device>`), so the journey step that covers the change is the recording.
- Turn it into a GIF with `scripts/pr-gif.sh` (`fetch`, then `sheet` to find the seconds, then `gif`),
  from the run of the commit the description talks about. At most 10 MB.
- Publish it on the `assets` branch (an orphan branch that is never merged) and embed it in the
  description as `![what it shows](https://github.com/Flixbox/household-brain/blob/assets/pr-<n>-<what>.gif?raw=true)`.
  `gh pr edit --attach` doesn't work for the bot: it refuses a GitHub App token. To publish: clone
  the branch (`git clone --branch assets --single-branch --depth 1 …`), add the GIF, commit, and
  push with the bot's token. Never commit a GIF to the pull request's own branch.
- The tests click faster than the video records: a step only shows on video if it waits for the
  changed state (an assertion on it) before moving on. Crop to the part that changed and slow the
  clip down (`SPEED`), or the GIF is a blur.
- When the change has no visible part (CI, sync logic), say so in the description instead.

### 2. After every push

1. **Update the PR description** so it describes what the branch does now.
2. **Keep the project watcher running in the background**, and let its exit wake you:

   ```sh
   cp scripts/watch-project.sh /tmp/watch-project.sh && GH=agent-gh /tmp/watch-project.sh
   ```

   - One watcher for the whole project: every open PR, merged ones until their deploy, `main`'s CI,
     new issues and the owner's comments on issues. Each event comes prefixed with its PR
     (`PR #12: CI_PASSED …`).
   - It follows each PR's **current** head commit, so a push needs no restart.
   - It remembers what it already reported, so after handling an event you simply start it again and
     it continues with the next one.
   - It runs from a copy, because bash reads a script while running it.
   - It stays armed through the merge and reports the deploy. Don't poll by hand alongside it.
   - It watches `main` too, also between PRs: every new commit (`MAIN_ADVANCED`), failing or
     hanging runs (`MAIN_FAILED`, `MAIN_SLOW`), and new commits an open PR lacks (`MAIN_MOVED`).
   - A PR it has seen open stays watched until its deploy or its closing is reported.
   - A PR labelled **`parked`** (left open on purpose) only reports its CI and comments, not
     conflicts, approvals or `main` moving on. To park a PR, add the label; remove it to bring the
     PR back.
   - **Every CI result** (a PR's, a deploy's or `main`'s, passed or failed) ends with the list of open
     PRs: approved or awaiting approval, auto-merge on or off, CI state. Act on every approved PR in
     it whose auto-merge is still off, not only on the one the event names.
   - A plain approval is reported as `APPROVED` only. One with text also comes as `ACTIVITY`, so a
     request written into the approval gets answered before auto-merge.
   - The bot's own comments and replies in review threads are skipped; its reviews (the reviewer agent posts as
     the same bot) are not.

### 3. When the watcher reports

| Event | What to do |
| --- | --- |
| `NEW_PR` | A pull request appeared (Dependabot's too). Review it like any other: one reviewer pass, and for a dependency bump check what CI can't see, such as a build whose output silently changed. |
| `CI_PASSED` | Report it and start the watcher again. |
| `APPROVED` | The owner approved. If the PR is well reviewed (section 5), enable auto-merge now: `agent-gh pr merge <n> --auto --squash`. Don't wait for anything else. |
| `READY_TO_MERGE` | Approved and green, but auto-merge is off: enable it, unless review findings are still open (then fix them first, within the four-round cap). |
| `CI_FAILED` | Read the failing job (`agent-gh run view <run> --log-failed`), reproduce locally, fix, push once. |
| `CI_SLOW` | More than 20 minutes: something hangs. Cancel the run (`gh run cancel <run>`: the bot can only read Actions, so this uses the owner's login), read the logs (`agent-gh api repos/Flixbox/household-brain/actions/jobs/<job-id>/logs`), fix the hang **and** the missing time limit. A flaky download can just be re-run (`gh run rerun <run> --failed`, owner's login again). |
| `CONFLICT` | Rebase on `main`, run the checks, push once, reply on the PR. |
| `ACTIVITY` | Answer every comment (section 4), including those of a pending review. |
| `DEPLOYED` | A minute later, check the live app in the browser (section 5): mandatory, but never blocking. Report, and start the next PR. |
| `DEPLOY_FAILED` | Fix it in a follow-up PR (never push to `main`). A deploy that a newer merge cancelled isn't a failure: the watcher follows the newer run, which deploys both. |
| `MAIN_FAILED` / `MAIN_SLOW` | `main` is broken or hanging, whichever PR caused it. That comes first: fix it in a follow-up PR, or re-run a flaky job, before continuing. |
| `MAIN_PASSED` | `main`'s newest run passed. Nothing to fix; read the open-PR list that comes with it. |
| `MAIN_ADVANCED` | `main` got a new commit, whoever merged it. Know what landed: if it was your own PR, its deploy follows; otherwise check whether it touches your work. |
| `MAIN_MOVED` | `main` moved under the PR (another merge). Rebase on `main`, run the checks, push once, so what gets merged is what was tested. |
| `NEW_ISSUE` / `ISSUE_COMMENT` | Read it; take the work in turn (tech debt first), answer the owner's comment. |

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

- **Merging:** once the owner has **approved** the PR and you consider it well reviewed, enable
  auto-merge yourself (`agent-gh pr merge <n> --auto --squash`); it merges once the required checks
  are green. "Well reviewed": the reviewer agent's findings are fixed and the fixes themselves were
  looked at. One review round is usually enough; **four rounds is the soft cap**: after the fourth,
  fix what it found and merge (with the owner's approval) rather than reviewing again, and say in the
  PR what was not re-reviewed. Without the owner's approval, never enable auto-merge.
- After the merge, the same watcher follows the `main` run through `deploy` and reports
  `DEPLOYED` or `DEPLOY_FAILED`.
- **If the deploy fails, open a follow-up pull request** with the fix. Never push to `main`
  directly; it only accepts PRs with green CI.
- **One minute after every deploy, check the live app in the browser** (Claude in Chrome). This is
  **mandatory, but never blocking**: if the check finds something broken, or the browser breaks or
  times out, go on with the next PR anyway and fix what broke there (or in a follow-up PR first,
  if the live app is unusable). Say in the report what the check showed. The check:
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
- **Watch a pipeline with a deadline**: `scripts/watch-project.sh` (see the babysitting guide above).
- **Each push to a PR branch cancels the running CI** (`concurrency` with `cancel-in-progress`).
  Batch fixes into one push, or no run ever finishes.
- **Pushing anything under `.github/workflows/` needs the `workflow` scope** on the GitHub token
  (`gh auth refresh -h github.com -s workflow`).

- **A commit triggers more than CI.** A merge to `main` also starts Dependabot runs, and the first run
  listed for a commit was a Dependabot one, so a watcher reported "success" before the deploy had
  even started. Always filter by workflow (`--workflow ci.yml`).
- **Right after a push, GitHub can still report the PR's previous head commit.** A watcher using
  `--pr` then watched the cancelled run of the old commit. Watch by the commit you just pushed.

- **Run the watcher from a copy of the script**, e.g. in a scratch directory. Bash reads a script
  while running it, so editing or checking out `scripts/watch-project.sh` under a running one corrupts
  it.

- **Stacked PRs conflict after a squash merge.** PR 6 was built on PR 5's branch; squash-merging
  PR 5 rewrote that history and left PR 6 conflicting, unnoticed until the owner pointed it out. One
  PR at a time, and the watcher reports conflicts.

- **The e2e job runs in Microsoft's Playwright image**, which already has the browsers and their system
  packages. Installing them per run was slow and once hung. The image version must
  equal `@playwright/test`: when Dependabot bumps the package, CI's first e2e step fails with a
  message, and `ci.yml` needs the matching version in two places: `container.image` (tag and digest:
  `docker manifest inspect`, or the registry's `docker-content-digest` header) and
  `PLAYWRIGHT_IMAGE_VERSION` next to it, which that first step compares.

### Shell

- **Quote file paths that contain `$`.** TanStack route files are named like `items.$itemId.tsx`;
  unquoted in a shell command, `$itemId` expands to nothing and the file becomes `items..tsx`.
- **A pipe hides the exit code.** `pnpm lint | tail` succeeds even when lint fails, and a commit
  chained after it with `&&` went through with a lint error. Check `${PIPESTATUS[0]}`, use
  `set -o pipefail`, or don't pipe a command whose exit code matters.

### Code rules

- **Arrow functions only, never the `function` keyword** (#67): `const name = (…) => …`, components
  included. oxlint reports declarations and non-arrow components (`func-style: expression`,
  `react/function-component-definition`); a `function` expression (`const f = function …`) slips
  through, so don't write one. An arrow constant isn't hoisted: whatever runs at module load, such as
  a route file's `createFileRoute({ component })`, comes after the definitions it uses. A direct use
  before the definition is reported, a callback that runs at load isn't. Calls inside other functions
  may point further down.
- **No type assertions (`as`) in the app's code** (#68); `as const` is fine. Narrow with a type guard
  (`(value: unknown): value is Rate => …`), build the typed value explicitly, or read it with a parser:
  Firestore documents go through `lib/documents.ts` (`itemFrom`, `categoryFrom`, `householdFrom`),
  never `snapshot.data() as Item`. oxlint enforces it (`consistent-type-assertions: never`); tests
  and e2e may cast their partial fixtures and fakes. tsconfig adds `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes` to TypeScript 7's default `strict`.
- **No measured numbers in docs or comments** (durations, sizes, counts): they go stale. They belong
  in the PR or issue that measured them; a job's run history shows what is normal.
- **`Date` is banned; use `Temporal`** (`temporal-polyfill`). Due dates are calendar dates at 17:00 in
  `Europe/Berlin`, which `Temporal.PlainDate` and `ZonedDateTime` model; `Date` silently mixes UTC,
  local time and daylight saving. oxlint enforces it. Convert only at the edges (Google's RFC 3339
  strings).
- **Example and test domains use the reserved `.test` TLD** (`owner@household-brain.test`), never
  `example.com` or a real-looking host.
- **oxlint runs every category as an error.** A rule is switched off only in `.oxlintrc.json`, with
  its reason as a comment, never with an inline disable comment. Before switching a rule on, search
  the file for it: a rule already listed as `"off"` further down wins (the last duplicate key in
  JSON counts), and the new entry silently does nothing. Prove a new rule with a file that breaks it.
- **Every dependency is pinned exactly** (`savePrefix: ''`, enforced by npm-package-json-lint);
  Dependabot bumps them. **No version younger than 48 hours** (#94): `minimumReleaseAge` in `pnpm-workspace.yaml`,
  which pnpm checks on every install, `--frozen-lockfile` included, so CI fails on such a lockfile
  ("within the minimumReleaseAge cutoff"); wait and re-run. Dependabot waits as long (`cooldown`).
  An urgent exception goes into `minimumReleaseAgeExclude` with its reason. **GitHub Actions too**
  (#102): `scripts/check-action-age.sh` runs first in CI and fails on a pinned action release younger
  than 48 hours; Dependabot's `cooldown` counts loosely and let a younger one through (#101). Wait and re-run. Node is pinned in `package.json` (`volta.node`), pnpm in `packageManager`.
- **fallow** (`.fallowrc.jsonc`, part of `pnpm lint`) fails on unused files, exports and
  dependencies, on duplication, and on imports across the package boundaries: `apps/web` may use
  every package; `shell` and `calendar` only `firebase`; nothing imports `apps/web` (its e2e tests
  and config included).
- **The e2e build must never reach production:** the emulator wiring and the `window.e2eSignIn` hook
  are behind an inline `import.meta.env.VITE_USE_EMULATORS` comparison, `vite.config.ts` refuses a
  production build with it set, and CI fails if `apps/web/dist/` mentions either. The emulators run
  as `demo-household-brain`, which can't reach real Google services.
- **CI uses only GitHub-owned and `google-github-actions/*` actions**, pinned to full SHAs (a
  repository setting); pnpm is installed from `packageManager`, not through a third-party action.
- **Never use the `pull_request_target` or `workflow_run` triggers** (both run code with the base
  repository's privileges), and never add self-hosted runners to this public repo.
- **One TypeScript config to change: `tsconfig.base.json`** (#79). Every tsconfig that compiles files
  extends it and adds only its own `types`, `jsx`, `include` and build-info files (the solution file
  `apps/web/tsconfig.json` only lists references); a compiler option all projects share
  goes into the base. It is an Nx input of every project (`sharedGlobals` in `nx.json`), so changing
  it reruns their typecheck and tests instead of serving them from the cache.
- **The e2e journeys are a cached Nx task** (#71): `@nx/playwright` infers it as `playwright` (not
  `e2e`: Nx would load `apps/web/.env.e2e` into a target of that name), and CI runs it per device
  (`E2E_PROJECT`), after the cached `build:e2e`. When none of its inputs changed, the result and its
  videos are replayed. (The plugin's per-file `e2e-ci` refuses to run without Nx Agents, a paid
  service.) **Review its inputs whenever the tests come to depend on something new** outside
  `apps/web` and the packages, or a cached green hides a broken journey. They are the app, the
  packages, `e2eEnvironment` in `nx.json` (the Firebase config and rules, Node and pnpm from the root
  `package.json`, `ci.yml`, `E2E_PROJECT`) and the versions of `@playwright/test` and
  `firebase-tools` (the emulators). Tools only the root `package.json` lists are not covered by the
  app's dependencies: name them there. These inputs replace the plugin's own, so they restate its
  list: compare them with `nx show project @household-brain/web` without the override when
  `@nx/playwright` is bumped.
- **Lint and typecheck are Nx targets:** `pnpm lint` is `nx run-many` over the root project's
  `lint:oxlint`, `lint:packages` and `lint:fallow` (only those root scripts are Nx targets, through
  `nx.includedScripts`), `pnpm typecheck` over every project's `typecheck` (the root's own is in
  `nx.targets`). Whole-repo tools take `{workspaceRoot}/**/*` as input: the root project's default
  inputs exclude files that belong to other projects, which once served a stale green from cache.

### Toolchain

- **The repo is an Nx workspace** (pnpm workspaces): `apps/web` is the app, `packages/*` are
  features and shared code, consumed as TypeScript source (modules exported by path, no build
  step). A new feature, e.g. a shopping list, becomes its own `packages/<name>`,
  and `apps/web` routes render what it exports. Packages never import from `apps/web`.
  A new package also goes into the `workspace:*` exceptions in `npmpackagejsonlint.config.ts`
  (exceptions are exact names), and gets its own `package.json` and `tsconfig.json`.
- **The shell knows no features.** `packages/shell` is the frame (layout, sign-in gate, update
  prompt, sign-out); features never import from it for wiring, and it never imports from them.
  `apps/web/src/main.tsx` connects the two, e.g. `onSignOut(forgetCalendarToken)`.
- **State lives in nanostores.** Plain `nanostores` atoms for in-memory state shared outside React,
  `@nanostores/persistent` for state that survives a reload (the Calendar token, UI preferences),
  read in components with `useStore` from `@nanostores/react`. No hand-rolled listener sets and no
  direct `localStorage` calls.
  - **Firestore data a screen shows** comes from a live store (`queryStore` / `docStore` in
    `@household-brain/firebase/live`): it listens only while read, shares one listener between all
    readers, and resets when it stops. Not a `useEffect` with `onSnapshot` per component. Listeners
    with special needs (pending-write metadata in the outbox, server-only answers) stay explicit.
- **No imports from parent folders** (`../`, #77). Inside a package, a module from another folder is
  imported by the package's own name and path, as everyone else imports it:
  `@household-brain/calendar/lib/items/model`. Siblings in the same folder stay `./x`. oxlint enforces
  it (`import/no-relative-parent-imports`). Only what the package's `exports` cover can be imported
  this way (`lib/*.ts`, `components/*.tsx`), so shared non-component code lives in `lib/`.
- **React Compiler memoises at build time** (#69, through `@rolldown/plugin-babel` in
  `apps/web/vite.config.ts`, so the packages too): don't write `useMemo`, `useCallback` or `memo` (oxlint's
  `no-restricted-imports` refuses them). Code has to follow the Rules of React (no mutating props or state, no reading refs while
  rendering), or the compiler skips it or its memoisation changes what renders. That includes
  values from outside React read during render: the compiler takes them as unchanging, so read
  them through a store (`useStore($user)`, not `auth.currentUser`). Components need a name
  (`const RootLayout = () => …`); an anonymous one isn't compiled.
- **No barrel files.** No `index.ts` that re-exports a package's modules: barrels pull every module
  into whatever imports one of them, which defeats tree shaking and code splitting. Packages
  expose their modules by path through `exports` patterns in `package.json` (e.g.
  `@household-brain/calendar/components/items/ItemList`), and code imports from the module that
  defines what it needs.
- Run tasks through Nx at the root: `pnpm typecheck`, `pnpm test` (`nx run-many`), `pnpm build`
  (`nx run @household-brain/web:build`). Nx caches results, so unchanged projects are skipped.

- **oxlint loads `@stylistic/eslint-plugin` through `jsPlugins`.** There is no ESLint here.
  `.oxlintrc.json` is JSONC, so each disabled rule carries its reason as a comment.
- **npm-package-json-lint only auto-discovers `.js`/`.json` configs.** `pnpm lint` passes
  `-c npmpackagejsonlint.config.ts`. Node loads that file as an ES module, so `rules` must be a
  named export: a default export arrives wrapped as `{ default }` and reads as an empty config.
- **pnpm denies dependency install scripts.** Decide each package in `allowBuilds` in
  `pnpm-workspace.yaml`. `savePrefix: ''` keeps new dependencies exactly pinned.
- **The Firestore emulator needs Java 21** (`brew install openjdk@21`); Java 17 fails.

### App and build

- **Browser functions must exist on the build target.** Vite's default target is
  `baseline-widely-available` (iOS Safari 16.4 among others), and it converts syntax but adds no
  polyfills. A newer function such as `URL.canParse` (iOS 17) throws on older iPhones and takes the
  whole screen down. Check support before using a recent API; nothing in lint catches it.

- **Compare `import.meta.env.X` inline** when the branch must vanish from production builds. Passing
  `import.meta.env` through a helper function stops Vite from folding it, so the dead code ships.
- **Firebase Hosting matches header `source` against the request path, not the rewrite target.** A
  `no-cache` rule on `/index.html` does not cover `/` or SPA routes, so it needs `**`.
- **Watch the allowlist entry with `onSnapshot`, don't read it once.** A one-shot server read raced
  sign-out (stale "allowed") and locked the app out offline.

- **New sign-ups are switched off** in Firebase Authentication, on purpose, since both household
  members have accounts (2026-10-02). Existing accounts sign in as usual; a new account is refused
  (`auth/admin-restricted-operation`, or `ADMIN_ONLY_OPERATION` from the REST API). The Firestore
  allowlist is still the lock on the data. **To add a person:** switch sign-up on (Firebase console →
  Authentication → Settings → User actions), let them sign in once, allowlist their uid (copy it from
  Authentication → Users, not from a screenshot), and switch sign-up off again. While it is off,
  nobody can sign in for the *first* time, the owner included after deleting their account.

### Repository and accounts

- **`main` only accepts merges from pull requests with green CI**, and force-push is blocked.
- **Pull requests opened with the owner's GitHub account can't be approved by the owner.** Merging
  is done by enabling auto-merge, never by a required review.
- **Commit as the repo-local identity** (`git config user.email`), never the machine-global work
  email. History was rewritten once to remove it.
