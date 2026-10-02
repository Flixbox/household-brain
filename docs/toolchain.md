# Toolchain

| Tool | Role | Install |
| --- | --- | --- |
| **Homebrew** | Installs all machine-level software | [brew.sh](https://brew.sh) |
| **Volta** | Node.js version management | `brew install volta` |
| **pnpm** | Package manager (no npm or yarn in this repo) | `volta install pnpm` |
| **Google Cloud CLI** | One-time project setup (APIs, Workload Identity Federation) | `brew install --cask gcloud-cli` |
| **Firebase CLI** | Deploys, emulators | A project dev dependency (`firebase-tools`), so it runs as `pnpm firebase …` |

**Machine setup (once)**

```sh
brew install volta
volta install node@26 pnpm
brew install --cask gcloud-cli     # works on macOS and on Linuxbrew (WSL)
gcloud init                        # log in with the owner account, pick the Firebase project
```

**Version pinning in `package.json`**

```jsonc
{
  "packageManager": "pnpm@<version>", // pnpm switches to this version on its own
  "volta": { "node": "<version>" }      // Volta switches Node when you cd into the repo
}
```

- pnpm is pinned through `packageManager`, not `volta.pnpm`. Volta only honours `volta.pnpm` when
  the experimental `VOLTA_FEATURE_PNPM=1` is set, while pnpm reads `packageManager` itself.
- Only `pnpm-lock.yaml` is committed. `package-lock.json` and `yarn.lock` are gitignored.
- **Every dependency is pinned to an exact version**, with no `^` or `~`:
  - `npm-package-json-lint` enforces it, configured in `npmpackagejsonlint.config.ts` and run as
    part of `pnpm lint`.
  - `pnpm-workspace.yaml` sets `savePrefix: ''`, so `pnpm add` writes exact versions.
  - Dependabot bumps the pins.
- Dependency install scripts are denied by default (`allowBuilds` in `pnpm-workspace.yaml`).
- TypeScript 7 (the native compiler).
- Node 26, pinned in `package.json` (`volta.node`). `@types/node` uses the same major, so Dependabot
  skips major `@types/node` updates and both get bumped together.

**Everyday commands**

```sh
pnpm install
pnpm dev                 # Vite dev server on http://localhost:5173
pnpm build               # nx: @household-brain/web → apps/web/dist/
pnpm lint               # oxlint (with @stylistic as an oxlint JS plugin, no ESLint) + npm-package-json-lint
pnpm lint:fix
pnpm typecheck          # nx run-many: every project
pnpm test               # unit tests (Vitest)
pnpm test:emulated      # boots the Auth + Firestore emulators, then rules tests + Playwright e2e
pnpm emulators          # emulators only, for running pnpm test:rules or pnpm --filter @household-brain/web test:e2e against them
scripts/babysit-pr.sh <n>           # wait for the next CI result, slow run, conflict, comment or deploy (.ai/AGENTS.md)
pnpm exec firebase deploy --only hosting,firestore:rules,firestore:indexes   # manual fallback for CI
```

**Code rules**

- **Example and test domains use the reserved `.test` TLD** (RFC 2606), for example
  `owner@household-brain.test`, never `example.com` or a real-looking hostname.
- **`Date` is banned. Use `Temporal`.**
  - Due dates are calendar dates at 17:00 in `Europe/Berlin`, which is exactly what
    `Temporal.PlainDate` and `Temporal.ZonedDateTime` model. `Date` silently mixes UTC, local time
    and daylight-saving offsets.
  - oxlint enforces the ban with `no-restricted-globals`.
  - The first code that handles dates adds `temporal-polyfill`, pinned exactly, and loads it until
    every browser we target ships Temporal natively.
  - Convert at the edges only: Google Calendar's RFC 3339 strings go in and out through
    `Temporal.ZonedDateTime.from(...)` and `.toString()`.
- **oxlint runs every category as an error:** correctness, nursery, pedantic, perf, restriction,
  style and suspicious.
  - Individual rules are switched off only where they contradict each other or modern TypeScript.
    Each one carries its reason as a comment in `.oxlintrc.json`.
  - A rule is turned off there, with a reason, never with inline `oxlint-disable` comments.

**Emulators and end-to-end tests:**
- The Firestore emulator needs **Java 21**: install it with `brew install openjdk@21`. Playwright's
  browsers come from `pnpm exec playwright install chromium webkit`.
- Playwright runs every e2e test on three devices: desktop Chrome, an Android phone (Pixel 9, Chrome)
  and an iPhone 17 (Safari/WebKit). Install the browsers with
  `pnpm exec playwright install chromium webkit`.
- The emulators run as the `demo-household-brain` project. The `demo-` prefix makes them refuse
  to reach any real Google service.
- The emulator build of the app reads `.env.e2e` and adds a `window.e2eSignIn(email)` hook that
  signs in with an unsigned emulator token. Production builds don't contain that hook or any emulator wiring:
  - The emulator branch is compared inline, so Vite removes it.
  - `vite.config.ts` refuses a production build that has `VITE_USE_EMULATORS=true`.
  - CI fails if `apps/web/dist/` mentions `e2eSignIn` or an emulator address.

**CI:** `actions/setup-node` with `node-version-file: package.json` reads the `volta.node` pin. Then
`npm install -g "$(node -p "require('./package.json').packageManager")"` installs exactly the pnpm version
pinned in `packageManager`.
Third-party setup actions like `pnpm/action-setup` are deliberately not used: the allowed-actions
policy only permits GitHub-owned actions and `google-github-actions/*` ([repository](repository.md)).
