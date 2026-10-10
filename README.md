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
pnpm install
pnpm dev               # Vite dev server on http://localhost:5173
pnpm lint              # oxlint, npm-package-json-lint, fallow (Nx, cached); pnpm lint:fix fixes what it can
pnpm typecheck && pnpm test
pnpm build             # apps/web/dist
pnpm test:emulated     # Firebase emulators: rules tests and Playwright e2e (needs Java 21)
pnpm emulators         # emulators only, to iterate on pnpm test:rules or the e2e tests against them
```

**Machine setup (once):**

```sh
brew install volta && volta install node@26 pnpm   # Node is pinned in package.json (volta.node), pnpm in packageManager
brew install openjdk@21                            # the Firestore emulator needs Java 21
pnpm exec playwright install chromium webkit       # e2e runs desktop Chrome, Pixel 9 and iPhone 17
brew install --cask gcloud-cli && gcloud init      # only for the one-time Google Cloud setup below
```

## Layout

An Nx workspace on pnpm workspaces. Packages are consumed as TypeScript source, their modules
exported by path (no barrel files); only the app is built.

```
apps/web/            the PWA (Vite + React): routes, PWA config, Playwright e2e against the emulators
packages/calendar/   the calendar feature: Google Calendar API, entries, outbox push, pull, Firestore
packages/shell/      the frame: layout, sign-in gate with the allowlist, update prompt, sign-out
packages/firebase/   Firebase app, Auth, Firestore, live stores, env checks
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
  is served from, so sign-in works in iOS home-screen apps.
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
- Manual fallback: `pnpm exec firebase deploy --only hosting,firestore:rules,firestore:indexes`.

Licence: Unlicense.
