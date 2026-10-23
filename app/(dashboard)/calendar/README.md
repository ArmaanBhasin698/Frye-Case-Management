# app/(dashboard)/calendar

Firm calendar. `page.tsx` renders month / week / day / agenda views over the
existing `CalendarEvent` model (recurrence expanded at read time) plus matter
`Deadline`s as all-day items, via `lib/calendar/queries.ts#getCalendarItems`.
View, date, and filters live in the URL (`?view=week&date=2026-10-23&matterId=…`).

- `events/new` — create (optionally `?matterId=` pre-linked, `?date=`).
- `events/[eventId]` — detail with Join / Copy meeting-link actions and cancel.
- `events/[eventId]/edit` — edit the whole event (or whole series).

Authorization: `lib/calendar/access.ts` — matter-linked events follow matter
access; matterless (internal) events are visible to ADMIN, their creator, and
their staff attendees. Every write re-checks this plus matter, attendee, and
contact ids server-side (`lib/calendar/actions.ts`). Times are stored in UTC
with the event's IANA zone; the grid renders in `FIRM_TIME_ZONE`
(America/New_York). Meeting links are user-entered, https-only, never created
through a provider API.
