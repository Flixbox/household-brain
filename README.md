# Household Brain

A progressive web app for two people (me and my wife, **each with our own Google account**) that
keeps track of everything with a due date: expiring coupons, memberships and subscriptions, public transport tickets, warranties, contract notice periods, and so on.
Items are grouped by **category**, and within each category they are **sorted by due date**.

- **Google Calendar** is where the items live: one calendar I own and **share with my wife**. The app
  syncs with it in both directions, and Google Calendar sends both of us the reminders.
- **Firebase on the free Spark plan** provides login, live sync between devices, offline storage and
  hosting. **There is no backend server, no Cloud Functions and no secrets.**

---

## 1. Goals and non-goals

**Goals**

- An installable PWA (phone home screen and desktop) that works offline.
- Create, edit, complete and delete entries in the app. Every change lands in Google Calendar.
- Changes made in Google Calendar (web, phone app, voice assistant) show up in the app.
- Live updates: an edit on one device appears on the other within about a second.
- A category board: one section per category, items sorted by due date ascending, and overdue items
  flagged.
- Every entry is **due at 17:00** and notifies **both of us 2 days and 1 day before**, through each
  person's own Google Calendar app.
- A free and open source project in a **public repo**, with **no secrets** in code or CI.

**Non-goals (for v1)**

- No multi-household support and no roles. Two Google accounts with equal rights: the owner (me) and
  a member (my wife).
- No calendar grid UI (no week or month view).
- Changes made in Google Calendar are **not** picked up while the app is closed. They are pulled in
  the next time the app opens (§5.3). The reminders don't depend on this, because Google Calendar
  sends them itself.

---

## 2. Architecture

```
            ┌──────────────── PWA (Vite + React single-page app, vite-plugin-pwa) ────────────────┐
            │                                                                                      │
 my phone   │  Firebase Auth ──► uid            Firestore SDK                Google Calendar REST  │
 her phone  │  (Google sign-in)                 (offline cache,              (GIS access token,    │
 laptop     │                                    onSnapshot live)             fetch from browser)  │
            └──────────────┬────────────────────────────┬──────────────────────────┬───────────────┘
                           │                            │                          │
                    Firebase Auth               Cloud Firestore            Google Calendar API
                                                (rules: allowlisted uids)  "Household Brain" calendar
                                                                                   │
                                                                     reminders → Google Calendar app
                                                                                   on both phones
            Firebase Hosting serves the static files (<project>.web.app, free SSL)
```

| Concern | Solved by |
| --- | --- |
| Live sync between devices | Firestore `onSnapshot` listeners |
| Offline reads and writes | Firestore persistent local cache (IndexedDB), which queues writes automatically |
| Who may use the app | Firebase Auth plus Firestore security rules with an allowlist (§3) |
| Calendar writes | The browser calls the Google Calendar API directly with a short-lived access token |
| Calendar → app | Incremental sync with a `syncToken` whenever the app is open or visible (§5.3) |
| Notifications | Each person's default notifications on the shared calendar (§4.1) |
| Hosting | Firebase Hosting |

**Stack:** **Vite + React + TypeScript** (pnpm, Node through Volta, §9) as a plain single-page app, with **`vite-plugin-pwa`**
(Workbox: manifest, precaching, an "update available" prompt), **TanStack Router** (board, item
sheet, settings), Firebase JS SDK v11+ (`firebase/auth`, `firebase/firestore`), Google Identity
Services (the GIS token client), `rrule` (computing the next occurrence of repeating items),
Tailwind, shadcn/ui (Vite setup), and `nanostores` + `@nanostores/react` + `@nanostores/persistent`
for small UI preferences kept in `localStorage`.

**Why not Next.js:** on the free Spark plan the app can only be static files, because server-side
Next.js on Firebase needs the paid Blaze plan. A static export switches off everything Next.js adds
(server rendering, route handlers, middleware, server actions), and every component would be a
client component anyway, because Firebase, the GIS token client and IndexedDB only exist in the
browser. If the app ever needs server code, that is a different architecture, and the framework
decision gets revisited then.

---

## 3. Login and access control

### 3.1 Each person signs in with their own Google account

I sign in with my account, and my wife signs in with hers. Each device does two sign-ins:

