# Roadmap

This roadmap sequences the work from groundwork to a functioning system. It
intentionally avoids dates — pace depends on one developer's available time.
Each phase should be fully usable/stable before starting the next.

## Phase 0 — Groundwork (this session)

- [x] Inspect the repository.
- [x] Decide and document architecture direction (Next.js, TypeScript,
      PostgreSQL, Prisma, shadcn/ui).
- [x] Write `CLAUDE.md` and the `docs/` folder
      (`PROJECT_PLAN.md`, `ARCHITECTURE.md`, `DATA_MODEL.md`,
      `SECURITY.md`, `ROADMAP.md`).
- [x] Design core entities and relationships.
- [x] Create initial folder structure (empty scaffolding).
- [x] Create `.gitignore` and `.env.example`.
- [x] Write project README.
- [ ] **Not done yet, deliberately:** any actual application code, Next.js
      project initialization, Prisma schema, or dependencies.

## Phase 1 — Application bootstrap

- [x] Initialize the actual Next.js + TypeScript project (`package.json`,
      config files) matching the folder structure in
      `docs/ARCHITECTURE.md`.
- [x] Set up Prisma with a local PostgreSQL instance; create the initial
      schema (User, Client, Matter, MatterAssignment, plus Note, Task,
      Deadline, DiscoveryProduction/File, Document, Call, AuditEvent — see
      "Milestone" note below).
- [ ] Set up Auth.js with credentials-based login and role field. **Not
      done.** There is no login yet — the app is fully open to anyone who
      can reach it. Do not deploy anywhere but a developer's own machine
      until this lands.
- [x] Install and configure shadcn/ui + Tailwind.
- [ ] Basic *authenticated* app shell. A dashboard shell (sidebar + topbar)
      exists and is used, but it is not gated by login — see above.

**Exit criteria not yet met:** a developer can run the app and browse
matters, but cannot yet "log in" because there is nothing to log into.

## Milestone — Matters read-only vertical slice (second session)

Built ahead of strict phase order, as the first small end-to-end UI slice
requested for this project: a professional dashboard shell, a Matters list,
and a Matter detail view with Overview/Discovery/Documents/Calls/Notes/
Tasks/Deadlines/Timeline tabs, all reading from a real Postgres database
seeded with fictional data. This intentionally pulls a thin, read-only
layer from several later phases (3, 4, 5) forward — see each phase below
for exactly what's still missing from that phase's full scope. In
particular:

- No create/edit/delete forms exist anywhere yet — everything shipped this
  session is read-only.
- No authentication or matter-level authorization exists — see Phase 1.
- `AuditEvent` rows are seeded for the Timeline tab demo, not produced by
  live writes, since there are no writes yet.

## Milestone — Visual demo polish (third session)

Purpose-built for a firm demo: a dashboard homepage, a "command center"
Matter overview, a showcase Discovery tab, a richer Calls tab, and a
Kanban-style Tasks board. Still no create/edit forms, auth, or real
integrations — this is presentation polish over the same read-only slice,
plus a few schema additions pulled forward from later phases specifically
to make the demo data richer and more honest:

- Added `CalendarEvent` (Phase 3) so "upcoming court dates" are real rows,
  not just Deadlines wearing a court-date costume.
- Added `DiscoveryProduction.reviewStatus` and the `DiscoveryComparison`/
  `DiscoveryFileMatch` tables (Phase 4) to show a New/Changed/Duplicate/
  Missing comparison view. The rows are hand-seeded to look plausible —
  there is no hashing/diffing engine behind them yet (see Phase 4 below).
- The Tasks tab is now a drag-and-drop Kanban board
  (`components/shared/task-board.tsx`). Dragging a card updates on-screen
  state only; there's no Task-update Server Action yet, so moves don't
  survive a refresh.
- The Calls tab now shows the firm-wide "unfiled calls" pool with a mocked
  "Attach to Matter" button (`components/shared/attach-call-list.tsx`).
  Clicking it only changes local component state — no write happens.
- The Matter Overview has a "Quick actions" row (Add Note / Log a Call /
  Upload Document / New Task). Clicking any of them shows an inline
  "coming soon" message instead of a form — there's nothing to submit to
  yet.
- Every one of the above is called out in-app (banners, badges, helper
  text) so a demo viewer — or the next developer — can't mistake mocked
  interactivity for a finished feature.

## Phase 2 — Clients & Matters (CRUD + authorization)

- [ ] Client CRUD (create/list/view/edit) with server-side validation.
- [x] Matter *read* (list + detail) — done in the milestone above.
- [ ] Matter create/edit/delete with server-side validation.
- [x] `MatterAssignment` exists in the schema and is displayed (assigned
      staff shown on Matter overview), but there's no UI to change
      assignments yet.
- [ ] Matter-level authorization: users only see matters they're assigned
      to, unless admin. **Not possible yet — there's no auth (see Phase
      1), so every matter is visible to everyone.**
