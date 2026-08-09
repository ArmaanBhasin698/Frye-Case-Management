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

- [x] Client *create/list/view/edit* with server-side validation. Real as
      of the ninth session (see milestone above) — `ADMIN`/`ATTORNEY`
      only. Deletion/archival intentionally not built (no safe pattern
      existed yet to build it on).
- [x] Matter *read* (list + detail) — done in the milestone above.
- [x] Matter *create/edit* with server-side validation. Real as of the
      ninth session — `ADMIN`/`ATTORNEY` only, and edit additionally
      requires the caller be assigned to that specific matter. *Deletion*
      still not built, same reasoning as Client.
- [x] `MatterAssignment` exists in the schema and is displayed (assigned
      staff shown on Matter overview); a UI to change assignments now
      exists too — required at Matter creation (at least one), and
      addable/removable afterward from the Edit Matter page (ninth
      session, see milestone above).
- [x] Matter-level authorization: users only see matters they're assigned
      to, unless admin. Done in the fourth session (see "Milestone —
      Authentication & matter-level authorization" above) — enforced
      server-side, unit-tested, and applies to every cross-matter list,
      not just direct matter URLs.
- [x] AuditEvent wired in as a side effect of real writes — done for
      Note/Task create, Task status update, and Call attach in the fifth
      session; Client create/update, Matter create/update, and
      MatterAssignment create/delete in the ninth session; Deadline/
      CalendarEvent create/update/status-change in the tenth session;
      Document upload/metadata-edit/download in the eleventh session; and
      Note/Task edit in the twelfth session (see milestones above).
      Note/Task *deletion* still has no write path (deliberately deferred,
      same reasoning as every other entity).

**Exit criteria:** a staff member can create a client, open a matter for
them, assign staff to it, and have that access properly restricted and
audited. **Met as of the ninth session** for `ADMIN`/`ATTORNEY` staff;
Client/Matter deletion remains open for a future phase.

## Phase 3 — Case workflow essentials

- [x] Notes on a matter — create (fifth-session milestone above) and edit
      (body + pinned, twelfth-session milestone below) are done; no
      deletion (deliberately deferred, no safe archival pattern yet).
- [x] Tasks (assignable, with status/priority) on a matter — create,
      Kanban drag-to-update-status (fifth-session milestone above), and a
      full edit form (title/description/due date/priority/status/
      assignee, twelfth-session milestone below) are done; no deletion
      (deliberately deferred, same reasoning as Notes).
- [x] Deadlines on a matter, with a simple upcoming-deadlines view. Real
      as of the tenth session (see milestone below) — create, edit, and a
      mark complete/incomplete toggle all persist; the Matter Overview and
      Dashboard's upcoming-dates widgets already read live data, so they
      needed no changes to reflect real deadlines.
- [x] Calendar events on a matter. `CalendarEvent` model exists and is
      shown (Matter Overview's "Upcoming key dates", Dashboard's "Upcoming
      court dates & deadlines") — create/edit real as of the tenth session
      too (see milestone below), on the same "Deadlines & Calendar" tab.
- [x] A per-matter timeline/activity view combining the above — now
      reflects live `AuditEvent` rows for Note/Task create, Task status
      update, Call attach (fifth-session milestone above), and Deadline/
      CalendarEvent create/update/status-change (tenth session, see
      milestone below); older matters still carry seeded history from
      before those actions existed.

**Exit criteria:** day-to-day case management (notes, tasks, deadlines,
calendar) works without MyCase for a pilot matter. **Met as of the twelfth
session** for everyday create/edit workflows — deletion/archival for any
entity remains deliberately deferred, tracked separately above.

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

## Milestone — Dropbox-backed dev/test DocumentStore (eighth session)

A second `DocumentStore` implementation, picked ahead of the rest of
Phase 6 specifically because the interface was already designed for
exactly this swap (see the sixth-session milestone above) — first local
setup in VS Code, then this:

- `STORAGE_PROVIDER` (`.env`) selects `local` (default, unchanged
  `LocalDocumentStore`) or `dropbox` (`lib/storage/DropboxDocumentStore.ts`,
  the official `dropbox` SDK, authenticated with a refresh token —
  `DROPBOX_APP_KEY`/`DROPBOX_APP_SECRET`/`DROPBOX_REFRESH_TOKEN`). Every
  key is written under a configurable, obviously-disposable test root
  (`DROPBOX_ROOT_PATH`, default `/FryeCaseManagement-DEV`) — see
  `.env.example`.
- `lib/discovery/actions.ts` and every Server Action calling
  `documentStore` needed **zero** changes — exactly the payoff the
  interface was designed for. The existing key scheme
  (`matters/<matterId>/discovery/<productionId>/<uuid>/...`), hashing,
  Bates stamping, authorization, and audit logging are all identical
  regardless of which backend is active.
- `lib/storage/config.ts` validates the Dropbox environment variables and
  throws a clear, secret-free error (naming which variable is missing,
  never a value) if `STORAGE_PROVIDER=dropbox` is set without all three —
  this happens at startup, not on the first upload.
- `DropboxDocumentStore` re-validates every key is a safe relative path
  (no `..`, no leading slash, no `//`) before calling the Dropbox API, and
  writes with Dropbox's `add` mode (fails instead of silently overwriting
  on a path collision) — the same defense-in-depth posture
  `LocalDocumentStore` already had for the filesystem.
- Downloads still only happen through the app's own authenticated Route
  Handler — this pass never generates a Dropbox shared/public link, and
  the generic-404 behavior for unauthorized/nonexistent files is
  unchanged (see docs/SECURITY.md).
- Tests (`tests/storage/`) cover provider selection, missing-config
  failure, Dropbox path generation (including the original/stamped
  derivative staying at distinct paths), path-traversal rejection, error
  sanitization (a mocked Dropbox error carrying a fake token value never
  reaches the thrown error's message), and a `LocalDocumentStore`
  regression check — all against mocks, no real Dropbox account required.

**Deliberately not done here:** an actual live round-trip against a real
Dropbox test account (no Dropbox credentials were available in the
session that built this — see README.md for exactly what to configure to
run one), a production-grade per-matter Dropbox folder convention (still
the flat dev key scheme — see Phase 4 below), encrypted-at-rest storage
of the refresh token, and any migration path for files already on local
disk if a firm ever switches providers.

## Milestone — Client/Matter create & edit (ninth session)

Phase 2's remaining CRUD gap, closed end to end: real Client and Matter
create/edit workflows, following the same auth/authorization/validation/
audit conventions Notes, Tasks, Calls, and Discovery already established.
Dropbox authentication for the firm's real account was explicitly deferred
this session (requires staff 2FA) — `STORAGE_PROVIDER` stayed on `local`
throughout; nothing here touches storage.

- **New Client / Edit Client** (`app/(dashboard)/clients/`,
  `lib/clients/actions.ts`, `lib/clients/queries.ts`) — the "Clients"
  sidebar item is real for the first time (previously scaffolding-only,
  see the second-session milestone); a client's own page lists their
  matters and links to Edit.
- **New Matter / Edit Matter** (`app/(dashboard)/matters/new`,
  `app/(dashboard)/matters/[matterId]/edit`) — New Matter links to an
  *existing* client and requires at least one initial `MatterAssignment`;
  Edit Matter's page also hosts a `ManageAssignments` widget to add/remove
  staff on an already-existing matter.
- **New authorization rule, documented rather than assumed** (see
  `docs/SECURITY.md`'s Authorization section and README's "Who can
  create/edit a Client or Matter"): creating a brand-new Client or Matter,
  and editing a Client's own fields, is restricted to `ADMIN`/`ATTORNEY`
  (`lib/auth/authorization.ts#canManageClientsAndMatters`) — the docs
  never specified this before, since every other write path checks an
  *existing* assignment and creating the first record for a case has
  nothing to check yet. Editing an *existing* Matter additionally requires
  the normal matter-level check (`lib/auth/access.ts#canEditMatter`): an
  `ATTORNEY` must actually be assigned to that matter, not just hold the
  role. `PARALEGAL`/`STAFF` are unaffected everywhere else.
- Every action independently calls `requireCurrentUser()` and the relevant
  authorization check, same as every write path before it — a submitted
  `clientId`/`matterId`/`assignmentId` can't be used to reach or modify a
  record outside the caller's permitted scope (`removeMatterAssignment`
  scopes its delete by `{id, matterId}` together, `createMatter`
  re-validates the client and every assigned user server-side).
- Real `AuditEvent`s: Client `CREATE`/`UPDATE`, Matter `CREATE`/`UPDATE`,
  and `MatterAssignment` `CREATE`/`DELETE` for every assignment change
  (initial assignments at matter creation, or added/removed later from
  Edit Matter). Updates carry a `metadata.changed` before/after diff
  (`lib/utils/index.ts#diffFields`) — `Client.notes` is excluded from the
  diff itself (only `notesChanged: true` is recorded) since it's free text
  that could otherwise duplicate sensitive case notes into the audit log.
- 30 new focused tests (`tests/clients/actions.test.ts`,
  `tests/matters/actions.test.ts`, `tests/auth/authorization.test.ts`,
  `tests/auth/access.test.ts`) covering creation validation, edit
  authorization (including an `ATTORNEY` who holds the role but isn't
  assigned to the specific matter), assignment scoping, ID-probing
  denial, and audit event generation, plus a regression check that
  existing matter-access behavior is unchanged.
- Browser-verified end to end with fictional data (Playwright): create →
  refresh → edit → persistence for both Client and Matter, assignment
  add/remove via Edit Matter surviving a refresh, the new matter appearing
  on the Matters list, a `STAFF` account denied at `/clients`,
  `/matters/new`, and the new matter's own pages (404, not a
  distinguishable error), and an `ATTORNEY` who holds the role but isn't
  assigned to the specific matter denied its edit page too — confirming
  the rule is genuinely per-matter, not just per-role.

**Deliberately not done here:** Client/Matter *deletion* or archival (no
safe pattern existed to build on, and the task explicitly scoped deletion
out), reassigning a Matter to a different Client after creation, and any
Dropbox/Vonage/Loop/MyCase/QuickBooks integration work.

## Milestone — Deadlines & Calendar Events (tenth session)

Phase 3's remaining gap closed: real Deadline and CalendarEvent create/edit
workflows, following the same auth/matter-scoping/validation/audit
conventions Notes, Tasks, and Calls already established. Dropbox
authentication for the firm's real account remains deferred (requires
staff 2FA) — `STORAGE_PROVIDER` stayed on `local` throughout; nothing here
touches storage. No schema/migration changes were needed — every field
used (`Deadline.satisfied`/`satisfiedAt`, `CalendarEvent.startTime`/
`endTime`) already existed.