1. **Firebase Auth** (`GoogleAuthProvider`, `signInWithPopup`) identifies the user to Firestore.
   This sign-in persists, so it happens once per device.
2. **The Google Identity Services token client** (`google.accounts.oauth2.initTokenClient`) gets a
   **Calendar access token** for the same account:
   - Scopes for everyone:
     - `https://www.googleapis.com/auth/calendar.events`: read and write events on calendars the
       user can edit. That includes the shared calendar. The narrower `calendar.app.created` is
       not used for events, because it is not clear it works on a calendar another account owns.
     - `https://www.googleapis.com/auth/calendar.calendarlist`: add the shared calendar to the
       user's own calendar list and set **that user's** default notifications on it (§4.1).
   - An extra scope for the owner, requested once during setup as an incremental grant
     (`include_granted_scopes: true`): `https://www.googleapis.com/auth/calendar.app.created`. It
     lets the app create the "Household Brain" calendar. It does **not** cover sharing: Google's
     `acl.insert` needs `calendar` or `calendar.acls`. Sharing is done once by hand instead (§4.1),
     so the app never asks for that extra sensitive permission.
   - The token is valid for about **1 hour** and is kept **in memory only**. No refresh token exists
     anywhere.
   - Renewal is silent (`prompt: ''`, `hint: <email from Firebase Auth>`) when Google's session
     cookie is present. Safari or iOS may occasionally show the account-chooser popup instead.
   - It is requested lazily: only when a Calendar call is about to happen and the token is missing
     or has less than 2 minutes left.

### 3.2 Firestore rules: the actual lock

The app shell on Firebase Hosting is public, but it contains no data. All data sits in Firestore
behind these rules:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    function allowed() {
      return request.auth != null
        && exists(/databases/$(db)/documents/allowlist/$(request.auth.uid));
    }
    // Read-only from the app: allowlist entries are managed only in the Firebase console.
    match /allowlist/{uid} { allow read: if request.auth != null && request.auth.uid == uid; }
    // Everything else, but never the allowlist (rules are OR'd, so the catch-all must exclude it).
    match /{collection}/{document=**} {
      allow read, write: if collection != 'allowlist' && allowed();
    }
  }
}
```

- The allowlist has **one document per person**, `allowlist/<my uid>` and `allowlist/<her uid>`,
  **created by hand in the Firebase console**. Her uid appears in Firebase Auth → Users after her
  first sign-in. That way no email address or uid sits in the public repo, and a fork deploying these
  rules locks out everyone until its owner adds their own uids.
- **The app can't change the allowlist.** No rule allows writing to `allowlist`, so even an
  allowlisted account, if hijacked, can't add another user. Only the console, which bypasses the
  rules, can.
- If a signed-in user is not on the allowlist, the app shows "This account has no access".
- Optional hardening: **App Check** with reCAPTCHA v3, so other origins can't burn Firestore quota.

### 3.3 Google Cloud setup (once)

The Firebase project **is** a Google Cloud project, so everything below happens in it.

- Enable the **Google Calendar API**.
- OAuth consent screen: External, with the app name and support email. **Publish it to "In
  production"** to avoid weekly re-consent in Testing mode. An unverified app is fine for personal
  use: you click through the "unverified app" warning once.
- OAuth client type: **Web application**. Authorised JavaScript origins: the Firebase Hosting domains
  (`<project>.web.app` and `<project>.firebaseapp.com`) and `http://localhost:5173` (the Vite dev
  server). No
  redirect URI is needed for the token client.
- In Firebase Auth, enable the Google provider. Set `authDomain` to `<project>.web.app`, the same
  origin the app is served from, so sign-in keeps working in iOS standalone PWAs. There is no custom
  domain.

---

## 4. How items are stored

### 4.1 In Google Calendar (what the reminders depend on)

- **Owner setup (once, on my device):** the app creates a dedicated calendar, **"Household Brain"**,
  with time zone `Europe/Berlin`, and stores its id in `meta/config.calendarId`.
  - If an earlier attempt already created a "Household Brain" calendar that I own, the app reuses it,
    so I never end up with two.
- **Sharing, once, by hand:** in Google Calendar → Settings → *Household Brain* → *Share with
  specific people*, add my wife's account with *Make changes to events*. Settings shows these steps
  to the owner. The app doesn't share by itself, because that would need the `calendar.acls`
  permission.
