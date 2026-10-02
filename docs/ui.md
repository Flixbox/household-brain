# UI

**Top bar and menu:** every signed-in page has a top bar with the app's name and a menu button. It
opens a drawer from the right (a modal dialog) with **Entries**, **Settings** and **Sign out**. The
shell owns the bar, the drawer and "Sign out"; the app passes in its links.

**Category board (home)**

- One collapsible section per category, ordered by `sortOrder`. The header shows the icon, the
  label, the open count, a badge such as "2 due this week", and a **"+" that preselects the
  category**.
- Each category has a coloured line down its left, from its heading to its last entry, in the
  category's Google Calendar event colour (`colorId`), so the app matches the calendar.
- **All categories are expanded by default.** Collapsing is a per-device preference:
  - It lives in a nanostores `persistentAtom` from `@nanostores/persistent`, stored in
    `localStorage` under `hb:collapsed`.
  - It stores the **collapsed** category slugs, as a JSON array. Anything not listed is expanded, so
    new categories, a fresh device, or cleared storage all start fully expanded.
  - It is not synced through Firestore: each person and device keeps their own view.
  - If `localStorage` is unavailable (private mode, blocked storage), it falls back to in-memory
    state, which means everything is expanded.
  - Slugs of deleted categories are pruned on load.
- Items are sorted by their next date: a passed due date first (the entry is overdue), otherwise the
  first of the due date and the extra dates from today on, or the last once all have passed; with ties broken by title. The row shows that date, and "+
  more" when the entry has other dates.
- Each card shows the title; under it the price in slightly smaller text (only when an amount is set; a
  plain number as euros, e.g. "9,99 €", anything else as typed), the category in mixed lists, and the code; on the right the relative
  due date ("tomorrow, 17:00", "in 5 days", "overdue by 2 days") plus the absolute date.
- Urgency colours: **overdue from 17:00 on the due date** is red, within 7 days is amber, anything
  else is neutral.
- Memberships and contracts with `noticeDays` also show **"cancel by <dueDate − noticeDays>"**.
- `done` and `cancelled` items are hidden behind a "Show completed (n)" toggle, a per-device preference
  (`hb:show-completed`, `@nanostores/persistent`), off by default. Swiping an open entry to
  the left marks it done, with "Undo" for a few seconds; tapping an entry edits it.
- A search field above the categories finds entries by title, code, notes, link or amount (every
  word must match; case and accents are ignored). While searching it lists every match, completed
  ones included, only in categories that have a match, and those open even if folded. It isn't
  remembered across reloads.
- An "All by date" toggle shows every listed entry in one list by due date, each labelled with its
  category, instead of the categories. A per-device preference (`hb:by-date`), off by default;
  search and "Show completed" apply to it too. Its header has a "+" that opens the add sheet without
  a category.

**Add / edit sheet**

- Fields: title, category (chips), **due date (date only, always 17:00)**, more dates (optional,
  each with a label such as "Cancel by" or "Valid from" and a date; for now they live in the app
  only, without reminders: #34), an optional start date
  (not after the due date; the row shows "since …" or, while still ahead, "from …"), status (open / done /
  cancelled; when editing only, a new entry is open), repeat (none / monthly /
  yearly / custom), amount, code, link, notes, notice period.
- There is **no reminder or time field.** Every entry gets 17:00 and the 2-day and 1-day
  reminders.
- It opens from a category's "+", with that category preselected. There is no separate "add" button.

**Settings:** categories (add, rename, reorder, icon, colour), **"Share with your household"**
(owner only: the steps for sharing the calendar in Google Calendar), a "Notifications: 2 days + 1 day before ✓"
status for the current user (re-applied if it drifts), a reconnect-Google button, a sync status
panel (last sync, pending and error counts, "Full resync"). (Sign out is in the menu.)

**PWA:** `manifest.webmanifest` with `display: standalone`, regular and maskable icons, light and
dark themes, and a `share_target`, so a coupon email or screenshot text can be shared into the add
sheet. iOS needs an "Add to Home Screen" hint.