- [ ] AuditEvent wired in as a side effect of real writes (currently only
      seeded — see milestone above).

**Exit criteria:** a staff member can create a client, open a matter for
them, assign staff to it, and have that access properly restricted and
audited.

## Phase 3 — Case workflow essentials

- [ ] Notes on a matter — *read-only view shipped; no create/edit form.*
- [ ] Tasks (assignable, with status/priority) on a matter — *read-only
      Kanban board shipped (drag-and-drop is UI-only, not persisted); no
      create/edit form or a real status-update action.*
- [ ] Deadlines on a matter, with a simple upcoming-deadlines view —
      *read-only view shipped; no create/edit form.*
- [x] Calendar events on a matter. `CalendarEvent` model exists and is
      shown (Matter Overview's "Upcoming key dates", Dashboard's "Upcoming
      court dates & deadlines") — still no create/edit form.
- [ ] A per-matter timeline/activity view combining the above — *read-only
      view shipped, but it reflects seed data, not live audit events (see
      milestone note above).*

**Exit criteria:** day-to-day case management (notes, tasks, deadlines,
calendar) works without MyCase for a pilot matter.

## Phase 4 — Discovery management (core differentiator)

- [ ] `DiscoveryProduction` and `DiscoveryFile` CRUD. *Read-only
      production/file listing shipped, now with review status
      (`NOT_STARTED`/`IN_REVIEW`/`COMPLETE`) and file-type icons; no create/
      edit/upload UI, and no Bates numbering or media identifier logic.*
- [ ] Standardized Dropbox folder-structure convention per matter
      (documented in a new `docs/DISCOVERY.md` once designed).
- [ ] Bates numbering for PDFs (apply to a copy; preserve the original).
- [ ] Consistent identifier scheme for video/audio/photo files.
- [ ] Content hashing on ingest to support later comparison.
- [ ] Discovery production comparison (new/changed/duplicate/missing)
      across two productions. *`DiscoveryComparison`/`DiscoveryFileMatch`
      tables and a visual comparison view shipped (see milestone above),
      but the rows are hand-seeded — no hashing/diffing engine runs this.*

**Exit criteria:** discovery for a pilot matter can be received, numbered,
organized, and a re-served production compared against the original.

## Phase 5 — Communications (groundwork for Vonage)

- [ ] Generic `Communication` logging (manual entry first — no Vonage yet).
      **Not started** — the schema only has `Call`, not the more general
      `Communication` entity from `docs/DATA_MODEL.md`; add it if/when
      email/SMS/letter logging is needed.
- [ ] `Call` entity and UI for manually logging/filing a call to a matter,
      as a stand-in for the eventual Vonage sync. *`Call` model and a
      Calls tab shipped, including an "unfiled calls" pool with a mocked
      Attach-to-Matter button (see milestone above); attaching only
      updates on-screen state — there's still no real log/flag/file
      action or Task-status-update Server Action.*

**Exit criteria:** the data model and UI for communications are proven out
manually before any Vonage API work begins.

## Phase 6 — Integrations (Dropbox, Vonage)

- [ ] Dropbox integration behind `lib/storage/DocumentStore`: link matter
      folders, browse/upload/reference files from the app.
- [ ] Vonage integration behind `lib/telephony/CallProvider`: pull call/SMS
      history, support flagging and filing a real call to a matter, save
      recordings into the matter's Dropbox structure.
- [ ] Re-run the security checklist in `docs/SECURITY.md` specifically for
      these integrations (scoped tokens, encrypted storage of credentials,
      audit logging of integration actions) before enabling them with real
      data.

**Exit criteria:** the "search a call, flag it, attach to client/matter,
save recording" workflow described in the project goals works end-to-end.

## Phase 7 — Reporting & polish

- [ ] Reporting views (caseload by attorney, upcoming deadlines firm-wide,
      discovery status, etc.).
- [ ] Full audit/activity history views per matter and firm-wide (admin).
- [ ] UI/UX polish pass.

## Later / not yet scheduled

- [ ] Loop/HighLevel intake handoff (bring a new client from lead → Matter
      automatically or semi-automatically).
- [ ] monday.com replacement for tasks/workflows firm-wide (if still
      desired once native Tasks are in daily use).
- [ ] QuickBooks Online integration for billing/accounting.
- [ ] Migrating any historical data out of MyCase (only after the
      replacement is trusted in daily use on new matters).
- [ ] MFA for staff logins.
- [ ] Formal backup/disaster-recovery testing.

## Explicitly deferred (do not build until asked)

Per the current project phase, the following should **not** be started
without explicit direction from the firm:

- Any live third-party integration (Dropbox, Vonage, Loop/HighLevel,
  MyCase, QuickBooks).
- Billing/invoicing features.
- Real data migration of any kind.
- A fully built-out UI in one pass — build and stabilize one phase at a
  time.
