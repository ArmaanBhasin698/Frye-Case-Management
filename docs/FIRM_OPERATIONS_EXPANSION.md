# Firm Operations Expansion — Architecture & Delivery Plan

Status: **Phase 1 (Contacts) merged (#27). Remaining scope implemented on `feature/firm-operations-complete` and in review — see section 7.**
This document is the single source of truth for the multi-phase
"Comprehensive Firm Operations Expansion" initiative (contacts, professional
history, matter closure, calendar, time tracking, usage reporting, team
chat, Slack scaffolding). Each phase ships as its own feature branch and
pull request; this file is updated in the same PR as each phase lands.

All data in development and tests is fictional (CLAUDE.md, section 2).

## 1. Baseline (verified October 2026, `main` @ `f7c6cd3`)

- 59 Vitest files / 728 tests pass; `npm run lint` and `npm run typecheck`
  are clean.
- No `Contact`, `MatterContact`, time, chat, activity, or closure models
  exist. `Call.contactName` is free text.
- `CalendarEvent` exists but requires a `matterId`, has no meeting URL,
  attendees, all-day flag, or time zone; `/calendar` is a filtered list
  over `Deadline` + `CalendarEvent`, not a grid.
- A matter can be set to `CLOSED` directly from the edit form
  (`lib/matters/actions.ts#updateMatter`) — no closure workflow.
- `AuditEvent` is the immutable audit trail; `FailedLoginAttempt` +
  `SecurityIncident` back the security center. No successful-login,
  session, or page-access records exist.
- `pdf-lib` is already a dependency (used by `lib/discovery/pdf.ts`), so
  PDF reports need no new package.
- Authorization: `lib/auth/authorization.ts` (pure rules) and
  `lib/auth/access.ts` (Prisma-backed `matterScopeFilterFor`,
  `hasMatterAccess`, `canEditMatter`, `canManageMatterTeam`). Every new
  module reuses these; none introduces a parallel permission system.

## 2. Cross-cutting design principles

1. **Matter access is the root of confidentiality.** Anything derived from a
   matter (roles in it, rulings, closure reports, time entries, matter
   channels, events) is visible only through `hasMatterAccess` /
   `matterScopeFilterFor`. Profile pages, search, counts, and aggregates
   are computed **after** applying that filter — never "count everything,
   then hide rows." Hidden matters are never counted or hinted at.
2. **References, not copies.** Professional-history views (judge,
   prosecutor, opposing counsel) are queries over matter-owned rows
   (`MatterContact`, `JudicialRuling`, `ProfessionalObservation`), not
   duplicated summary tables. Idempotency keys prevent duplicate rulings.
3. **Facts vs. opinions are separate types.** `JudicialRuling` (a recorded
   court decision) and `ProfessionalObservation` (an attorney's note,
   with an explicit `kind`: PROCEDURAL_OBSERVATION vs. SUBJECTIVE_IMPRESSION)
   are different models and are rendered with different labels. No
   generated conclusions about fairness, bias, or predicted outcomes.
4. **Corrections never silently overwrite.** Closure reports, rulings, and
   observations are versioned: an amendment creates a new revision row
   that supersedes the previous one; the old revision stays readable.
5. **Audit metadata never contains privileged text.** `AuditEvent.metadata`
   records ids, field names, and enum values only — never note bodies,
   observation text, chat messages, or time-entry descriptions.
6. **Usage analytics ≠ billable time.** `UserSession`/`UserActivityEvent`
   (inferred, labelled "estimated") and `TimeEntry` (attorney-entered work)
   share no table and never convert into one another.
7. **No new runtime dependencies** unless separately approved. Chat
   "real-time" uses short polling; PDFs use `pdf-lib`; calendar grids are
   hand-built with `date-fns` (already installed).
8. **No external connections.** Slack is interface + settings screen only;
   meeting links are user-entered URLs; nothing calls Zoom/Teams/Slack.

## 3. Data model (as designed; implemented — see `docs/DATA_MODEL.md` for the final shape)

Names below are proposals. Every model gets a purpose comment in
`schema.prisma`, per CLAUDE.md section 6.

### Phase 1 — Contacts
- `Contact` — firm-wide person/organization record. `kind`
  (INDIVIDUAL | ORGANIZATION), name fields, `organizationId` (self-relation
  to an ORGANIZATION contact), `jobTitle`, `categories ContactCategory[]`
  (multi-valued, the criminal-defense list in the requirements),
  structured mailing address, `preferredContactMethod`, `notes`,
  `assignedStaffId`, `lastContactedAt` (visibility is derived — see 4.1),
  `clientId @unique` (optional link to the existing `Client`; current vs.
  former client is **derived** from that client's matter statuses, never
  stored), `court`/`jurisdiction`/`position` (nullable, used by
  professional profiles in Phase 2), reversible `archived` fields,
  `createdById`, timestamps.
- `ContactPhone`, `ContactEmail` — multiple labelled values, one primary.
- `MatterContact` — many-to-many contact↔matter with `role`, free-text
  `roleDetail`, `startDate`/`endDate`, and a soft `removedAt` so removing a
  contact from a matter keeps the history and never deletes the contact.
  `@@unique([matterId, contactId, role])`.
- `ContactRelationship` — contact↔contact with `type`, `scope`
  (PERMANENT | MATTER), optional `matterId`, `context`.
- `ContactInteraction` — manual interaction log (CALL, MEETING, EMAIL,
  NOTE, COURT_APPEARANCE, CONSULTATION, FOLLOW_UP) with staff member,
  optional matter, summary, outcome, follow-up status.
- `Call.contactId` (nullable FK) — so existing manual call logging appears
  on the contact timeline without duplicating `Call` rows.
- Clients: `createClient` creates the linked `Contact` in the same
  transaction; an idempotent dev-only backfill script links contacts to
  existing (fictional) clients.

### Phase 2 — Professional history
- `JudicialRuling` — `matterId`, `judgeContactId`, `rulingDate`, court /
  proceeding, `issueType` (MOTION_TO_SUPPRESS, MOTION_TO_DISMISS,
  BOND_MODIFICATION, EVIDENCE_ADMISSIBILITY, DISCOVERY, CONTINUANCE,
  SENTENCING, PROBATION, JURY_INSTRUCTION, OTHER), `result` (GRANTED,
  DENIED, PARTIALLY_GRANTED, WITHDRAWN, MOOT, OTHER), context, optional
  `documentId`, `recordedById`, revision fields, and an idempotency key
  (`@@unique([matterId, judgeContactId, rulingDate, issueType, sourceKey])`).
- `ProfessionalObservation` — `subjectContactId`, optional `matterId`,
  `authorId`, `category`, `kind` (PROCEDURAL_OBSERVATION |
  SUBJECTIVE_IMPRESSION), `body`, `references`, `shareScope`
  (MATTER_ONLY | FIRM_ATTORNEYS — see 4.2), revision chain
  (`supersedesId`), timestamps.
- Prosecutor/solicitor/opposing-counsel history is a query over
  `MatterContact` roles + `MatterClosureReport` + observations — no extra
  tables.

### Phase 3 — Matter closure
- `MatterClosureReport` — one current revision per matter (`revision`,
  `supersedesId`, `status` DRAFT | SUBMITTED | AMENDED), closing attorney,
  closure date, `disposition` (DISMISSAL, ACQUITTAL, CONVICTION,
  PLEA_AGREEMENT, DIVERSION, NOLLE_PROSEQUI, DEFERRED_ADJUDICATION,
  ADMINISTRATIVE_CLOSURE, OTHER), outcome date, procedure flags
  (trial / plea / dismissal / other), outcome summary, charges, judge /
  prosecutor / opposing-counsel contact references, `noSignificantRulings`
  explicit confirmation, `exceptionReason` (for documented administrative
  or incomplete-history closures), `isHistoricalBackfill`.
- `TrialOutcome` — 1:1 with a closure report when it went to trial: dates,
  bench/jury, counsel, charges tried, `verdicts` (per-charge JSON validated
  by Zod), evidentiary issues, significant motions, sentencing, summary,
  lessons learned.
- `Matter.closureReviewStatus` (NOT_REQUIRED | NEEDS_BACKFILL | COMPLETE)
  so pre-existing closed matters are visibly flagged, never fabricated.
- Rulings and observations captured during closure are ordinary
  `JudicialRuling` / `ProfessionalObservation` rows tied to the matter —
  that is the "automatic historical linking."
- `updateMatter` stops accepting `status = CLOSED`; closing goes only
  through `closeMatter`, inside one transaction (validate → write report
  and rulings → set status/closedDate → audit). Reopening is an explicit
  audited action.

### Phase 4 — Calendar
- Extend `CalendarEvent` (no new event model): `matterId` becomes
  nullable (internal meetings), add `description`, `allDay`, `timeZone`,
  expanded `type` values, `status`, `meetingUrl`, `meetingProvider`,
  `reminderMinutesBefore`, `createdById`.
- `CalendarEventAttendee` (user) and `CalendarEventContact` (contact) join
  tables. Recurrence: deferred to a later approval, explicitly (see 6).
- Events without a matter are visible to their creator, attendees, and
  admins; events with a matter keep the existing matter-scope rule.

### Phase 5 — Time tracking
- `TimeEntry` — matter, user, work date, `durationMinutes`, optional
  start/end, `category`, description, `billable`, optional
  `hourlyRateCents` (amounts ADMIN-only — see 6), `status` (DRAFT | SUBMITTED),
  timestamps.
- `ActiveTimer` — at most one running timer per user
  (`userId @unique`), `matterId`, `startedAt`, `pausedAt`, accumulated
  seconds. Stopping converts it into a DRAFT `TimeEntry` the user confirms;
  an orphaned timer is recovered on next page load, never silently
  committed.

### Phase 6 — Usage & security
- `UserSession` — one row per authenticated session (keyed by a session
  id added to the JWT): login time, last heartbeat, end time and reason
  (LOGOUT, EXPIRED, REVOKED, UNKNOWN), estimated active seconds.
- `UserActivityEvent` — append-only usage events (LOGIN_SUCCESS,
  LOGOUT, PAGE_VIEW, MATTER_VIEW, DOCUMENT_DOWNLOAD, REPORT_EXPORT, …)
  with module, safe resource id, optional matter id, result. Never
  content. Failed logins stay in `FailedLoginAttempt`.
- Heartbeat: a lightweight Route Handler called every 60 s from visible,
  focused tabs; active time is the union of heartbeat intervals across
  tabs/devices (overlaps merged, gaps > idle threshold excluded) and is
  always labelled "estimated."
- Retention: a documented, configurable retention window (proposed
  365 days) with an ADMIN-only purge action.

### Phase 7 — Team chat
- `ChatConversation` — `type` (CHANNEL | DIRECT | GROUP), name /
  description (channels), optional `matterId`, `createdById`,
  `participantKey @unique` (sorted member ids, so a DM/group DM for the
  same people is reused, never duplicated).
- `ChatMembership` — `conversationId`, `userId`, `lastReadAt`, `leftAt`.
- `ChatMessage` — author, body, `editedAt`, `deletedAt` (soft delete),
  optional `parentId` (threads), optional `documentId` reference.
- Rules: group DM ≤ 5 participants, membership fixed after creation;
  channel membership managed by creator/ADMIN; matter channels require
  `hasMatterAccess` on **every read**, so losing matter access ends
  access to that channel immediately. Updates via 5–10 s polling (no new
  real-time dependency).

### Phase 8 — Slack scaffolding
- `lib/integrations/slack/` — `SlackClient` interface + a
  `DisconnectedSlackClient` that always reports NOT_CONNECTED; config read
  from placeholder env vars documented in `.env.example`. No OAuth
  endpoint, no network calls.
- Settings card under `/admin` showing status, planned capabilities, and
  configuration requirements. No sync controls. Persisted channel/user
  mappings (`SlackIntegrationConfig`) are added only when a real connection
  is authorized.

## 4. Confidentiality model for contacts and professional history

### 4.1 Contact visibility (decided: strict matter-only)
- Every contact — including judges, prosecutors, and other professionals —
  is visible only to ADMIN, to the user who created it, and to users who
  can access at least one matter the contact is (non-removed) associated
  with. There is no firm-wide directory tier.
- The **Associated Matters**, relationships, and interactions sections
  list only rows on matters the viewer can access, with no count of hidden
  rows.
- Duplicate-contact warnings only ever compare against contacts the
  current user can already see, so a warning never reveals that a
  restricted person exists. Consequence: non-admin users can create a
  duplicate of a contact they cannot see; ADMIN sees every contact and the
  admin duplicate view is the remedy (a merge tool is a tracked follow-up).

### 4.2 Professional-history layers
| Layer | Example | Who sees it |
|---|---|---|
| General professional info | Judge's court, jurisdiction, phone | Per 4.1 (matter-scoped) |
| Shareable observation | "Requires courtesy copies of motions 48 h before hearing" | ATTORNEY + ADMIN who can see the contact (per 4.1), when author marked FIRM_ATTORNEYS |
| Matter-specific record | Rulings (all fields), closure report, MATTER_ONLY observation | Users with access to that matter only (decided: no anonymized cross-matter ruling summaries) |
| Source documents | Order PDF, transcripts | Normal document authorization |

Aggregates (counts by issue type/result) on a profile are computed only
over rows the viewer may see, always show the sample size and date range,
and are titled "Frye recorded history" — never percentages presented as
predictions.

## 5. Delivery sequence

| # | Branch | Scope | Needs approval |
|---|---|---|---|
| 0 | `docs/firm-operations-expansion-plan` | This document | — |
| 1 | `feature/contacts` | Phase 1 schema, `lib/contacts`, `/contacts` list/detail/forms, matter Contacts tab, duplicate warnings, tests — **PR open (ArmaanBhasin698/Frye-Case-Management#27), not merged** | Approved 2026-10-23 |
| 2 | `feature/professional-history` | Rulings, observations, judge/prosecutor/counsel profile sections, cross-matter views, aggregates | Schema + migration |
| 3 | `feature/matter-closure` | Closure workflow, trial report, linking, amendments, reopen, backfill flags | Schema + migration |
| 4 | `feature/calendar` | Month/week/day/agenda grid, event CRUD, meeting links, matter/contact links | Schema + migration |
| 5 | `feature/time-tracking` | Manual entries, timers, matter time dashboard | Schema + migration |
| 6 | `feature/usage-reports` | Sessions, activity events, heartbeat, Usage & Reports, security center links, 3 PDFs | Schema + migration; auth-callback changes |
| 7 | `feature/team-chat` | Channels, matter channels, DMs, group DMs, search, unread | Schema + migration |
| 8 | `feature/slack-scaffolding-and-integration` | Slack interface/settings, dashboard widgets, nav, docs, regression pass | — |

Each phase: focused tests → full `npm run test` → `lint` → `typecheck` →
`build` → browser check against a local dev database with fictional
seed data → PR. Nothing merges without explicit authorization.

## 6. Decisions

Recorded 2026-10-23 from the project owner:

1. **Contact visibility** — strict matter-only (section 4.1).
2. **Rulings** — strict matter access; no anonymized summaries for users
   outside the source matter. Only observations the author marks
   FIRM_ATTORNEYS cross matter boundaries.
3. **Billing rate** — `TimeEntry` stores an optional hourly rate; computed
   monetary amounts are shown to ADMIN only. No invoices, statements, or
   payment features (CLAUDE.md's billing/invoicing prohibition still
   applies).
4. **Recurring events** — deferred (tracked here), one-off events first.
5. **Activity-data retention** — 365 days by default, ADMIN-only purge.
6. **Phase 1 schema** — approved as proposed in section 3.
7. **Consolidated delivery** — on 2026-10-23 the owner consolidated phases
   2–8 into one branch (`feature/firm-operations-complete`) with a scoped
   approval for one coordinated additive migration
   (`20261023163942_firm_operations_expansion`). The only relaxation is
   `CalendarEvent.matterId` becoming nullable (internal meetings).

## 7. Requirements checklist

Legend: **TESTED** = implemented with automated tests (and browser-checked
where noted "B"); **IMPLEMENTED** = implemented, covered indirectly;
**PARTIAL** = some of the requirement remains; **NOT STARTED**.

| Area | Requirement | Status |
|---|---|---|
| Contacts | Directory, categories, phones/emails, associations, relationships, interactions, search/filters, duplicates (#27) | TESTED (B) |
| Judicial history | Judge profile: court, jurisdiction, position, contact info, current/previous matters | TESTED (B) |
| | Ruling history: matter, judge, date, court, proceeding, motion type, result, context, supporting document, recorder, created date | TESTED (B) |
| | Ruling corrections / version history (supersede, never overwrite) | TESTED |
| | Hearing/trial history and case outcomes on profile | TESTED (B) |
| | Filters: date, court, proceeding, motion, result, matter | TESTED (B) |
| | Aggregates as counts with sample size/date range, no predictions | TESTED (B) |
| | Prosecutor/solicitor/opposing counsel: cases, outcomes, observations, communication history (interaction timeline) | IMPLEMENTED (B, judge path) |
| | Observations: author, date, matter, category, kind (observation / impression / lesson), references | TESTED (B) |
| | Matter-restricted default; firm-wide only by explicit sharing with no-privilege confirmation and no matter link | TESTED |
| | No cross-matter leaks via profiles, filters, counts, search, documents | TESTED (B) |
| Matter closure | Structured Close Matter replaces direct status edit | TESTED (B) |
| | Required fields, disposition incl. administrative exception, non-trial resolutions | TESTED (B) |
| | Trial report only for trials (dates, bench/jury, charges, verdict by charge, rulings, sentencing, summary, observations) | TESTED |
| | Significant rulings confirmation (recorded / none / documented exception), observation review | TESTED (B) |
| | Transactional: report, ruling links, observations, status, audit | TESTED (B) |
| | Amendments (versioned), reopen (audited), historical backfill (flagged, never fabricated) | TESTED |
| Calendar | Month / week / day / agenda, prev/next, Today, view switcher, date selection | TESTED (B) |
| | Event create/edit/cancel, detail page, categories, matter/staff/type filters | TESTED (B) |
| | Attendees, linked contacts, time zones, all-day, reminders (in-app) | TESTED |
| | Recurrence (daily/weekly/monthly, interval, until/count) | TESTED — no per-occurrence exceptions (documented) |
| | Meeting URL validation, provider recognition, Join (safe), Copy | TESTED (B) |
| | Matter appointments tab; history after closure; contact meeting history | IMPLEMENTED (B, matter tab) |
| | "Schedule meeting with this contact" prefill | PARTIAL — event form links contacts; no prefill from profile |
| Time | Manual entries, start/pause/resume/stop timers, persistence, 12h interruption handling, one timer per user | TESTED (B) |
| | Categories, descriptions, billable flag, optional rates (amounts ADMIN-only), corrections, void | TESTED |
| | Matter Time & Activity: totals, billable/nonbillable, by staff, by category, over time, history | TESTED (B) |
| | Closed matters retain entries; no billable inference from usage; no invoicing | TESTED |
| Usage | Sessions (start, last activity, end/reason, expiry), login/logout events | TESTED |
| | Matter access, document/discovery downloads, access denials, report exports | TESTED |
| | Note/task/contact/calendar/admin modifications (derived from AuditEvent, not duplicated) | IMPLEMENTED |
| | Heartbeat with idle detection, multi-tab/device de-duplication, estimates labelled | TESTED |
| | Admin usage dashboard with filters; security-center integration | TESTED (B) |
| | 365-day retention, ADMIN purge with confirmation, preservation hold | TESTED |
| | Session IP address / user agent | PARTIAL — not captured (sign-in callback lacks the request) |
| PDFs | Matter Time, Employee Activity, Firm Utilization; branding, multipage, totals | TESTED (B) |
| | Server-side authorization before generation | TESTED (B) |
| Chat | Channels (matter/team/department/general/topic), description, membership management | TESTED (B) |
| | DMs, group DMs (≤ 5, fixed membership, participant-set reuse) | TESTED (B, DM) |
| | Matter channels with per-request matter re-check (revocation) | TESTED (B) |
| | History, search (authorized only), unread state, dashboard notification | TESTED (B) |
| | Edit own, soft delete, matter/document references (re-authorized), safe rendering | TESTED |
| | Reply threads | PARTIAL — validated server-side; no reply UI |
| | Refresh | IMPLEMENTED — 5 s polling, no new dependency |
| Slack | Provider interface, OAuth boundary, workspace/user/channel/matter mapping design, notification interface, settings card, Not Connected | TESTED (B) |
| Integration | Matter tabs (Contacts, Rulings & Outcome, Deadlines & Calendar, Time & Activity, Chat), dashboard cards, navigation, header timer | IMPLEMENTED (B) |