- **Member onboarding (once, on her device):** after she signs in, the app reads `calendarId` from
  Firestore and calls `calendarList.insert({ id: calendarId, defaultReminders })`. The calendar then
  appears in her Google Calendar app with her default notifications (below), without her accepting
  an email invite.
- **One event per item.** The **event id is generated by the client** before anything is written:
  base32hex, 26 characters, from a ULID or UUID. The same id is the Firestore document id. That
  makes inserts **idempotent**: a retried insert returns `409 Conflict`, which is treated as success.
- **Due time is fixed:** `start = <dueDate>T17:00:00`, `end = <dueDate>T17:15:00`, with
  `timeZone: "Europe/Berlin"` on both.
- **Reminders: each person's default notifications on the shared calendar.** Google Calendar keeps
  reminders **separately for each user**: the `reminders` I write on an event only notify me. So the
  app does not put reminders on events. Instead:
  - Every event is written with `"reminders": { "useDefault": true }`.
  - Each user's calendar-list entry for the shared calendar gets these default notifications, set by
    that user's own device with `calendarList.patch`:

    ```json
    "defaultReminders": [
      { "method": "popup", "minutes": 2880 },
      { "method": "popup", "minutes": 1440 }
    ]
    ```

  - Result: **every** event on the calendar notifies **both of us** 2 days and 1 day before, both at
    17:00, on our own phones. That includes events created directly in Google Calendar.
  - Each device checks its own user's `defaultReminders` on start and resets them if someone changed
    them.
- **Title:** `[Coupon] Amazon 10€`. The category prefix keeps entries readable in Google Calendar,
  and the app strips it for display.
- **Colour:** each category maps to a Google `colorId`.
- **App fields** go in `extendedProperties.private`:

  | Key | Example | Notes |
  | --- | --- | --- |
  | `hb.category` | `coupon` | Category slug |
  | `hb.status` | `open` / `done` / `cancelled` | |
  | `hb.amount` / `hb.currency` | `9.99` / `EUR` | Optional |
  | `hb.code` | `SUMMER25` | Coupon code, member number, … |
  | `hb.url` | `https://…` | |
  | `hb.noticeDays` | `30` | Notice period, which gives a "cancel by" date |
  | `hb.v` | `1` | Schema version |

- **Notes** go in the event `description`.
- **Repeating items** (memberships, which include subscriptions, and season tickets) use an `RRULE` on the event. The reminders sit on
  the series, so every occurrence gets them.

### 4.2 In Firestore (the live mirror the UI reads)

```
allowlist/{uid}                      {}                          ← created by hand
meta/config                          { calendarId, timeZone: "Europe/Berlin", ownerUid }
syncState/{uid}                      { syncToken, lastSyncAt }   ← one per person (sync tokens are per user)
categories/{slug}                    { slug, label, colorId, sortOrder }   ← an icon comes with the board UI
items/{eventId}                      {
  title, category, dueDate: "YYYY-MM-DD", rrule?: string,
  status, amount?, currency?, code?, url?, notes?, noticeDays?,
  etags?: { [uid]: string },         // last known Google etag, per user (an event's etag can differ
                                     //   between users because reminders are per user)
  sync: "synced" | "pending" | "error",
  pendingOp?: "upsert" | "delete",
  dirty: string[],                   // fields changed locally since the last successful push
  syncError?: string,
  updatedAt: serverTimestamp, updatedBy: deviceId
}
```

- `dueDate` holds the **next occurrence** for repeating items. The client recomputes it with `rrule`
  when a series' date passes.
- The default categories are seeded on first run. They can be edited in Settings.

  | Slug | Label | Covers |
  | --- | --- | --- |
  | `coupon` | Coupon | Vouchers, gift cards, discount codes |
  | `membership` | Membership | Memberships **and subscriptions** (streaming, gym, clubs, software) |
  | `transit` | Public transport | Monthly and annual passes, season tickets |
  | `warranty` | Warranty | Warranty and return deadlines |
  | `contract` | Contract | Phone, internet, energy, rental contracts |
  | `insurance` | Insurance | |
  | `document` | Document expiry | ID card, passport, licences |

---

## 5. Sync

### 5.1 Principle: pull first, then write

