# Login and access control

## Each person signs in with their own Google account

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
       user's own calendar list and set **that user's** default notifications on it ([storage](storage.md#in-google-calendar-what-the-reminders-depend-on)).
   - An extra scope for the owner, requested once during setup as an incremental grant
     (`include_granted_scopes: true`): `https://www.googleapis.com/auth/calendar.app.created`. It
     lets the app create the "Household Brain" calendar. It does **not** cover sharing: Google's
     `acl.insert` needs `calendar` or `calendar.acls`. Sharing is done once by hand instead ([storage](storage.md#in-google-calendar-what-the-reminders-depend-on)),
     so the app never asks for that extra sensitive permission.
   - The token is valid for about **1 hour**. It is kept in `localStorage` (`hb:calendar-token`,
     through `@nanostores/persistent`), so a reload or reopening the app within that hour needs no
     click; sign-out clears it. It is tied to the account the app requested it for (the signed-in
     person's email, passed to Google as a hint) and never used for another signed-in person, even if
     a Firebase session ends without our sign-out. Google may still let someone pick a different
     account in its chooser; the app doesn't verify which one issued the token. Its deadline is wall-clock
     time (`Temporal.Now`, via `temporal-polyfill`), not `performance.now()`, which stops while some
     phones sleep. No refresh token exists anywhere. The trade-off: script injected into
     the page could read a calendar-only token that expires within the hour.
   - Renewal is silent (`prompt: ''`, `hint: <email from Firebase Auth>`) when Google's session
     cookie is present. Safari or iOS may occasionally show the account-chooser popup instead.
   - It is requested lazily: only when a Calendar call is about to happen and the token is missing
     or has less than 2 minutes left.

## Firestore rules: the actual lock

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
- **New sign-ups are off** in Firebase Authentication (since 2026-10-02, once both of us had signed
  in): no new account can be created at all. To add a person, switch sign-up on in the console, let
  them sign in once, allowlist their uid, and switch it off again.
- Optional hardening: **App Check** with reCAPTCHA v3, so other origins can't burn Firestore quota.

## Google Cloud setup (once)

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
