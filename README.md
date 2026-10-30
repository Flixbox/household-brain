# Household Brain

A progressive web app for a two-person household (each with their own Google account) that keeps
track of everything with a due date: coupons, memberships and subscriptions, transport tickets,
warranties, contract notice periods, paperwork, and credit that never expires.

- **Google Calendar** holds the entries: one calendar the owner shares with the other person. The
  app syncs with it both ways, and Google Calendar sends each person the reminders.
- **Firebase on the free Spark plan** provides sign-in, live sync between devices, offline storage
  and hosting. There is no backend server, no Cloud Functions and no secret.

How it works is explained where it happens, in short comments next to the code. Decisions and their
history live in the GitHub issues.

## Quick start

```sh
bun install
bun run dev               # Bun dev server on http://localhost:5173, with hot reloading
bun run lint              # oxlint, npm-package-json-lint, fallow (Nx, cached); bun run lint:fix fixes what it can
bun run test              # type check, then unit tests
bun run build             # apps/web/dist
bun run test:emulated     # Firebase emulators: rules tests and Playwright e2e (needs Java 21)
bun run emulators         # emulators only, to iterate on bun run test:rules or the e2e tests against them
```

**Machine setup (once):**

```sh
curl -fsSL https://bun.sh/install | bash -s bun-v1.4.3   # the version in package.json (packageManager); no Node needed
brew install openjdk@21                            # the Firestore emulator needs Java 21
bun --bun playwright install chromium webkit        # e2e runs desktop Chrome and Pixel 9; the iPhone 17 checks the Safari notice
brew install --cask gcloud-cli && gcloud init      # only for the one-time Google Cloud setup below
```

## Layout

An Nx workspace on Bun workspaces, run entirely on Bun (no Node). Packages are consumed as TypeScript source, their modules
exported by path (no barrel files); only the app is built.

```
apps/web/            the PWA (React, built with Bun): routes, PWA config and icons, Playwright e2e against the emulators
packages/entries/    the entries feature: entries, categories, outbox push, Google Calendar pull, Google Tasks import, Firestore
packages/shell/      the frame: layout, sign-in gate with the allowlist, update prompt, sign-out
packages/firebase/   Firebase app, Auth, Firestore, live stores, env checks
packages/pwa/        the installable, offline app: icons, manifest, service worker (`pwa-build`), update registration
packages/core/       small helpers every package may use (stringify)
tests/rules/         Firestore security-rules tests
.ai/AGENTS.md        notes for agents working here (AGENTS.md and CLAUDE.md link to it)
```

CI (`.github/workflows/ci.yml`) runs checks, the e2e suite and, on `main`, the deploy.

## One-time setup (by hand)

The Firebase project is a Google Cloud project; everything below happens in it.

**Google Cloud**
- Enable the **Google Calendar API** and the **Google Tasks API** (the Tasks inbox, #118; without
  it the app skips the import and keeps syncing the calendar).
- OAuth consent screen: External, with the app name and a support email. Publish it to **In
  production** (Testing mode asks for consent again every week). An unverified app is fine for
  personal use: click through the warning once.
- OAuth client: **Web application**. Authorised JavaScript origins: `https://<project>.web.app`,
  `https://<project>.firebaseapp.com` and `http://localhost:5173`. No redirect URI.
- Restrict the browser API key to those websites (plus `http://localhost/*`) and to the Identity
  Toolkit, Secure Token, Firestore and App Check APIs.

**Firebase**
- Authentication: enable the Google provider. `authDomain` is `<project>.web.app`, the origin the app
  is served from, so sign-in doesn't depend on another site's storage, which browsers partition.
- Firestore: the rules in `firestore.rules` let only allowlisted accounts in. **Allowlist each
  person** by creating `allowlist/<uid>` in the console (the uid is under Authentication → Users after
  their first sign-in; copy it from there). The app itself can never write the allowlist.
- **New sign-ups are switched off** once everyone has signed in (Authentication → Settings → User
  actions). To add a person: switch sign-up on, let them sign in once, allowlist them, switch it off.
- **When a person leaves:** delete their `allowlist/<uid>` **and** their `syncState/<uid>`. Every
  app records its version there, and an old record would keep features that need every app to be
  up to date (extra-date events, entries without a due date) switched off for everyone.

**The household calendar**
- The owner creates it from the app's Settings ("Create the household calendar").
- Then shares it by hand: Google Calendar → Settings → *Household Brain* → *Share with specific
  people* → the other person's account, with *Make changes to events*. (Sharing from the app would
  need the broader `calendar.acls` permission.)
- The other person opens Settings → "Connect my Google Calendar", which adds the calendar with their
  own reminders.

**Deploys from CI, without a stored secret**
- GitHub OIDC → Google **Workload Identity Federation** → a deploy service account with Firebase
  Hosting Admin, Firebase Rules Admin, Cloud Datastore Index Admin and Service Usage Consumer.
- The provider's condition accepts only this repository's numeric id, `refs/heads/main` and the
  `production` environment, so forks and other branches can't deploy.
- Repository variables (not secrets) for `ci.yml`: `WIF_PROVIDER` (the provider's full resource name)
  and `DEPLOY_SA` (the service account's email).
- Repository settings: fork PR workflows need approval; `GITHUB_TOKEN` is read-only; only
  GitHub-owned and `google-github-actions/*` actions, pinned to full SHAs; the `production`
  environment deploys from `main` only; `main` can't be deleted or force-pushed.
- Ground rules: review a fork PR's diff, `.github/` included, before clicking "Approve and run";
  never use the `pull_request_target` or `workflow_run` triggers; never add self-hosted runners.
- Manual fallback: `bun run firebase deploy --only hosting,firestore:rules,firestore:indexes`.

**A review bot asked once per PR, on request** (#324)
- Where a review bot (CodeRabbit) reviews, switch its automatic reviews off in its config and set
  `REVIEW_BOTS` in the watcher's settings; then a PR gets the bot's review only when it is labelled
  `bot-review` (`BOT_REVIEW_LABEL`), once: the watcher asks the bot and takes the label off.
- Create the label in that repository once (`gh label create bot-review`): GitHub adds only labels
  that exist.

**Clearing a PR without the owner's approval** (#327)
- Where a PR that isn't user-facing may be queued without the owner, after a clean review by a
  review subagent, label it `subagent-cleared` (`CLEARED_LABEL`): with `DISMISS_STALE_BOT_REVIEWS=1`
  the watcher then dismisses a bot's settled change request on it (CI green, every thread settled),
  which would otherwise keep blocking the merge, and takes the label off.
- Create the label in that repository once (`gh label create subagent-cleared`).

**The `claude-usage` command, for agents on a machine** (#260)
- It shares its cache with the watcher. Install it as a wrapper around this repository's copy, e.g.
  the watcher plugin's clone (which the watcher's run command keeps pulled):

  ```sh
  printf '#!/usr/bin/env bash\nexec bun "$HOME/.claude/plugins/marketplaces/household-brain/packages/watcher/src/claude-usage.ts" "$@"\n' > ~/.local/bin/claude-usage
  chmod +x ~/.local/bin/claude-usage
  ```

Licence: Unlicense.
