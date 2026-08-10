# Frye Case Management

A custom case-management platform being built for a criminal defense law
firm, to replace [MyCase](https://www.mycase.com/) for active client and
case management (and, longer-term, to reduce reliance on
[monday.com](https://monday.com/)) — while keeping Loop/HighLevel for
leads/intake, Dropbox for document storage, Vonage for calls/SMS, and
QuickBooks Online for future billing.

See [`CLAUDE.md`](./CLAUDE.md) for the full project brief (purpose,
architecture rules, security requirements, coding standards) and the
[`docs/`](./docs) folder for detailed planning documents:

- [`docs/PROJECT_PLAN.md`](./docs/PROJECT_PLAN.md) — what we're building and why.
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — system architecture and technical rationale.
- [`docs/DATA_MODEL.md`](./docs/DATA_MODEL.md) — core entities and relationships.
- [`docs/SECURITY.md`](./docs/SECURITY.md) — security and confidentiality requirements.
- [`docs/ROADMAP.md`](./docs/ROADMAP.md) — phased build plan.

## Current status

**A functional MVP core with real authentication, real persistent writes,
and a real Discovery/Bates engine — not just a read-only visual
prototype.** The app runs with a firm-wide Dashboard, a Matters list, and
a Matter detail view (Overview, Discovery, Documents, Calls, Notes, Tasks,
Deadlines & Calendar, Timeline tabs) backed by a real Postgres database via
Prisma.

What's genuinely real, end to end (server-side auth + authorization + Zod
validation + audit logging on every write — see `docs/SECURITY.md`):

- **Login/logout and matter-level authorization** — Auth.js (credentials,
  fictional dev users); admins see every matter, everyone else only what
  they're assigned to, including on a direct URL to a matter they don't
  have (a 404, not a distinguishable "access denied").
- **Client and Matter create/edit, including staff assignments** — New
  Client, Edit Client, New Matter (linked to an existing client, with its
  initial staff assignment(s)), Edit Matter, and adding/removing a
  Matter's assignments from its Edit page all persist to Postgres.
  Restricted to `ADMIN`/`ATTORNEY` — see "Who can create/edit a Client or
  Matter" below for why and `docs/SECURITY.md` for the full rule.
- **Notes, tasks, and task status** — Add Note/Edit Note and New Task/Edit
  Task all persist to Postgres; the Kanban board's drag-and-drop persists a
  task's status and survives a refresh (optimistic UI, reverts if the
  write fails), and stays consistent with status changes made through the
  edit form since both write the same column. Editing a Task's assignee is
  restricted server-side to an active user who is either assigned to that
  matter or an `ADMIN` — see `docs/SECURITY.md`'s "Authorization" section
  for the full rule.
- **Deadlines and Calendar Events** — New Deadline, Edit Deadline, and a
  Mark complete/incomplete toggle (`Deadline.satisfied`/`satisfiedAt`) all
  persist; New Event and Edit Event persist too (end time is validated to
  be after start time). Both live on the Matter's "Deadlines & Calendar"
  tab, use the same matter-access rule as Notes/Tasks/Calls (any assigned
  role, not the stricter Client/Matter `ADMIN`/`ATTORNEY` rule above), and
  automatically show up in the Matter Overview's "Upcoming key dates" and
  the Dashboard's upcoming-dates widgets, which already read live data.
- **Manual Call logging, filing, and a firm-wide Communications view** —
  Log a Call (`lib/matters/actions.ts#createCall`) persists a brand-new
  Call, filed to a matter or left unfiled, from the Matter Calls tab, the
  Matter Overview's "Log a Call" quick action, or the firm-wide
  Communications page; attaching an already-existing unfiled call to a
  matter (`attachCallToMatter`) still persists `Call.matterId` the same
  way it always has. The sidebar's "Communications" item is now a real,
  authorized, Calls-first aggregate view (`app/(dashboard)/communications`,
  `lib/communications/queries.ts`) over those same `Call` rows — not a
  second record. **No Vonage integration exists yet** — every Call is
  manually logged or seeded; see "Who can see an unfiled call" below for
  the conservative visibility rule unfiled calls get on that page.
- **The audit Timeline** — reflects real `AuditEvent` rows produced by the
  writes above, not just seed data.
- **Discovery/Bates engine** — creating a production, registering a file
  (PDF, video, audio, photo, or other), and comparing two productions are
  all real: registering a file computes a SHA-256 hash and, for PDFs,
  generates a separate Bates-stamped derivative (the original is never
  modified); comparing two productions classifies every file as
  New/Changed/Duplicate/Missing using stored hashes and filenames, not
  hand-picked results. See `lib/discovery/`.
- **General (non-discovery) matter documents** — Upload Document and
  editing a document's title/category/notes persist to Postgres and
  `DocumentStore`; downloads stream through an authenticated route the
  same way Discovery's do. Every upload gets a server-generated storage
  key (never the raw filename, so two files sharing a name never collide
  or overwrite each other) and a SHA-256 hash. See `lib/documents/`.
- **Storage backend is swappable** — `lib/storage/DocumentStore` has two
  real implementations, chosen via `STORAGE_PROVIDER`: local disk
  (default) or a **development/test** Dropbox integration
  (`lib/storage/DropboxDocumentStore.ts`) that writes to a dedicated,
  clearly-named test folder. Both Discovery and general Documents talk to
  whichever implementation is active through the same interface, so
  neither one's logic nor its authorization/audit behavior changes based
  on which is active — see
  "Dropbox (optional, for development/test only)" below to configure it.
- **Firm-wide Tasks and Calendar** — the sidebar's "Tasks" and "Calendar"
  items are real, authorized aggregate views over the existing per-matter
  `Task`/`Deadline`/`CalendarEvent` rows (`lib/tasks/queries.ts`,
  `lib/calendar/queries.ts`), not a second set of records or a new CRUD
  path: an `ADMIN` sees every matter's tasks/deadlines/events, everyone
  else sees only matters they're assigned to, scoped server-side the same
  way `lib/dashboard/queries.ts`'s widgets already are. Each page supports
  filtering (status/priority/assignee/matter/overdue for Tasks; matter/
  type/satisfied/upcoming-vs-past for Calendar) and links every row back to
  its matter's own Tasks or Deadlines & Calendar tab for editing — there is
  no separate edit path here. See `docs/ROADMAP.md`'s thirteenth-session
  milestone for the full writeup.
- **Firm-wide Discovery** — the sidebar's "Discovery" item is now a real,
  authorized aggregate view (`app/(dashboard)/discovery`,
  `lib/discovery/queries.ts#getFirmWideDiscoveryFiles`) over the existing
  per-matter `DiscoveryFile`/`DiscoveryProduction` rows the Discovery/Bates
  engine already writes — not a second Discovery record or a new upload/
  download path. An `ADMIN` sees every matter's discovery files, everyone
  else sees only matters they're assigned to, using the same
  `matterScopeFilterFor` helper the other firm-wide pages use, nested under
  `DiscoveryFile`'s `production` relation since `DiscoveryFile` has no
  `matterId` column of its own. The page supports filtering (matter, file
  type, review status) and recent/oldest sort, and every row links back to
  its matter's own Discovery tab rather than duplicating registration,
  comparison, or authenticated download logic. See `docs/ROADMAP.md`'s
  fifteenth-session milestone for the full writeup.
- **Firm-wide Reports** — the sidebar's "Reports" item is now a real,
  authorized operational reporting aggregate (`app/(dashboard)/reports`,
  `lib/reports/queries.ts#getFirmReportSummary`) over the existing
  `Task`/`Deadline`/`Document`/`DiscoveryFile`/`DiscoveryProduction`/`Call`/
  `Note` rows every other firm-wide page already reads — not a new record,
  a business-intelligence platform, or an export/integration project. It
  shows active-matter/task/deadline/document/discovery/call counts and
  status breakdowns (by matter, by assignee, by priority/status/type), plus
  a short recent-activity window (7/30/90 days or all time), all scoped the
  same way Tasks/Calendar/Communications/Discovery already are: an `ADMIN`
  sees firm-wide totals, everyone else only totals over matters they're
  assigned to, and the unfiled-call count uses the same `ADMIN`/`ATTORNEY`
  visibility rule Communications does. It deliberately reports only what
  the schema actually proves — no financial, billing, settlement, win-rate,
  case-outcome, or time-entry metrics exist to report. No third-party
  charting package was added; breakdowns use a small CSS-only bar
  component (`components/shared/stat-bar.tsx`). Date-window filtering uses
  the server's local time zone, the same convention the Dashboard and
  Calendar already use. See `docs/ROADMAP.md`'s Phase 7 entry for the full
  writeup.
- **Reversible Client/Matter archival** — Clients and Matters can now be
  archived and reactivated (`Client.archived`/`Matter.archived` in
  `prisma/schema.prisma`, `lib/matters/actions.ts#archiveMatter`/
  `reactivateMatter`, `lib/clients/actions.ts#archiveClient`/
  `reactivateClient`) instead of only ever being permanently deleted (which
  remains unbuilt — see "What's mocked" below). Archiving is a pure
  visibility flag: it never deletes anything and never touches a Matter's
  `status`/`closedDate` or any associated Note/Task/Deadline/Document/
  Discovery/Call/MatterAssignment/AuditEvent, all of which stay exactly as
  they were. An archived Matter/Client disappears from the default
  Matters/Clients lists and every firm-wide filter-bar's matter picker
  (Tasks/Calendar/Discovery/Communications/Reports all call
  `listMatters`'s new `{ view: "active" }` default), but a direct link to
  it still works exactly as before — archiving never changes matter-level
  authorization, only default-list visibility. Both lists have an
  Active/Archived toggle to view archived records explicitly. Archiving a
  Matter uses the exact same role rule as editing one
  (`lib/auth/access.ts#canEditMatter`: `ADMIN`, or an `ATTORNEY` actually
  assigned to it); archiving a Client uses the exact same rule as editing a
  Client (`canManageClientsAndMatters`: `ADMIN`/`ATTORNEY`) — no new
  permission was invented for this. Archiving a Client is blocked with a
  clear error while it still has any `OPEN`/`PENDING` Matter, so a case
  that's still active can never be silently hidden; a Client whose Matters
  are all `CLOSED` (or has none) can always be archived. No Prisma
  migration risk: the new columns are additive and default-`false`/null,
  so every existing row stays visible exactly as before. See
  `docs/ROADMAP.md`'s seventeenth-session milestone for the full writeup.

See "Demo login credentials" below to sign in, "What's mocked / not
implemented yet" below for exactly what still isn't real, and
[`docs/ROADMAP.md`](./docs/ROADMAP.md) for the full session-by-session
history of what's built vs. planned.

### Who can create/edit a Client or Matter

Neither `docs/SECURITY.md` nor `docs/DATA_MODEL.md` previously said who may
originate a brand-new Client or Matter — every other write path in the app
(Notes, Tasks, Calls, Discovery) checks an *existing* `MatterAssignment`,
but creating the very first record for a case has nothing to check yet.
Rather than default to "any logged-in user," this session picked a
conservative rule and wrote it down:

- **Only `ADMIN` and `ATTORNEY` may create a Client or Matter, edit a
  Client's fields, or edit a Matter's own fields
  (`lib/auth/authorization.ts#canManageClientsAndMatters`).**
- Editing an *existing* Matter additionally requires the normal
  matter-level check — an `ATTORNEY` must actually be assigned to that
  matter, not just hold the role (`lib/auth/access.ts#canEditMatter`).
- `PARALEGAL`/`STAFF` keep everything they already had: full read/write
  access to Notes, Tasks, Calls, and Discovery on matters they're assigned
  to. This rule only gates the Client/Matter records themselves and
  `MatterAssignment` membership.
- The Clients section of the sidebar is grayed out ("Restricted") for
  `PARALEGAL`/`STAFF` as a UI convenience — the actual enforcement is
  server-side in every `/clients*` and `/matters/new`, `/matters/*/edit`
  page and Server Action, independent of what the sidebar shows.

### Who can see an unfiled call

`Call.matterId` is nullable to represent an unfiled call — one not yet
attached to any matter (see `docs/DATA_MODEL.md`). Unlike every filed
sub-resource, an unfiled call has no `MatterAssignment` to check access
against, and `Call` carries no "logged by" column of its own (only
`filedById`/`filedAt`, which stay null until it's filed). Rather than
invent a new scoping concept or show every unfiled call's phone
numbers/notes to every authenticated user firm-wide, the firm-wide
Communications page reuses the rule directly above:

- **Only `ADMIN` and `ATTORNEY` can see unfiled calls**, on the
  Communications page (`lib/communications/queries.ts#getFirmWideCalls`) —
  the same `canManageClientsAndMatters` gate, for the same "no assignment
  to check against" reason.
- Filed calls are unaffected: everyone sees calls on matters they're
  assigned to, same as Notes/Tasks/Deadlines/Documents.
- **Known limitation:** a `PARALEGAL`/`STAFF` user who logs an unfiled
  call themselves can't see it again on this page — not even their own —
  to check on it or file it later. They'd need an `ADMIN`/`ATTORNEY` to do
  that, or file it directly to a matter at creation time instead of
  leaving it unfiled. The existing per-matter "attach an unfiled call to
  this matter" workflow (`components/shared/attach-call-list.tsx`,
  `getUnfiledCalls`) is unrelated and unchanged — it has no role gate of
  its own, and was preserved as-is rather than modified.

See `docs/SECURITY.md`'s Authorization section for the full writeup.

## Tech stack

- [Next.js](https://nextjs.org/) 16 (App Router, Turbopack) + TypeScript (`strict`)
- [PostgreSQL](https://www.postgresql.org/) + [Prisma](https://www.prisma.io/)
- [shadcn/ui](https://ui.shadcn.com/) primitives + Tailwind CSS
- [Auth.js](https://authjs.dev/) (NextAuth v5) — Credentials provider,
  JWT sessions, no OAuth/SSO provider configured
- [pdf-lib](https://pdf-lib.js.org/) for PDF page counting and Bates stamping
- [dropbox](https://www.npmjs.com/package/dropbox) (official SDK) for the
  optional development/test Dropbox storage backend
- [Vitest](https://vitest.dev/) for unit tests

## Getting started

Prerequisites: Node.js 20.9+ and a local PostgreSQL server (v14+).

```bash
# 1. Install dependencies
npm install

# 2. Configure environment variables
cp .env.example .env
# Fill in .env with real local values (see docs/SECURITY.md for handling
# requirements). Use .env, not .env.local — the Prisma CLI only auto-loads
# .env, and Next.js reads .env too, so one file covers both.

# 3. Create a local database and role, e.g.:
#      createuser -P frye_dev        (set a local-only password)
#      createdb -O frye_dev frye_case_management
#    Then set DATABASE_URL in .env to match, e.g.:
#      postgresql://frye_dev:<password>@localhost:5432/frye_case_management
#    Prisma's shadow database (used by `migrate dev`) additionally requires
#    the role to have CREATEDB privileges in development.

# 4. Apply the schema
npm run db:migrate

# 5. Load fake sample data AND fictional login users (see docs/SECURITY.md)
npm run db:seed

# 6. Run the dev server
npm run dev
```

Then visit http://localhost:3000 — it redirects to `/login`. Sign in with
any account from the table below.

### Opening in VS Code

No project-specific VS Code configuration is required — clone the repo,
open the folder, and follow the steps above in the integrated terminal.
Recommended extensions (not required, just nicer): **Prisma**
(`Prisma.prisma`, for `.prisma` syntax highlighting), **ESLint**
(`dbaeumer.vscode-eslint`), and **Tailwind CSS IntelliSense**
(`bradlc.vscode-tailwindcss`). TypeScript strict-mode errors and ESLint
warnings both surface inline once those are installed — the same checks
`npm run typecheck` and `npm run lint` run from the CLI.

### Dropbox (optional, for development/test only)

By default (`STORAGE_PROVIDER=local` or unset) Discovery files are stored
on local disk under `local-data/discovery-files/` — no setup needed
beyond the steps above. To instead exercise the Dropbox-backed
`DocumentStore` (`lib/storage/DropboxDocumentStore.ts`) against a real
**test** Dropbox account:

1. Create an app in the [Dropbox App
   Console](https://www.dropbox.com/developers/apps) with access type
   **"App folder"** (not "Full Dropbox") — this confines it to a single
   dedicated folder Dropbox creates for it, so it can never see the rest
   of that account. Use a personal/test Dropbox account, never the firm's
   real one.
2. Under that app's Permissions tab, enable only the `files.content.write`
   and `files.content.read` scopes.
3. Generate a refresh token for that app (Dropbox's OAuth2 flow with
   `token_access_type=offline`) — the app's "Generate access token" button
   in the console gives a short-lived token, not this; you need the
   refresh-token flow so the SDK can renew it automatically. Dropbox's
   [OAuth guide](https://developers.dropbox.com/oauth-guide) covers this.
4. Set in `.env` (never commit these):
   ```
   STORAGE_PROVIDER=dropbox
   DROPBOX_APP_KEY=<the app's key>
   DROPBOX_APP_SECRET=<the app's secret>
   DROPBOX_REFRESH_TOKEN=<the refresh token from step 3>
   DROPBOX_ROOT_PATH=/FryeCaseManagement-DEV
   ```
5. Restart the dev server. Registering a discovery file now uploads to
   `<App folder>/FryeCaseManagement-DEV/matters/...` in that test
   account's Dropbox instead of local disk — everything else about the
   Discovery workflow (hashing, Bates stamping, download, comparison,
   authorization, audit logging) is identical either way.

If `STORAGE_PROVIDER=dropbox` is set without all three `DROPBOX_*`
variables, the app fails to start with an error naming exactly which one
is missing, rather than silently using local disk or failing on the
first upload.

### Demo login credentials

All accounts are fictional, seeded by `prisma/seed.ts`, and share one
password so a demo doesn't require memorizing five of them. **Never reuse
this password anywhere real** — see `docs/SECURITY.md`.

| Email | Role | Assigned matters | What it demonstrates |
|---|---|---|---|
| `alex.rivera@fryelawgroup.example` | Admin | All (bypasses assignment checks) | Admin sees every matter regardless of assignment. |
| `sarah.whitfield@fryelawgroup.example` | Attorney | State v. Ellis, State v. Alvarez | A typical lead attorney's scoped view (2 of 4 matters). |
| `marcus.odom@fryelawgroup.example` | Attorney | State v. Marsh, State v. Patel | Same as above, different matters — proves scoping isn't hardcoded to one user. |
| `priya.nair@fryelawgroup.example` | Paralegal | All 4 (assigned to every matter) | A broadly-assigned support role — not an admin, but sees everything because she's genuinely assigned to all of it. |
| `taylor.brooks@fryelawgroup.example` | Staff | State v. Patel only | The clearest access-boundary demo: logging in as Taylor and trying to open any other matter's URL directly returns a 404, not an error page that reveals the matter exists. |

**Password for every account above:** `FryeDemo!2026`

### Available scripts

| Script | What it does |
|---|---|
| `npm run dev` | Start the dev server (Turbopack). |
| `npm run build` | Production build. |
| `npm run start` | Run a production build. |
| `npm run lint` | ESLint (flat config; Next.js no longer ships `next lint`). |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run test` | Run unit tests once (Vitest). |
| `npm run test:watch` | Run unit tests in watch mode. |
| `npm run db:migrate` | Create/apply a Prisma migration (`prisma migrate dev`). |
| `npm run db:seed` | Reset and reload fake sample data + login users (`prisma/seed.ts`). |
| `npm run db:reset` | Drop, recreate, migrate, and reseed the database. |
| `npm run db:studio` | Open Prisma Studio to browse the database. |

## What's mocked / not implemented yet

- **No Client/Matter *deletion*.** Create, edit, and — as of the
  seventeenth session — reversible archive/reactivate are all real (see
  "Current status" and "Who can create/edit a Client or Matter" above);
  permanent deletion remains explicitly out of scope, since nothing in
  this system's data model supports safely un-deleting a case record.
- **No Note/Task deletion.** Create and edit are real (Note edit as of the
  twelfth session, Task edit as of the twelfth session — see "Current
  status" above); deletion wasn't built, same reasoning as Client/Matter
  above.
- **No Document *deletion*.** Upload and metadata edit are real as of the
  eleventh session (see "Current status" above); same reasoning as
  Client/Matter/Deadline/CalendarEvent above.
- **No production Dropbox, Vonage, Loop/HighLevel, MyCase, or QuickBooks
  integration.** A **development/test** Dropbox integration exists (see
  "Current status" and the setup steps above), but it's not the
  production integration: no firm-owned Dropbox app, no per-matter folder
  convention, no encrypted-at-rest token storage — see
  `docs/ARCHITECTURE.md`'s "Documents & Dropbox" section for the full
  list; calls are manually-logged/seeded/attached rows, not pulled from
  Vonage — see "Current status" above for what's real about Call logging.
- **The Matter Overview's "Quick actions"** — Add Note, New Task, New
  Deadline, Upload Document, and (as of the fourteenth session) Log a Call
  all link to the tab with the real form. None are mocked anymore.
- **Discovery productions/comparisons seeded before the Bates engine
  existed** (see `prisma/seed.ts`) remain in the database as illustrative
  historical data with no real stored files behind them — anything created
  through the Discovery tab's UI is real.
- **Every sidebar item is now real.** Tasks and Calendar are real firm-wide
  aggregate views as of the thirteenth session, Communications as of the
  fourteenth, Discovery as of the fifteenth, and Reports as of the
  sixteenth (see "Current status" above). Clients is real but shown as
  "Restricted" for `PARALEGAL`/`STAFF` accounts (see "Who can create/edit a
  Client or Matter" above). Reports does not report financial, billing,
  settlement, win-rate, case-outcome, or time-entry metrics — that data
  doesn't exist in the schema yet (see `docs/DATA_MODEL.md`).
- **Authentication is real, but incomplete for production use:** no MFA,
  no rate-limiting/lockout on failed logins, no forced sign-out when a
  user's role or assignments change mid-session, no HTTPS enforcement, and
  every seeded account shares one password. None of this is acceptable
  once real staff accounts or real case data are involved — see
  `docs/SECURITY.md`'s "Implementation status" section for the full list.
- **Audit logging covers every write listed in "Current status" above**
  (Client/Matter create/update, MatterAssignment add/remove, Deadline
  create/update/status-change, CalendarEvent create/update, Document
  upload/metadata-edit, Note/Task update, and Call create/attach all
  included, plus file downloads — Discovery and general Documents both —
  logged as `EXPORT`), but login/logout and permission-denial events
  aren't logged yet, and neither are the not-yet-built writes (Note/Task
  deletion, etc.) — see `docs/SECURITY.md`.

### Known limitations to address in the next phase

- **No row-level locking on Bates sequencing.** Two simultaneous file
  registrations on the same production could race on
  `DiscoveryProduction.batesStart`/`batesEnd`. Fine at current
  single-firm, low-concurrency scale; would need a `SELECT ... FOR UPDATE`
  (or similar) to be airtight.
- **No custom Bates starting number.** Every production starts numbering
  at 1 — there's no way to continue a physical/pre-existing Bates range
  from outside this system.
- **Orphaned storage risk on a failed registration/upload.** A discovery
  file's or general document's bytes are written to storage before the
  database row is created; if the DB write fails after a successful
  storage write, the file is left behind with no DB record pointing to it.
  `DocumentStore` has no delete method, so there's nothing to clean up —
  acceptable for a local dev/demo store, worth revisiting (along with
  adding a delete method) before any real storage backend.
- **Neither `DocumentStore` implementation is the final production storage
  backend.** `DropboxDocumentStore` is real, but it's a development/test
  integration (a personal-dev Dropbox app, a flat dev key scheme, an
  unencrypted local refresh token) — real discovery evidence needs a
  firm-owned Dropbox app, a production folder convention, and encrypted
  credential storage before this system holds anything but fictional
  test files. No migration tooling exists to move files already on local
  disk into Dropbox (or vice versa) if the active provider changes.
- **Deadline and CalendarEvent have no assignee/attendee field.**
  `prisma/schema.prisma` doesn't carry one for either model (unlike
  `Task.assignedToId`), so their New/Edit forms don't have a staff picker —
  adding one is a schema change, not just a UI gap.
- **General Documents have no preview.** Uploaded files are stored and
  served back byte-for-byte and are never opened, rendered, or transformed
  server-side — downloading is the only way to view one. The upload
  allowlist (PDF, Word, Excel, text, common image formats) is about
  keeping the demo to ordinary case documents, not a content-scanning
  security control.
- **`datetime-local` inputs (Calendar Events) have no timezone field.** A
  submitted start/end time is parsed as the server process's local time,
  same simplification `Task.dueDate`'s plain `date` input already made —
  fine for a single-timezone dev/demo firm, worth revisiting before any
  multi-timezone or production deployment. The firm-wide Calendar page
  (`app/(dashboard)/calendar`) reads and displays the same
  already-stored values, so it carries this exact limitation forward
  rather than introducing a second, partial timezone fix.

## Working with confidential data

This system is designed to eventually hold privileged, confidential
criminal-defense case information. **Never use real client or case data**
in development, testing, examples, or anywhere in this repository — always
use clearly fictional data. See `docs/SECURITY.md` for full requirements.

## Contributing / continuing this project

This project is intended to be maintained by a single developer, possibly
across multiple machines and sessions (including with AI coding
assistants). `CLAUDE.md` is the entry point for anyone (human or AI)
picking this project back up — read it first.
