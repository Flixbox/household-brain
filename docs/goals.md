# Goals and non-goals

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
  the next time the app opens ([sync](sync.md#google-calendar--app-the-pull)). The reminders don't depend on this, because Google Calendar
  sends them itself.
