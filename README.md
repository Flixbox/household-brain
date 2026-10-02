# Household Brain

A progressive web app for two people (me and my wife, **each with our own Google account**) that
keeps track of everything with a due date: expiring coupons, memberships and subscriptions, public transport tickets, warranties, contract notice periods, and so on.
Items are grouped by **category**, and within each category they are **sorted by due date**.

- **Google Calendar** is where the items live: one calendar I own and **share with my wife**. The app
  syncs with it in both directions, and Google Calendar sends both of us the reminders.
- **Firebase on the free Spark plan** provides login, live sync between devices, offline storage and
  hosting. **There is no backend server, no Cloud Functions and no secrets.**

## Quick start

Machine setup (Volta, pnpm, Java 21 for the emulators) and every command are in
[docs/toolchain.md](docs/toolchain.md).

```sh
pnpm install
pnpm dev              # Vite dev server on http://localhost:5173
pnpm lint && pnpm typecheck && pnpm test
pnpm test:emulated    # Firebase emulators, rules tests and Playwright end-to-end tests (needs Java 21)
```

## Project layout

An **Nx** workspace on **pnpm** workspaces. Packages are consumed as TypeScript source, their modules
exported by path (no barrel files); only the app is built.

```
household-brain/
├─ apps/web/                      # the PWA: Vite + React, routes, PWA config, e2e tests
│  ├─ src/main.tsx, src/routes/   # wires the features into the shell; thin route files
│  ├─ e2e/                        # Playwright against the Firebase emulators
│  ├─ .env.production, .env.e2e   # public Firebase config; emulator-only config
│  └─ vite.config.ts, playwright.config.ts, pwa-assets.config.ts, public/
├─ packages/calendar/             # the calendar feature (@household-brain/calendar)
│  └─ src/
│     ├─ lib/calendar/            # Google Calendar API, household setup, sharing
│     ├─ lib/items/               # entries: model, event mapping, outbox push, pull, Firestore
│     ├─ lib/google-token.ts      # GIS token client
│     └─ components/              # entry list/form, settings sections, sync bar
├─ packages/shell/                # app chrome (@household-brain/shell): page frame, sign-in gate with the
│                                 #   allowlist, update prompt, sign-out (features register what to forget)
├─ packages/firebase/             # Firebase app, Auth, Firestore, env checks (@household-brain/firebase)
├─ tests/rules/                   # Firestore security-rules tests
├─ firestore.rules, firestore.indexes.json, firebase.json   # hosting serves apps/web/dist
├─ nx.json, pnpm-workspace.yaml, package.json               # workspace root
├─ .oxlintrc.json, npmpackagejsonlint.config.ts, .gitleaks.toml
├─ scripts/babysit-pr.sh
├─ .github/workflows/ci.yml, .github/dependabot.yml
└─ .ai/AGENTS.md (AGENTS.md, CLAUDE.md link to it)
```

## Documentation

The specification lives in [`docs/`](docs/); it is the source of truth for how the app works, and
changes to it go through pull requests like code.

| Topic | |
| --- | --- |
| [Goals and non-goals](docs/goals.md) | What the app is for, and what it deliberately isn't |
| [Architecture](docs/architecture.md) | The parts and how they fit, and how it stays on the free Spark plan |
| [Login and access control](docs/access.md) | Google sign-in, the Calendar token, Firestore rules, Google Cloud setup |
| [How items are stored](docs/storage.md) | The event format in Google Calendar and the Firestore mirror |
| [Sync](docs/sync.md) | Pull before push, writes from the app, the pull, offline behaviour |
| [UI](docs/ui.md) | The board, the add/edit form, the menu, settings, the PWA |
| [Repository, CI/CD and secrets](docs/repository.md) | CI jobs, deploys, branch rules |
| [Toolchain](docs/toolchain.md) | Tools, commands and code rules |
| [Milestones](docs/milestones.md) | The build plan |
| [Decisions](docs/decisions.md) | Choices made and why |

Agents working in this repo also read [`.ai/AGENTS.md`](.ai/AGENTS.md).