Google Calendar can change underneath the app: the other person edits from their phone, or someone
edits in Google Calendar directly. So **every push to Google is preceded by a pull**. The write is
then based on the latest state, conflicts are merged locally before anything is sent, and a
`412 Precondition Failed` becomes a rare race instead of the normal case.

There is **one pull routine** (§5.3), and it is **single-flight**: if a pull is already running,
callers wait for it, and a pull that finished less than 3 seconds ago is reused, not repeated. That
keeps "pull before every write" cheap even when several edits happen in a row.

### 5.2 Creating, editing or deleting an entry in the app

1. **Write to Firestore immediately**, with `sync: "pending"`, `pendingOp: "upsert"` or `"delete"`,
   and the changed field names added to `dirty` (for example `["dueDate", "code"]`). Thanks to the
   offline cache this works offline. Both devices' `onSnapshot` show the change at once, with a small
   "syncing" dot.
2. The **outbox worker** picks the item up:
   1. **Pull** (single-flight, §5.3). If Google has a newer version of this event, the pull already
      merges it into the pending doc: fields in `dirty` keep the local value, every other field takes
      Google's value, and `etags.<myUid>` is updated.
   2. **Push:**
      - New item: `events.insert` with the client-generated id, 17:00–17:15 Europe/Berlin,
        `reminders.useDefault: true`, the category title prefix and colour, the `hb.*` properties,
        and an `RRULE` if it repeats. A `409 Conflict` means it already exists, so it is treated as
        success.
      - Edited item: `events.patch` with **only the `dirty` fields** (plus the title prefix and
        colour if the category changed), and `If-Match: <etags[myUid]>`.
      - Deleted item: `events.delete`, where 404 and 410 count as success. Then delete the
        Firestore doc.
   3. On success: copy every field of Google's reply into the entry (it includes changes made in
      Google meanwhile), set `etags.<myUid>`, `googleUpdated`, `sync: "synced"` and `dirty: []`. The
      dot disappears on both devices.
   4. If a `412` still happens (someone edited between the pull and the push): re-read the event and
      patch once more against its current etag; the local edits win, and recording Google's reply
      (step 3) brings in the rest. If the re-read shows the event was deleted in Google, restore it.

**Outbox worker details**

- It runs on each device while the app is visible and a Google token is available. It listens with
  `onSnapshot(query(items, where("sync","==","pending")))`, and pushes one item at a time, oldest
  first.
- Both devices may try the same item. That is safe, because inserts are idempotent through the
  client-generated id, and patches are guarded by the etag.
- Errors: 401 triggers a silent token refresh and a retry. 403 or 429 retries with exponential
  backoff. Anything else sets `sync: "error"`, shows the item with a retry button, and stores the
  message.

### 5.3 Google Calendar → app (the pull)

There is no webhook, because that needs a server. The pull runs at exactly two moments:

1. **Before every push** from the outbox (§5.2), so writes are based on the latest state.
2. **Every 60 seconds while the app is visible.** The timer fires immediately when the app starts or
   comes back to the foreground, and then once a minute. It pauses while the app is hidden.

Both go through the single-flight routine, so they never run twice at the same time.

Both need Google access on the device: a Calendar token, which only a click can provide. Until a
device has one, the sync bar says "Not synced with Google Calendar on this device yet" and offers
**Sync now**. Saving an entry also asks for access, during the click. A pull that just ran is reused
for 3 seconds, so a burst of triggers causes one pull.

**The routine**

- **Incremental sync:** `events.list(calendarId, syncToken, showDeleted: true)` with this user's
  token from `syncState/{uid}`. Follow the `pageToken`s until a `nextSyncToken` arrives, then store
  it back in `syncState/{uid}`. Each user has their own sync token.
  - `410 Gone` means the token has expired. Run a **full sync**: list everything, rebuild `items`,
    and delete docs whose event no longer exists.
  - When nothing has changed, it is one small request, so once a minute per open device is well
    inside the Calendar API quota.
- **No lease between devices.** Both devices may pull at the same time. That is safe, because every
  Firestore write from a pull is an idempotent upsert, and normalisation patches are guarded by the
  etag, so the loser just gets a 412 and skips.