- **New Deadline / Edit Deadline / Mark complete-incomplete**
  (`lib/matters/actions.ts#createDeadline`/`updateDeadline`/
  `setDeadlineSatisfied`, `components/shared/new-deadline-form.tsx`,
  `deadline-list.tsx`) — all on the Matter's "Deadlines & Calendar" tab
  (`app/(dashboard)/matters/[matterId]/deadlines/page.tsx`, renamed from
  "Deadlines" since it now also hosts Calendar Events). Marking a deadline
  satisfied/unsatisfied is a separate direct action (not a form submit),
  matching the `updateTaskStatus` pattern from the fifth session.
- **New Calendar Event / Edit Calendar Event**
  (`#createCalendarEvent`/`updateCalendarEvent`,
  `new-calendar-event-form.tsx`, `calendar-event-list.tsx`) — end time is
  validated to be after start time when both are given; an event with no
  end time is allowed (matches the existing nullable `endTime` column).
- **Authorization rule: the existing matter-access rule, per this
  session's explicit fallback instruction** — `hasMatterAccess` (any
  assigned role), the *same* rule Notes/Tasks/Calls already use, not the
  stricter `ADMIN`/`ATTORNEY` Client/Matter management rule from the ninth
  session. Neither `docs/DATA_MODEL.md` nor `docs/SECURITY.md` specified a
  stricter rule for Deadline/CalendarEvent, and unlike originating a
  brand-new Client/Matter, editing one has an existing matter assignment
  to check against — see docs/SECURITY.md's Authorization section for the
  full reasoning.
