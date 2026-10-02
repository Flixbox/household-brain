# Repository, CI/CD and secrets

- **Public repo, FOSS.** Licence: **Unlicense** (public domain).
- **Nothing in the repo is secret:**
  - The Firebase web config (`apiKey`, `projectId`, …) is public by design and protected by the
    rules. It is supplied at build time as `VITE_FIREBASE_*` so forks can point it at their
    own project. Defaults live in `apps/web/.env.production`, which is fine to commit.
  - The browser API key is additionally **restricted in Google Cloud**:
    - Websites: only `https://household-brain-sf.web.app/*`, `https://household-brain-sf.firebaseapp.com/*`,
      `http://localhost:5173/*` and `http://localhost/*`.
    - APIs: only Identity Toolkit, Secure Token, Firestore and App Check.

    A copied key can't be used from other sites, or for any other Google API.
  - The OAuth client id is public by design.
  - `firestore.rules` contains no personal data, because the allowlist lives only in the database.
- **CI: GitHub Actions** on GitHub-hosted runners, in the public repo
  [Flixbox/household-brain](https://github.com/Flixbox/household-brain). Public repos get unlimited
  free minutes on standard runners.
  One workflow, `ci.yml`, triggered by `push` to `main` and by `pull_request`. Workflow
  permissions are `contents: read`. It has three jobs:

  | Job | What it runs |
  | --- | --- |
  | `checks` | oxlint (with `@stylistic`), typecheck, unit tests (Vitest), `vite build`, and `gitleaks` over the whole history |
  | `e2e` | Runs in Microsoft's Playwright container image (browsers preinstalled). The Firebase Auth and Firestore emulators, then Firestore security-rules tests (`@firebase/rules-unit-testing`), then Playwright end-to-end tests against an emulator build of the app |
  | `deploy` | Only on `push` to `main`, after both other jobs pass. Uses `environment: production` and `id-token: write`, and runs `firebase deploy --only hosting,firestore:rules,firestore:indexes` |
  - **Never use the `pull_request_target` or `workflow_run` triggers.** Both run code with the base
    repository's privileges.
- **The deploy uses no stored secret.** It authenticates through **GitHub OIDC → Google Workload
  Identity Federation**:
  - The deploy job has `permissions: { id-token: write, contents: read }`.
    `google-github-actions/auth` exchanges the GitHub OIDC token for a short-lived token of a
    deploy service account. That account has exactly four roles:
    - Firebase Hosting Admin
    - Firebase Rules Admin
    - Cloud Datastore Index Admin (`firebase deploy --only firestore:indexes`)
    - Service Usage Consumer (the Firebase CLI checks enabled APIs)
  - The WIF provider's attribute condition only accepts tokens with
    `assertion.repository_id == "<numeric id>"`, `assertion.ref == "refs/heads/main"` and
    `assertion.environment == "production"`. The numeric repository id survives renames and can't
    be claimed by a re-created repository of the same name.
  - A fork PR never gets an OIDC token from this repository with that ref and environment, so Google
    rejects it. There is no secret to steal.
- **Repository settings (already applied, 2026-10-01):**

  | Setting | Value | Effect |
  | --- | --- | --- |
  | Fork PR workflow approval | **Require approval for all external contributors** | No workflow runs for a PR from anyone without write access until the owner clicks "Approve and run" |
  | Default `GITHUB_TOKEN` permissions | **Read-only**; Actions may not approve PRs | A workflow can't push or approve unless the workflow file explicitly asks |
  | Allowed actions | **GitHub-owned plus `google-github-actions/*` only** | A PR can't pull in arbitrary third-party actions |
  | SHA pinning | **Required** | Every action must be pinned to a full commit SHA, so a moved tag can't inject code. Dependabot keeps the pins current |
  | Environment `production` | **Deployable from `main` only** | A workflow on any other branch can't enter the environment, so it can't get a deploy token (the WIF condition checks the same thing) |
  | Ruleset "Protect main" | **No deletion, no force-push** | The history of `main` can't be rewritten |

- **Ground rules:**
  - Only the owner has write access.
  - Review a fork PR's diff, **including changes under `.github/`**, before clicking "Approve and
    run".
  - Never add self-hosted runners to this public repo.
  - Optional extra: add the owner as a required reviewer on the `production` environment, so every
    deploy waits for a click.
