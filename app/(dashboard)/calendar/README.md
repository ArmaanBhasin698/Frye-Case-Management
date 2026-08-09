# app/(dashboard)/calendar

Firm-wide Calendar route. `page.tsx` is a real, authorized aggregate view
over the existing per-matter `Deadline` and `CalendarEvent` rows
(`lib/calendar/queries.ts#getFirmWideCalendarItems`) — not a new calendar
entity. See `docs/ROADMAP.md`'s "Firm-wide Tasks & Calendar" milestone and
`docs/SECURITY.md`'s Authorization section for the full write-up.