- Every submitted `matterId`/`deadlineId`/`eventId` is independently
  scoped server-side: `updateDeadline`/`updateCalendarEvent` re-fetch the
  record via `findFirst({where: {id, matterId}})` before editing it (the
  same pattern `registerDiscoveryFile`/`runDiscoveryComparison` use for
  `productionId`), and `setDeadlineSatisfied` scopes its `updateMany` by
  `{id, matterId}` together like `updateTaskStatus` — a cross-matter id
  can never be read or written through a matter the caller can access.
- Real `AuditEvent`s: Deadline `CREATE`, a separate `UPDATE` for
  `setDeadlineSatisfied` (its own auditable action, same reasoning as
  Bates generation logging separately from file registration), a
  field-diff `UPDATE` for `updateDeadline`, and CalendarEvent `CREATE`/
  `UPDATE` (also a field-diff via the shared `diffFields` helper from the
  ninth session).
- Neither `Deadline` nor `CalendarEvent` has an assignee/attendee column in
  `prisma/schema.prisma` (unlike `Task.assignedToId`), so their forms have
  no staff picker and there's no user id to validate — adding one would be
  a schema change, out of scope for this pass.
- The Matter Overview's "Upcoming key dates" card and the Dashboard's
  upcoming-dates widgets (`lib/dashboard/queries.ts#getUpcomingKeyDates`)
  already read live `Deadline`/`CalendarEvent` rows from Postgres — they
  needed **zero** code changes to reflect real writes, only
  `revalidatePath("/")` calls in the new actions so their cache updates.
