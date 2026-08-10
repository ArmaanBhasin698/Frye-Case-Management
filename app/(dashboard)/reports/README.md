# app/(dashboard)/reports

Firm-wide Reports route. `page.tsx` is a real, authorized operational
reporting aggregate over the existing per-matter `Task`/`Deadline`/
`Document`/`DiscoveryFile`/`DiscoveryProduction`/`Call`/`Note` rows
(`lib/reports/queries.ts#getFirmReportSummary`) — not a new record, a
business-intelligence platform, or an export/integration project. Every
count and breakdown is scoped server-side the same way Tasks/Calendar/
Communications/Discovery already are: an ADMIN sees firm-wide totals,
everyone else only totals over matters they're assigned to.

Reports only shows what the current schema actually proves: operational
counts (active matters, task/deadline/document/discovery/call totals and
status breakdowns) and a short recent-activity window. It does not show
financial, billing, settlement, win-rate, case-outcome, or time-entry
metrics — none of that data exists in the schema yet (see
`docs/DATA_MODEL.md`). Date-window filtering uses the server's local time
zone, the same convention `lib/dashboard/queries.ts` and
`lib/calendar/queries.ts` already use — no separate time zone framework
was introduced for this.

See `docs/ROADMAP.md`'s Phase 7 entry and `docs/SECURITY.md`'s
Authorization section for the full write-up.
