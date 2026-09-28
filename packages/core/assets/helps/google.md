# The `google` tool — Calendar, Tasks and Drive

One tool, one `kind` per operation, against the Google account the user linked
on this machine. The refresh token is stored locally in `~/.config/mulmo/` and
goes only to Google, to mint access tokens — never to claude.ai or any other
service. This works with no claude.ai Google connector involved.

Call `kind: "status"` when unsure whether the account is linked. If a call fails
with "Google account not linked", ask the user to link it in settings and retry
the original call — do not fall back to guessing.

## Two mechanisms, different jobs

| You want | Use |
| --- | --- |
| Read or change specific events / tasks / files, right now | this tool |
| A collection that mirrors a calendar and keeps itself fresh | a `googleCalendar` block — see [Google Calendar sync](google-calendar-collection.md) |
| Records the user added/edited in a calendar collection to reach Google | the collection view's **Push to Google** button, not this tool |

The collection route costs no tokens per refresh, so prefer it for anything
recurring. Use this tool for one-off work, and for deleting — the push button
never deletes.

## Calendar

Events default to the user's **primary** calendar. Pass `calendarId` — obtained
from `calendarListCalendars` — to target another.

| kind | What it does |
| --- | --- |
| `calendarListCalendars` | The calendars the user has added/subscribed to: `id`, `summary`, `primary`, colours, `accessRole` |
| `calendarColors` | Palettes mapping a `colorId` to hex, for events and for calendars |
| `calendarListEvents` | Upcoming events. Optional `calendarId`, `timeMin`, `maxResults` (1-50, default 10) |
| `calendarSync` | Only what CHANGED since the last sync, via a stored token. Returns counts plus a capped sample |
| `calendarCreateEvent` | Create, timed or all-day. Requires `summary`, `start`, `end`; optional `description`, `calendarId`, `colorId` |
| `calendarUpdateEvent` | Edit in place. Requires `eventId` + at least one of `summary`, `start`, `end`, `description`, `colorId` |
| `calendarDeleteEvent` | Delete. Requires `eventId` |

**A timed event's ends must carry a timezone offset** —
`2026-07-17T09:00:00+09:00`, not `2026-07-17T09:00:00`. Calendar rejects an
offset-less value with an opaque 400. The same goes for `timeMin`.

**An all-day event takes a bare date on BOTH ends** — `start: "2026-07-17"`,
`end: "2026-07-18"`. Its `end` is **exclusive**: it is the day AFTER the last
day, so a single day on the 17th ends on the 18th, and a three-day event
starting the 17th ends on the 20th. This is Google's own convention and the
values it reports back, so do not "correct" it.

One end of each kind is rejected. Editing an all-day event needs **both** ends —
a lone date is refused, because whether the stored event is all-day cannot be
told from the argument.

**Editing is a patch.** Fields you omit keep their current value, so changing a
title needs `eventId` + `summary` and nothing else. `description: ""` clears the
body. Moving one end of an event still has to leave the start before the end.

**`eventId` comes from `calendarListEvents` or `calendarSync`** — never invent
one. For a recurring event those kinds return per-occurrence ids, so editing or
deleting one affects that single occurrence.

**Deleting is not reversible** and removes the event for every attendee. Confirm
with the user before calling `calendarDeleteEvent`, and say which event you are
about to remove.

## Tasks

Operate on the user's default task list unless `taskListId` is given.

| kind | What it does |
| --- | --- |
| `taskListsList` | The user's task lists (`id`, `title`). Only needed for a non-default list |
| `tasksList` | List tasks. Optional `taskListId`, `maxResults` (1-50, default 10), `showCompleted` (default false) |
| `tasksCreate` | Add a task. Requires `title`; optional `notes`, `due`, `taskListId` |
| `tasksUpdate` | Edit. Requires `taskId` + at least one of `title`, `notes`, `due`. `notes: ""` clears them; `due` can be changed but **not** cleared |
| `tasksComplete` | Mark done. Requires `taskId` |
| `tasksDelete` | Delete. Requires `taskId` — not reversible, so confirm first |

`tasksUpdate` does not change status: `tasksComplete` owns that transition.

**Google stores a DATE only for `due`** — the time part is accepted and then
ignored, so never promise the user a time of day on a task.

## Drive

In practice this app sees **only the files it created itself**, never the user's
wider Drive. Never claim to have searched their Drive.

(The `drive.file` scope also covers files the user hands to an app through a
Google Picker, but this app has no Picker — so app-created is the whole set.)

| kind | What it does |
| --- | --- |
| `driveList` | Files this app created. Optional `maxResults` (1-50, default 10) |
| `driveCreate` | Create a text file. Requires `name`, `content`; optional `mimeType` (default `text/plain`) |
| `driveRead` | Read one of this app's files. Requires `fileId`. Text only |

## Failure modes

- **"Google account not linked"** — the user has not linked, or the token was
  revoked. Ask them to link in settings; do not retry blindly.
- **HTTP 403 naming an API** — that API is not enabled for the user's Cloud
  project. The message says which one.
- **HTTP 400 on a create/update** — almost always a date-time without an offset,
  or a start that is not before the end.
- **HTTP 410 on delete** — the event was already gone.
