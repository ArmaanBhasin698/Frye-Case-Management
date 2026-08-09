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
- [x] Set up Auth.js with credentials-based login and role field. Done in
      the fourth session (see "Milestone — Authentication & matter-level
      authorization" below) — Auth.js v5, Credentials provider, fictional
      dev users, roles from the existing `UserRole` enum.
- [x] Install and configure shadcn/ui + Tailwind.
- [x] Basic *authenticated* app shell. The dashboard shell (sidebar +
      topbar) is now gated by `proxy.ts` and shows the logged-in user's
      name, role, and a sign-out control.

**Exit criteria met:** a developer can clone the repo, seed fictional
users, and log in to a dashboard scoped to what that user is allowed to
see.

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

## Milestone — Authentication & matter-level authorization (fourth session)

Narrowly scoped to real security foundation, deliberately not bundled with
any new feature or integration:

- Auth.js v5 (Credentials provider, JWT sessions) — `lib/auth/config.ts`.
  Fictional dev users only; no OAuth/SSO provider configured.
- Five seeded users covering all four roles (`ADMIN`, `ATTORNEY`,
  `PARALEGAL`, `STAFF`) with deliberately varied `MatterAssignment` rows —
  see README's demo credentials table. Taylor Brooks (STAFF) is assigned
  to exactly one matter specifically to make the access boundary visible
  in a demo.
- `proxy.ts` gates every route except `/login` on "is anyone logged in."
- Matter-level authorization enforced server-side in
  `app/(dashboard)/matters/[matterId]/layout.tsx` (denies via `notFound()`,
  not a distinguishable "access denied" page) and in every cross-matter
  read (`lib/dashboard/queries.ts`, `lib/matters/queries.ts`). The core
  decision logic is pure and unit-tested
  (`lib/auth/authorization.ts` / `tests/auth/authorization.test.ts`).
- Login page, logout control, and the current user's name + role in the
  top nav — replacing the old "Dev preview — no login yet" badge, which is
  no longer true.
- Everything from the second and third sessions (dashboard, Discovery
  showcase, Kanban board, Attach-to-Matter) is unchanged in behavior, now
  simply gated behind a real login and scoped to what the logged-in user
  may see.

**Deliberately not done here** (see docs/SECURITY.md's "Implementation
status" section for the full list): MFA, login rate-limiting/lockout,
forced sign-out on assignment change, HTTPS enforcement, and any actual
write path (so `AuditEvent` is still seeded, not generated — authorization
for writes will need the same treatment once Server Actions exist).

## Milestone — First persistent write paths (fifth session)

The first real writes: Task status changes, Notes, Tasks, and attaching an
unfiled Call to a matter, all backed by Server Actions
(`lib/matters/actions.ts`) instead of local component state:

- Dragging a card on the Tasks Kanban board (`components/shared/task-board.tsx`)
  now persists via `updateTaskStatus` — optimistic on-screen update,
  reverted automatically if the write fails — and survives a refresh.
- "Add Note" (Notes tab) and "New Task" (Tasks tab) are now real forms
  (`components/shared/new-note-form.tsx`, `new-task-form.tsx`) backed by
  `createNote`/`createTask`, using `useActionState` the same way the login
  form does.
- "Attach to Matter" on the Calls tab (`components/shared/attach-call-list.tsx`)
  now calls `attachCallToMatter`, which sets `Call.matterId`/`filedById`/
  `filedAt` and only ever claims a call that's still unfiled.
- The Matter Overview's "Quick actions" row now links "Add Note"/"New Task"
  to the tabs that host the real forms. "Log a Call" and "Upload Document"
  remain mocked — there's still no Vonage/Dropbox integration for either to
  write to.
- Every one of these writes independently re-checks authentication
  (`requireCurrentUser`) and matter-level access (`hasMatterAccess`, a new
  boolean-returning sibling of `assertMatterAccess` in `lib/auth/access.ts`
  for call sites that aren't a page render) rather than trusting that a
  page already checked — see docs/SECURITY.md's "Authorization" section.
  A denied write returns the same generic "not found or access denied"
  message regardless of whether the matter/record doesn't exist or simply
  isn't the caller's to touch.
- Every successful write now produces a real `AuditEvent` (`CREATE`/
  `UPDATE`, actor, entity, matter) — the Timeline tab reflects live
  activity for these four actions. Older/seeded matters still carry
  hand-seeded audit history from before this session; that's unchanged.
- Inputs are validated server-side with Zod (`lib/matters/actions.ts`);
  Server Action authorization/validation boundaries are covered by
  `tests/matters/actions.test.ts` and `tests/auth/access.test.ts`.

**Deliberately not done here:** logging a brand-new call (only attaching
an already-existing unfiled one), document upload, task reassignment/
deletion, note editing/pinning, and deadline/calendar-event writes — none
of those had an existing mocked UI to wire up in this pass. See Phases 3–5
below for what's still open.

## Phase 2 — Clients & Matters (CRUD + authorization)

- [ ] Client CRUD (create/list/view/edit) with server-side validation.
- [x] Matter *read* (list + detail) — done in the milestone above.
- [ ] Matter create/edit/delete with server-side validation.
- [x] `MatterAssignment` exists in the schema and is displayed (assigned
      staff shown on Matter overview), but there's no UI to change
      assignments yet.
- [x] Matter-level authorization: users only see matters they're assigned
      to, unless admin. Done in the fourth session (see "Milestone —
      Authentication & matter-level authorization" above) — enforced
      server-side, unit-tested, and applies to every cross-matter list,
      not just direct matter URLs.
- [x] AuditEvent wired in as a side effect of real writes — done for
      Note/Task create, Task status update, and Call attach in the fifth
      session (see milestone above). Matter/Client create-edit-delete
      still don't exist, so this isn't complete for every entity yet.

**Exit criteria:** a staff member can create a client, open a matter for
them, assign staff to it, and have that access properly restricted and
audited.

## Phase 3 — Case workflow essentials

- [x] Notes on a matter — create is done (fifth-session milestone above);
      no edit/delete/pin-toggle form yet.
- [x] Tasks (assignable, with status/priority) on a matter — create and
      Kanban drag-to-update-status are done (fifth-session milestone
      above); no edit/delete/reassign form yet.
- [ ] Deadlines on a matter, with a simple upcoming-deadlines view —
      *read-only view shipped; no create/edit form.*
- [x] Calendar events on a matter. `CalendarEvent` model exists and is
      shown (Matter Overview's "Upcoming key dates", Dashboard's "Upcoming
      court dates & deadlines") — still no create/edit form.
- [x] A per-matter timeline/activity view combining the above — now
      reflects live `AuditEvent` rows for Note/Task create, Task status
      update, and Call attach (fifth-session milestone above); older
      matters still carry seeded history from before those actions
      existed.

**Exit criteria:** day-to-day case management (notes, tasks, deadlines,
calendar) works without MyCase for a pilot matter.

## Milestone — Real Bates/hashing/comparison engine (sixth session)

Most of Phase 4 (below) pulled forward and made real, ahead of Documents/
Communications:

- "New Production" (Discovery tab) creates a real `DiscoveryProduction`
  (`lib/discovery/actions.ts#createDiscoveryProduction`).
- "Register File" uploads a fictional/test file, computes its SHA-256 hash
  (`lib/discovery/hash.ts`), and for PDFs reads the page count and
  generates a Bates-stamped derivative (`lib/discovery/pdf.ts`, via
  `pdf-lib`) with a sequential range continuing from whatever's already
  assigned in that production (`lib/discovery/bates.ts`) — configurable per
  production via `batesPrefix`. Non-paginated media (video/audio/photo/
  other) gets a sequential evidence ID instead of page numbers. The
  original is preserved untouched; the stamp is a separate derivative.
  Both are saved via the new `lib/storage/DocumentStore` (a local-disk
  stand-in for Dropbox — see docs/ARCHITECTURE.md).
- A download link (original, and stamped for PDFs) streams the stored
  bytes through an authenticated Route Handler that logs an `EXPORT`
  audit event.
- "Compare" runs a real comparison between two productions
  (`lib/discovery/compare.ts`, via `#runDiscoveryComparison`): matched
  first by content hash (a rename doesn't register as a new file), falling
  back to filename (a same-named file with different content is flagged
  Changed, not missed) — persisted as real `DiscoveryFileMatch` rows.
- Every action above is authenticated, matter-scoped (including verifying
  a given `productionId` actually belongs to the matter), Zod-validated,
  and produces an `AuditEvent` — see docs/SECURITY.md.
- Productions/files/comparisons seeded before this session remain in the
  database as illustrative historical demo data (no real stored bytes
  behind them) — the Discovery tab's existing look is unchanged, just fed
  real data going forward.

**Deliberately not done here:** editing/deleting a production or file, a
Dropbox-backed `DocumentStore` (still local-disk), and a standardized
per-matter Dropbox folder convention (`docs/DISCOVERY.md`) — see Phase 4
and Phase 6 below.

## Milestone — Stabilization & cleanup pass (seventh session)

No new features — a full regression pass over the persistent-write
(fifth session) and Discovery/Bates (sixth session) work before
development moves into VS Code, per this session's explicit scope:

- Ran lint, typecheck, the full Vitest suite, and a production build from
  a clean clone/reseed — all passed with no changes needed.
- Found and fixed two real issues surfaced by a full code read-through:
  - `lib/auth/access.ts` had a doc comment for `assertMatterAccess`
    orphaned above `hasMatterAccess` from the fifth session's refactor
    (correct code, misleading comment for a future reader) — moved back
    to the function it actually describes.
  - The Matter Overview's "Recent activity" list used the same inline
    `action.toLowerCase()}d` pattern that was already fixed on the
    Timeline tab in the fourth session (producing "viewd"/"exportd" for
    `VIEW`/`EXPORT` events) but was never updated to use the
    `auditActionPastTense` helper — now it is. This had become more
    visible than when it was first found: the Discovery engine's file
    downloads now produce real `EXPORT` events, so this was no longer a
    dormant bug.
- Browser-verified every major flow end to end with fictional test data:
  login/logout, role-based matter access (admin vs. a STAFF user assigned
  to one matter), Matter Overview, Add Note, New Task, Kanban drag
  persistence, Attach Call to Matter, the audit Timeline, Discovery
  production creation, file registration (PDF + non-paginated types),
  Bates stamping, original/stamped download (byte-for-byte verified against
  the uploaded file), production comparison (all four of New/Changed/
  Duplicate/Missing produced in one run), persistence across a full page
  refresh, and unauthorized access denied for another matter's pages,
  discovery tab, and file downloads (including a cross-matter file-id
  probe). All passed.
- Rewrote README.md's "Current status" and "What's mocked" sections,
  which had gone stale across the fifth and sixth sessions (they still
  described Notes/Tasks/Kanban/Attach-Call and audit logging as UI-only
  mocks, and didn't mention the Discovery engine at all) — see README.md
  for the corrected, current list, plus a new "Known limitations to
  address in the next phase" section.

**Known limitations carried into the next phase** (see README.md for the
full list): no row-level locking on Bates sequencing under concurrent
registration, no custom Bates starting number, a possible orphaned file
on disk if a registration's DB write fails after its disk write succeeds,
and `LocalDocumentStore` remaining a dev/demo stand-in (not Dropbox).

## Phase 4 — Discovery management (core differentiator)

- [x] `DiscoveryProduction` and `DiscoveryFile` create. *Real as of the
      sixth session (see milestone above) — review status, file-type
      icons, Bates ranges, hashes, and download links are all live. No
      edit/delete UI yet.*
- [ ] Standardized Dropbox folder-structure convention per matter
      (documented in a new `docs/DISCOVERY.md` once designed) — files
      currently key into `lib/storage/DocumentStore` by
      `matters/<matterId>/discovery/<productionId>/<uuid>/...`, a
      placeholder scheme that only matters once Dropbox is the backing
      store.
- [x] Bates numbering for PDFs (apply to a copy; preserve the original).
      *Real — `lib/discovery/pdf.ts` + `lib/discovery/bates.ts`, unit
      tested for sequencing and non-destructiveness.*
- [x] Consistent identifier scheme for video/audio/photo files. *Real —
      `formatEvidenceIdentifier` in `lib/discovery/bates.ts`.*
- [x] Content hashing on ingest to support later comparison. *Real —
      SHA-256 via `lib/discovery/hash.ts`, computed at registration.*
- [x] Discovery production comparison (new/changed/duplicate/missing)
      across two productions. *Real as of the sixth session
      (`lib/discovery/compare.ts`) for anything created through the UI;
      comparisons seeded before that session remain as illustrative
      historical data (see milestone above).*

**Exit criteria:** discovery for a pilot matter can be received, numbered,
organized, and a re-served production compared against the original. Met
for fictional/test files as of the sixth session — not yet for real
evidence, since that needs Dropbox (Phase 6) instead of the local-disk
storage stand-in.

## Phase 5 — Communications (groundwork for Vonage)

- [ ] Generic `Communication` logging (manual entry first — no Vonage yet).
      **Not started** — the schema only has `Call`, not the more general
      `Communication` entity from `docs/DATA_MODEL.md`; add it if/when
      email/SMS/letter logging is needed.
- [x] `Call` entity and UI for manually logging/filing a call to a matter,
      as a stand-in for the eventual Vonage sync. *`Call` model and a
      Calls tab shipped; attaching an unfiled call to a matter now persists
      (`attachCallToMatter`, fifth-session milestone above). There's still
      no UI to log a brand-new call (only to attach an existing unfiled
      one) or to toggle the `flagged` field.*

**Exit criteria:** the data model and UI for communications are proven out
manually before any Vonage API work begins.

## Phase 6 — Integrations (Dropbox, Vonage)

- [ ] Dropbox integration behind `lib/storage/DocumentStore`: link matter
      folders, browse/upload/reference files from the app. The interface
      already exists with a local-disk implementation
      (`LocalDocumentStore`, sixth session) — this phase is writing a
      Dropbox-backed implementation of the same interface and swapping it
      in; `lib/discovery/`'s Bates/hashing/comparison engine and every
      Server Action calling `documentStore` should need no changes.
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