- **For each changed event:**

  | Event | Firestore doc | Action |
  | --- | --- | --- |
  | etag equals `etags[myUid]` | any | Skip it, because it is our own echo |
  | changed | `synced` or missing | Map the event to an item, normalise it (below), and write it |
  | changed | `pending` upsert | Merge: `dirty` fields keep the local value, all others take Google's. Update `etags.<myUid>`. Stays `pending` |
  | `cancelled` | `synced` | Delete the doc |
  | `cancelled` | `pending` upsert | Skip. The push then finds the event cancelled (on 404/410, or on a 412 whose re-read shows `status: "cancelled"`) and restores it: insert, or patch `status: "confirmed"` plus the full item |
  | `cancelled` | `pending` delete | Delete the doc |

- **Not touched at all:** repeating events (`recurrence` or `recurringEventId`), until repeating
  entries exist; and events older than what the entry already has (`updated` ≤ `googleUpdated`).
- **Events put in by hand** (no `hb.category` and no `[Label]` prefix naming a category, e.g. a
  birthday) are shown under **Uncategorised** but never rewritten in Google.
- **One event that can't be adjusted** (say Google rejects the patch) is reported in the sync bar and
  skipped; the rest of the pull, and the sync token, go ahead.
- **Normalisation:** events created or changed directly in Google Calendar are brought back into
  shape with one etag-guarded `events.patch` per event:
  - The start is not 17:00 Europe/Berlin, or it is an all-day event: keep the date, set
    17:00–17:15.
  - The event has its own reminder overrides instead of `useDefault: true`: reset it. This only
    affects the reminders of the user whose device runs the pull, because reminders are per user.
    The other person's are fixed when their device pulls.
  - There is no `hb.category` but the title starts with a `[Label]` naming a category: record that
    category and add its colour. Without such a prefix the event is one added by hand: it is shown
    as uncategorised and not adjusted at all.

  Before writing, these fixes are applied to the mapped item, so the UI never shows the
  un-normalised state.

### 5.4 Offline behaviour

- The app shell is precached by the Workbox service worker that `vite-plugin-pwa` generates.
  A new deploy shows an "Update available, reload" toast (`registerType: 'prompt'`). Firestore's persistent cache serves the last state
  immediately.
- Offline edits sit in the Firestore write queue, and then appear as `pending`. The outbox worker
  pushes them to Google once the device is online and has a token.
- The header shows "Offline", or "3 changes not yet in Google Calendar".

---

## 6. UI

**Category board (home)**

- One collapsible section per category, ordered by `sortOrder`. The header shows the icon, the
  label, the open count, a badge such as "2 due this week", and a **"+" that preselects the
  category**.
- **All categories are expanded by default.** Collapsing is a per-device preference:
  - It lives in a nanostores `persistentAtom` from `@nanostores/persistent`, stored in
    `localStorage` under `hb:collapsed`.
  - It stores the **collapsed** category slugs, as a JSON array. Anything not listed is expanded, so
    new categories, a fresh device, or cleared storage all start fully expanded.
  - It is not synced through Firestore: each person and device keeps their own view.
  - If `localStorage` is unavailable (private mode, blocked storage), it falls back to in-memory
    state, which means everything is expanded.
  - Slugs of deleted categories are pruned on load.