- 23 new focused tests (`tests/matters/actions.test.ts`) covering creation
  validation (including end-before-start rejection), edit authorization,
  cross-matter id-scoping denial for both entities, status-change
  persistence, and audit event generation (including the "no-op edit
  writes no audit event" case).
- Browser-verified end to end with fictional data (Playwright): create →
  refresh → edit → persistence for both a Deadline and a Calendar Event,
  mark-complete/incomplete surviving a refresh, the Timeline showing the
  new audit events, a `STAFF` account unassigned to the test matter denied
  its Deadlines & Calendar tab (404), and all of Notes/Tasks/Discovery/
  Calls/Clients/Matters still rendering correctly afterward.

**Deliberately not done here:** Deadline/CalendarEvent *deletion* (no safe
pattern existed to build on, consistent with the ninth session's
Client/Matter reasoning), an assignee/attendee field for either entity (no
schema change made), a firm-wide standalone Calendar page (the sidebar's
"Calendar" item was still the disabled/not-built-yet placeholder — Calendar
Events existed per-matter only, same as Discovery/Tasks; built in the
thirteenth session, see milestone below), and any
Dropbox/Vonage/Loop/MyCase/QuickBooks integration work.

## Milestone — General matter document upload/download (eleventh session)

Turns the Matter Documents tab from a display-only mock (a fake Dropbox
path shown as plain text) into a real workflow through the existing
`lib/storage/DocumentStore` abstraction — the exact payoff that interface
was built for back in the sixth session. Dropbox authorization for the
firm's real account remains deferred (requires staff 2FA); every
browser/integration test in this session ran with `STORAGE_PROVIDER=local`.

- **Upload / edit metadata** (`lib/documents/actions.ts#uploadDocument`/
  `updateDocumentMetadata`, `components/shared/upload-document-form.tsx`,
  `document-list.tsx`) — real for the first time on the Matter Documents
  tab; the Matter Overview's "Upload Document" quick action (mocked since
  the third session) now links to it, same as the other real quick
  actions.
