# Sync

## Principle: pull first, then write

Google Calendar can change underneath the app: the other person edits from their phone, or someone
edits in Google Calendar directly. So **every push to Google is preceded by a pull**. The write is
then based on the latest state, conflicts are merged locally before anything is sent, and a
`412 Precondition Failed` becomes a rare race instead of the normal case.

There is **one pull routine** ([sync](#google-calendar--app-the-pull)), and it is **single-flight**: if a pull is already running,
callers wait for it, and a pull that finished less than 3 seconds ago is reused, not repeated. That
keeps "pull before every write" cheap even when several edits happen in a row.

## Creating, editing or deleting an entry in the app

1. **Write to Firestore immediately**, with `sync: "pending"`, `pendingOp: "upsert"` or `"delete"`,
   and the changed field names added to `dirty` (for example `["dueDate", "code"]`). Thanks to the
   offline cache this works offline. Both devices' `onSnapshot` show the change at once, with a small
   "syncing" dot.
2. The **outbox worker** picks the item up:
   1. **Pull** (single-flight, [sync](#google-calendar--app-the-pull)). If Google has a newer version of this event, the pull already
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

## Google Calendar → app (the pull)

There is no webhook, because that needs a server. The pull runs at exactly three moments:

1. **Before every push** from the outbox ([sync](#creating-editing-or-deleting-an-entry-in-the-app)), so writes are based on the latest state.
2. **Every 60 seconds while the app is visible.** The timer fires immediately when the app starts or
   comes back to the foreground, and then once a minute. It pauses while the app is hidden.
3. **When an entry is opened for editing**, skipping the reuse window below, so the form catches up
   with Google. The form opens at once; when the pull brings a newer version, every field not edited
   yet takes it, and edited fields keep their value (and win when saved).

All go through the single-flight routine, so they never run twice at the same time.

All need Google access on the device: a Calendar token, which only a click can provide. Until a
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
- **An extra date's event** (one with `hb.entry`, #34) never becomes an entry: the pull skips it, and
  removes a stray entry an older app version may have made from it (in Firestore only). Each app
  writes `syncState/{uid}.schema = 2` to say it knows these events.
- **Writing date events** (`date-events.ts`, `date-outbox.ts`): every extra date gets its own event,
  `<entryId>d<dateId>`, titled `[Category] Title · Label`, at 17:00 on its date, with the entry's
  notes and private properties plus `hb.entry`, `hb.date`, `hb.label`.
  - **Gate:** only while **every** `syncState/{uid}` has `schema >= 2`, as the server reports it (not
    the local cache). Every app version writes that document on its first pull, so a person on an
    older version closes the gate, live. **When someone leaves the household**, delete their
    `syncState/{uid}` along with their allowlist entry, or an old marker of theirs can keep it closed.
  - Only extra dates whose event id has the date-event shape: an entry that came from Google keeps
    that event's id, which may be longer, so its extra dates stay in the app.
  - **Ledger:** `items/{id}.dateEvents.<dateId>.shape` is the event as last written. `planDates`
    compares it with the entry and plans an upsert (new date, moved, relabelled, or a shared field
    changed) or a delete (date removed). The outbox writes one per step, after the entry's own event is
    synced and no local change waits.
  - **Upsert:** insert; on 409, a full patch against the etag just read (which also revives an event
    deleted in Google). The app is the only source of a date event: changes made to it in Google are
    not adopted (#34, step C).
  - **Refused** (not transient): the shape is recorded with the error, so it is retried only once the
    entry changes. **Deleting an entry** deletes its date events first (recorded ones and its current
    dates; a missing one is fine).
  - **Leftovers:** the pull deletes a date event in Google whose entry is gone (deleted in Google, or
    by an app version from before date events), or whose entry neither has that date nor knows the
    event (an insert that landed unrecorded). The entry is read from the server, not the cache, and
    one about to be deleted or with the date's delete still planned is left to the push
    (`isOrphanDate`).
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

## Offline behaviour

- The app shell is precached by the Workbox service worker that `vite-plugin-pwa` generates.
  A new deploy is installed in the background (checked on start, hourly and whenever the app comes back on screen) and applied when the app leaves the screen, so old builds become rare. Not while a form has unsaved edits or a Google window is open (`data-hold-updates`): then the next time; while the app is on screen a toast offers to reload now (`ReloadPrompt` in `packages/shell`). Firestore's persistent cache serves the last state
  immediately.
- Offline edits sit in the Firestore write queue, and then appear as `pending`. The outbox worker
  pushes them to Google once the device is online and has a token.
- The header shows "Offline", or "3 changes not yet in Google Calendar".
