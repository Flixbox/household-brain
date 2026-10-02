# Milestones

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
