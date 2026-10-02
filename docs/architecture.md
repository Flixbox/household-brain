# Architecture

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
| Who may use the app | Firebase Auth plus Firestore security rules with an allowlist ([access](access.md)) |
| Calendar writes | The browser calls the Google Calendar API directly with a short-lived access token |
| Calendar → app | Incremental sync with a `syncToken` whenever the app is open or visible ([sync](sync.md#google-calendar--app-the-pull)) |
| Notifications | Each person's default notifications on the shared calendar ([storage](storage.md#in-google-calendar-what-the-reminders-depend-on)) |
| Hosting | Firebase Hosting |

**Stack:** **Vite + React + TypeScript** (pnpm, Node through Volta, [toolchain](toolchain.md)) as a plain single-page app, with **`vite-plugin-pwa`**
(Workbox: manifest, precaching, updates applied when the app leaves the screen), **TanStack Router** (board, item
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

## Free-tier fit (Spark plan)

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