- Items are sorted by `dueDate` ascending, with ties broken by title.
- Each card shows the title, the relative due date ("tomorrow, 17:00", "in 5 days", "overdue by 2
  days") plus the absolute date, the amount, and the code with a copy button.
- Urgency colours: **overdue from 17:00 on the due date** is red, within 7 days is amber, anything
  else is neutral.
- Memberships and contracts with `noticeDays` also show **"cancel by <dueDate − noticeDays>"**.
- `done` and `cancelled` items are hidden behind a "Show completed" toggle. Swiping marks an item
  done; long-pressing edits it.
- There is a global search and an "All by date" flat-list toggle.

**Add / edit sheet**

- Fields: title, category (chips), **due date (date only, always 17:00)**, repeat (none / monthly /
  yearly / custom), amount, code, link, notes, notice period.
- There is **no reminder or time field.** Every entry gets 17:00 and the 2-day and 1-day
  reminders.
- A floating "+" opens it with no category preselected.

**Settings:** categories (add, rename, reorder, icon, colour), **"Share with your household"**
(owner only: the steps for sharing the calendar in Google Calendar), a "Notifications: 2 days + 1 day before ✓"
status for the current user (re-applied if it drifts), a reconnect-Google button, a sync status
panel (last sync, pending and error counts, "Full resync"), and sign out.

**PWA:** `manifest.webmanifest` with `display: standalone`, regular and maskable icons, light and
dark themes, and a `share_target`, so a coupon email or screenshot text can be shared into the add
sheet. iOS needs an "Add to Home Screen" hint.

---

## 7. Free-tier fit (Spark plan)

| Resource | Free limit | Expected use |
| --- | --- | --- |
| Firestore reads | 50,000 / day | A few hundred |
| Firestore writes | 20,000 / day | Dozens |
| Firestore storage | 1 GiB | Under 1 MB |
| Hosting storage / transfer | 10 GB / 360 MB per day | A few MB |
| Auth | Free for Google sign-in | 2 users |
| Google Calendar API | 1,000,000 queries / day per project | Hundreds |

The project never needs the Blaze plan, because it uses no Cloud Functions, no Cloud Storage and no
scheduled jobs.

---

## 8. Repository, CI/CD and secrets

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

---

## 9. Toolchain

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
policy only permits GitHub-owned actions and `google-github-actions/*` (§8).

---

## 10. Project layout

An **Nx** workspace on **pnpm** workspaces. Packages are consumed as TypeScript source, their modules
exported by path (no barrel files); only the app is built.

```
household-brain/
├─ apps/web/                      # the PWA: Vite + React, routes, PWA config, e2e tests
│  ├─ src/main.tsx, src/routes/   # thin route files rendering what the packages export
│  ├─ src/components/             # app chrome for now: sign-in gate, update prompt
│  ├─ e2e/                        # Playwright against the Firebase emulators
│  ├─ .env.production, .env.e2e   # public Firebase config; emulator-only config
│  └─ vite.config.ts, playwright.config.ts, pwa-assets.config.ts, public/
├─ packages/calendar/             # the calendar feature (@household-brain/calendar)
│  └─ src/
│     ├─ lib/calendar/            # Google Calendar API, household setup, sharing
│     ├─ lib/items/               # entries: model, event mapping, outbox push, pull, Firestore
│     ├─ lib/google-token.ts      # GIS token client
│     └─ components/              # entry list/form, settings sections, sync bar
├─ packages/firebase/             # Firebase app, Auth, Firestore, env checks (@household-brain/firebase)
├─ tests/rules/                   # Firestore security-rules tests
├─ firestore.rules, firestore.indexes.json, firebase.json   # hosting serves apps/web/dist
├─ nx.json, pnpm-workspace.yaml, package.json               # workspace root
├─ .oxlintrc.json, npmpackagejsonlint.config.ts, .gitleaks.toml
├─ scripts/babysit-pr.sh
├─ .github/workflows/ci.yml, .github/dependabot.yml
└─ .ai/AGENTS.md (AGENTS.md, CLAUDE.md link to it)
```

## 11. Milestones

1. **Setup:** create the Firebase project, enable Calendar API, Auth and Firestore, write the rules
   and allowlist doc, set up the OAuth client, and get Hosting deploying from CI through WIF.
2. **Auth:** Firebase Google sign-in, the GIS token client, the "no access" screen.
3. **Calendar bootstrap:** the owner creates the "Household Brain" calendar, seeds the categories,
   and shares the calendar with the second account. The member's device adds it to her calendar
   list. Each device sets its own user's default notifications to 2 days and 1 day before.
4. **Write path:** the add/edit sheet, Firestore-first writes, the outbox worker, idempotent insert,
   etag patch with merge, delete.
5. **Board UI:** category sections, sorting, urgency colours, "cancel by" markers, the completed
   toggle.
6. **Pull path:** single-flight pull, pull-before-push and the 60 s timer, incremental and full sync,
   echo skip, merging into pending docs, normalisation.
7. **PWA:** vite-plugin-pwa, update prompt, offline banner, install hint, share target.
8. **Polish:** repeating items, search, the settings screen, App Check.

---

## 12. Decisions

- No custom domain: the app is served at `<project>.web.app`.
- Licence: Unlicense.
- Categories: coupon, membership (which includes subscriptions), public transport, warranty,
  contract, insurance, document expiry. There is no vehicle category.
- Freshness: pull before every write, plus every 60 seconds while the app is visible. Nothing else
  triggers a pull.