- **One small, additive Prisma migration**
  (`20260809000000_add_document_storage_metadata`): renamed
  `Document.dropboxPath` → `storageKey` (same values, same type — the
  field always held an opaque `DocumentStore` key, never a literal Dropbox
  API path, and the old name actively contradicted the "storage-provider
  agnostic" goal now that `STORAGE_PROVIDER` can be `local`) and added
  four nullable columns: `originalFilename`, `mimeType`, `sizeBytes`,
  `contentHash`. All four are nullable specifically so existing seeded
  rows needed no backfill and keep working as illustrative-only history
  (same pattern as pre-engine `DiscoveryFile` rows) — see
  `docs/DATA_MODEL.md`'s Document entry.
- **Storage-provider agnostic by construction, not just by claim**:
  `uploadDocument` and the download Route Handler call
  `documentStore.save`/`.read` exactly the way `lib/discovery/actions.ts`
  already does — neither file needed to change to add this feature, and
  neither would need to change if `STORAGE_PROVIDER` switched to
  `dropbox` for real matter documents once the firm's account is
  authorized.
- **Server-generated storage keys, deliberately never the uploaded
  filename**: `matters/<matterId>/documents/<uuid>/original`, a fresh
  UUID per upload (not the eventual `Document.id` — same chicken-and-egg
  reasoning `registerDiscoveryFile` already established). This is a
  deliberate deviation from this session's own illustrative example key
  (`.../<documentId>/original/<safe-file-name>`): embedding the real
  uploaded filename in a storage path would risk leaking a client's real
  name or case details into the path, which the session's own
  instructions separately prohibited — the true original filename is
  preserved only as `Document.originalFilename` metadata. Because every
  upload gets a fresh, never-reused key, two files sharing a filename
  never collide or overwrite each other.
- **Authorization uses the plain matter-access rule** (`hasMatterAccess`,
  any assigned role) — same as Deadlines/CalendarEvents/Notes/Tasks/Calls,
  not the stricter `ADMIN`/`ATTORNEY` Client/Matter rule, per this
  session's explicit fallback instruction and since neither
  `docs/DATA_MODEL.md` nor `docs/SECURITY.md` establishes anything
  stricter for Documents. `hasMatterAccess` is checked *before* any bytes
  are written to `DocumentStore`, so a denied upload never touches
  storage. `updateDocumentMetadata` and the download route both re-fetch/
  re-scope by `{id: documentId, matterId}` together — a `documentId` from
  a different matter is denied exactly like a nonexistent one, even for a
  caller with legitimate access to *some* matter.
- Real `AuditEvent`s: Document `CREATE` (upload), `UPDATE` (metadata edit,
  a `diffFields` before/after — `notes` excluded from the diff itself,
  only `notesChanged: true`, same pattern as `Client.notes`), and `EXPORT`
  (download) — mirroring Discovery's file-registration/download auditing
  exactly.
- 25 new tests (`tests/documents/actions.test.ts`,
  `tests/documents/route.test.ts`) covering upload validation (size, empty
  file, disallowed extension, extension/MIME mismatch), matter
  authorization, server-generated storage keys never containing the raw
  filename, original-byte preservation, duplicate-filename non-collision,
  metadata-edit authorization and cross-matter id-scoping, generic-error
  handling on a Prisma failure, and download-route authorization
  (unauthenticated, no matter access, cross-matter probe, storage-read
  failure, and a successful download's headers + `EXPORT` audit event).
- Browser-verified end to end with a fictional PDF: upload → refresh →
  persistence → metadata edit → refresh → persistence → download with a
  **SHA-256 byte-for-byte match** against the originally uploaded file →
  Timeline showing the CREATE/UPDATE/EXPORT events → a second upload
  sharing the first file's exact filename, confirmed not to overwrite it
  → a `STAFF` account unassigned to the test matter denied (404) on its
  Documents tab and the matter itself → a realistic cross-matter probe (an
  `ATTORNEY` genuinely assigned to their own matter, requesting a
  `documentId` that belongs to a different matter they aren't assigned
  to) denied (404) → Discovery, Notes, Tasks, Calls, Clients, Matters, and
  Deadlines & Calendar all still rendering correctly afterward.

**Deliberately not done here:** Document *deletion* (no safe archival
pattern exists, same reasoning as Client/Matter/Deadline/CalendarEvent), a
`DocumentStore.delete()` method (so an upload's bytes are left orphaned in
storage if the follow-up `prisma.document.create` fails — the same
documented, unresolved limitation `registerDiscoveryFile` already
carries; adding delete support to both `DocumentStore` implementations was
judged out of scope for this pass), a production Dropbox folder
convention (still the flat dev key scheme), any file preview/rendering,
and any Dropbox/Vonage/Loop/MyCase/QuickBooks integration work.

## Milestone — Note/Task editing (twelfth session)

Closes the last everyday editing gap called out by the eleventh session's
Documents milestone: Notes and Tasks could be created but never edited.
No schema/migration changes were needed — `Note.updatedAt` and
`Task.updatedAt` already existed via `@updatedAt`.

- **Edit Note** (`lib/matters/actions.ts#updateNote`,
  `components/shared/note-list.tsx`) — body and pinned only; author and
  original `createdAt` are never touched. The Matter Notes tab
  (`app/(dashboard)/matters/[matterId]/notes/page.tsx`) now renders each
  note through `NoteList`, which gives every note card a restrained
  "Edit" action inline, matching the Deadline/CalendarEvent/Document edit
  pattern.
- **Edit Task** (`lib/matters/actions.ts#updateTask`,
  `components/shared/task-board.tsx`) — title, description, due date,
  priority, status, and assignee. The Kanban board's existing drag-and-
  drop (`updateTaskStatus`) and the new full-form edit both write the same
  `Task.status` column with matching `revalidatePath` calls, so a drag and
  a form-based status change can never disagree with each other — no
  reconciliation logic was needed, just two ordinary writers of one
  column.
- **Task assignee security rule**: an `assignedToId` submitted to
  `updateTask` must belong to an **active** user who is **either assigned
  to that matter or an active `ADMIN`** — enforced by reusing the existing
  `hasMatterAccess` check against the *candidate* assignee's `{id, role}`
  rather than inventing a new authorization concept. This prevents a
  forged request from assigning a Task on Matter A to a globally-valid
  user who has no legitimate reason to know Matter A exists. The picker
  itself only ever offers legitimate candidates —
  `lib/matters/queries.ts#getMatterAssignableUsers` mirrors the same rule
  (matter-assigned active users ∪ active `ADMIN`s) so the UI never offers
  an option the server would reject.
- **Authorization**: both actions independently call
  `requireCurrentUser()` and `hasMatterAccess` for the caller (the plain
  matter-access rule, any assigned role — same as Notes/Tasks/Calls/
  Deadlines/CalendarEvents/Documents before them, not the stricter
  `ADMIN`/`ATTORNEY` Client/Matter rule), then re-fetch the record via
  `findFirst({where: {id, matterId}})` before writing — a `noteId`/
  `taskId` from a different matter is denied exactly like a nonexistent
  one, even for a caller with legitimate access to *some* matter.
- Real `AuditEvent`s: Note `UPDATE` and Task `UPDATE`, both restrained the
  same way `Client.notes`/`Document.notes` already are — `Note.body` and
  `Task.description` are free text excluded from the diff itself; only
  `contentChanged: true` / `descriptionChanged: true` is recorded, never
  the actual before/after text. Every other changed field (`pinned`,
  `title`, `dueDate`, `priority`, `status`, `assignedToId`) is diffed
  normally via `diffFields`. A no-op edit (nothing actually changed)
  writes no audit event, consistent with every prior write-action
  milestone.
- 22 new focused tests (`tests/matters/actions.test.ts`) covering Note
  edit validation, matter authorization, cross-matter id-scoping denial,
  audit content restraint (including a JSON-stringify assertion that
  neither the before nor after note text appears anywhere in the audit
  payload), no-op-edit producing no audit event, Task edit validation,
  matter authorization, cross-matter id-scoping denial, Kanban-column
  consistency, description redaction, and the assignee-validation rule
  (rejecting a nonexistent/inactive assignee, rejecting an active user
  unrelated to the matter, allowing a genuinely matter-assigned user,
  allowing an `ADMIN` regardless of assignment, and allowing the assignee
  to be cleared).
- Browser-verified end to end with fictional data (Playwright): create →
  edit → refresh → persistence for both a Note (body + pinned) and a Task
  (title/due date/assignee/status), the Timeline showing both UPDATE
  events without reproducing the note's full text, a Kanban drag-to-Done
  after a form edit staying consistent with the edit workflow, a `STAFF`
  account unassigned to the test matter denied (404) on the matter itself
  and its Notes/Tasks tabs, and Documents/Discovery/Calls/Deadlines &
  Calendar/Clients/Matters/Dashboard all still rendering and functioning
  (including a full upload/download/metadata-edit exercise, not just a
  page-render check) afterward.

**Deliberately not done here:** Note/Task *deletion* or archival (no safe
pattern exists yet, same reasoning as Client/Matter/Deadline/
CalendarEvent/Document), and any Dropbox/Vonage/Loop/MyCase/QuickBooks
integration work.

## Milestone — Firm-wide Tasks & Calendar (thirteenth session)

Turns the sidebar's long-disabled "Tasks" and "Calendar" items into real
authorized aggregate views — the first firm-wide sections built for either
entity. Deliberately **not** a new Task/Deadline/CalendarEvent record or a
second CRUD path: both pages read the exact same rows the per-matter Tasks
tab and Deadlines & Calendar tab already write, just across every matter
the current user may see. No schema/migration changes were needed. First
development pass run locally in VS Code rather than Claude Code Web.

- **`lib/tasks/queries.ts#getFirmWideTasks`** — the query behind
  `app/(dashboard)/tasks`. Scopes with `matterScopeFilterFor`
  (`lib/auth/access.ts`), the same helper `lib/dashboard/queries.ts`'s
  firm-wide widgets already use: an `ADMIN` gets no restriction, everyone
  else gets `{ matterId: { in: assignedMatterIds } }`. Every filter
  (status, priority, assignee, matter, overdue-only) is combined with that
  scope via `AND` — there is no code path that queries Task without it.
- **`lib/calendar/queries.ts#getFirmWideCalendarItems`** — the query behind
  `app/(dashboard)/calendar`. Runs the same scoped-`Deadline`/scoped-
  `CalendarEvent` pattern `lib/dashboard/queries.ts#getUpcomingKeyDates`
  already established for the Dashboard's "Upcoming court dates &
  deadlines" widget, merges the two into one chronological list, and adds
  filters (matter, deadline vs. event, satisfied vs. open, upcoming vs.
  include-past) — each combined with the matter scope the same way.
- Both pages are plain Server Components reading the Next.js `searchParams`
  page prop (validated against a fixed allowlist before reaching Prisma —
  an unrecognized value is treated as "no filter," never passed through
  raw) and a small client-only filter bar
  (`components/shared/task-filter-bar.tsx`,
  `calendar-filter-bar.tsx`) that only builds a query string and navigates
  — it never fetches or filters data itself, and deliberately avoids
  `useSearchParams`/`Suspense` by taking the current filter values as
  props instead.
- Every row links back to the existing per-matter workflow rather than
  duplicating it: a task's title links to that matter's Tasks tab (the
  real Kanban board and edit form), a deadline/event links to that
  matter's Deadlines & Calendar tab, and the matter name links to the
  Matter Overview. No new write path was added.
- The matter and assignee filter dropdowns are themselves
  authorization-safe: the matter list comes from `listMatters(user)`
  (already scoped, `lib/matters/queries.ts`), so a restricted user's
  filter dropdown can never name a matter they can't open — verified by
  browser testing (see below) that the dropdown options themselves never
  leak an unauthorized matter's case number.
- Sidebar: `components/shared/app-shell.tsx`'s "Tasks" and "Calendar" items
  are no longer `disabled` — same active-state/navigation styling as
  Dashboard/Matters/Clients, no shell redesign.
- Time handling is unchanged from the per-matter Deadlines & Calendar tab:
  `CalendarEvent.startTime`/`endTime` are still interpreted as the server's
  local time (no timezone field exists on the model — see README's "Known
  limitations"), and this pass does not attempt a partial timezone fix.
- The Dashboard's existing `getOpenTasksAcrossMatters`/`getUpcomingKeyDates`
  widgets (`lib/dashboard/queries.ts`) were deliberately left as-is rather
  than rewired onto the new helpers — they already call the same
  underlying `matterScopeFilterFor`/`matterIdFilterFor` authorization
  primitives the new helpers do (so there's no duplicated *authorization*
  logic), and refactoring a small, already-tested, working Dashboard for
  a filter/sort feature it doesn't need was judged unnecessary risk for
  this pass.
- 30 new focused tests (`tests/tasks/queries.test.ts`,
  `tests/calendar/queries.test.ts`) covering ADMIN-sees-everything,
  non-admin-sees-only-assigned-matters, an explicit "never returns a
  row from an unassigned matter" case (simulating Prisma's actual
  `matterId: { in }` filtering against a fixture containing both an
  authorized and an unauthorized row, asserting the unauthorized title
  never appears in the result or its JSON), empty-result handling with
  no assigned matters, filter/sort combination correctness, and
  deadline-satisfied-state pass-through.
- Browser-verified against the local dev server (fictional seed data,
  `STORAGE_PROVIDER=local`) using the real Auth.js credentials flow (not a
  mocked session): `alex.rivera` (`ADMIN`) sees tasks/deadlines/events
  across all four seeded matters on both new pages; `taylor.brooks`
  (`STAFF`, assigned only to State v. Patel) sees only State v. Patel's
  tasks/deadlines/events on both pages, and that matter is the *only*
  option in either page's matter filter dropdown; filtering by
  status/priority and sorting by priority visibly change the result count
  and order; direct navigation to an unauthorized matter still returns the
  same generic 404; and Notes/Tasks/Documents/Discovery/Calls/Deadlines &
  Calendar/Dashboard/Matters/Clients all continued to render and function
  correctly afterward.

**Deliberately not done here:** any new Task/Deadline/CalendarEvent write
path (this was an aggregate/read/navigation pass, per its own scope), a
firm-wide Reports section (Phase 7, below — this pass only covers Tasks
and Calendar), and any Dropbox/Vonage/Loop/MyCase/QuickBooks integration
work.

## Phase 4 — Discovery management (core differentiator)

- [x] `DiscoveryProduction` and `DiscoveryFile` create. *Real as of the
      sixth session (see milestone above) — review status, file-type
      icons, Bates ranges, hashes, and download links are all live. No
      edit/delete UI yet.*
- [ ] Standardized Dropbox folder-structure convention per matter
      (documented in a new `docs/DISCOVERY.md` once designed) — files
      still key into `lib/storage/DocumentStore` by
      `matters/<matterId>/discovery/<productionId>/<uuid>/...` (unchanged
      by the eighth-session Dropbox milestone above — that key scheme is
      generated in `lib/discovery/actions.ts`, independent of which
      storage backend receives it), a placeholder scheme good enough for
      dev/test but not the production folder convention this item covers.
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

- [x] Dropbox integration behind `lib/storage/DocumentStore` for
      dev/test use. *Real as of the eighth session
      (`lib/storage/DropboxDocumentStore.ts`, `STORAGE_PROVIDER=dropbox`)
      — see the milestone above. Both Discovery and, as of the eleventh
      session, general matter Documents upload/download through this same
      interface, so either would work against Dropbox as soon as
      `STORAGE_PROVIDER=dropbox` is set — the firm's real account still
      needs staff 2FA to authorize that, which remains deliberately
      deferred.* Still open for **production** use: linking a real
      per-matter folder structure, a firm-owned (not personal-dev) Dropbox
      app, and encrypted-at-rest token storage.
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
