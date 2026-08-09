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
Deadlines, Timeline tabs) backed by a real Postgres database via Prisma.

What's genuinely real, end to end (server-side auth + authorization + Zod
validation + audit logging on every write — see `docs/SECURITY.md`):

- **Login/logout and matter-level authorization** — Auth.js (credentials,
  fictional dev users); admins see every matter, everyone else only what
  they're assigned to, including on a direct URL to a matter they don't
  have (a 404, not a distinguishable "access denied").
- **Notes, tasks, and task status** — Add Note and New Task persist to
  Postgres; the Kanban board's drag-and-drop persists a task's status and
  survives a refresh (optimistic UI, reverts if the write fails).
- **Attaching an unfiled call to a matter** — persists `Call.matterId`,
  survives a refresh.
- **The audit Timeline** — reflects real `AuditEvent` rows produced by the
  writes above, not just seed data.
- **Discovery/Bates engine** — creating a production, registering a file
  (PDF, video, audio, photo, or other), and comparing two productions are
  all real: registering a file computes a SHA-256 hash and, for PDFs,
  generates a separate Bates-stamped derivative (the original is never
  modified); comparing two productions classifies every file as
  New/Changed/Duplicate/Missing using stored hashes and filenames, not
  hand-picked results. See `lib/discovery/`.

See "Demo login credentials" below to sign in, "What's mocked / not
implemented yet" below for exactly what still isn't real, and
[`docs/ROADMAP.md`](./docs/ROADMAP.md) for the full session-by-session
history of what's built vs. planned.

## Tech stack

- [Next.js](https://nextjs.org/) 16 (App Router, Turbopack) + TypeScript (`strict`)
- [PostgreSQL](https://www.postgresql.org/) + [Prisma](https://www.prisma.io/)
- [shadcn/ui](https://ui.shadcn.com/) primitives + Tailwind CSS
- [Auth.js](https://authjs.dev/) (NextAuth v5) — Credentials provider,
  JWT sessions, no OAuth/SSO provider configured
- [pdf-lib](https://pdf-lib.js.org/) for PDF page counting and Bates stamping
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

- **No Client/Matter create-edit-delete.** You can't add a client or
  matter, or edit/delete one, through the UI yet — only the writes listed
  in "Current status" above exist (Notes, Tasks, Task status, Call attach,
  Discovery production/file/comparison). `MatterAssignment` (who's staffed
  on a matter) is display-only, no UI to change it.
- **No Note/Task edit or delete**, no Deadline or CalendarEvent writes —
  those tabs are still read-only views over seed data.
- **No Dropbox, Vonage, Loop/HighLevel, MyCase, or QuickBooks integration.**
  General (non-discovery) documents show fake Dropbox paths as plain text
  with no real file behind them; calls are manually-seeded/attached rows,
  not pulled from Vonage. Discovery files are stored on local disk
  (`lib/storage/DocumentStore`) as a stand-in behind the same interface
  Dropbox will eventually implement — see `docs/ARCHITECTURE.md`.
  General (non-discovery) document upload isn't built, so `DocumentStore`
  is only wired up for Discovery so far.
- **The Matter Overview's "Quick actions"** — Add Note and New Task link
  to the tabs with the real forms; "Log a Call" (logging a *new* call, as
  opposed to attaching an already-existing unfiled one) and "Upload
  Document" still just show a "coming soon" message.
- **Discovery productions/comparisons seeded before the Bates engine
  existed** (see `prisma/seed.ts`) remain in the database as illustrative
  historical data with no real stored files behind them — anything created
  through the Discovery tab's UI is real.
- **Sidebar items other than Dashboard/Matters** (Clients, Tasks, Calendar,
  Discovery, Communications, Reports) are shown but disabled ("Soon") —
  present for layout/orientation, not yet functional as their own
  firm-wide sections (Tasks and Discovery both exist per-matter, under a
  Matter's tabs).
- **Authentication is real, but incomplete for production use:** no MFA,
  no rate-limiting/lockout on failed logins, no forced sign-out when a
  user's role or assignments change mid-session, no HTTPS enforcement, and
  every seeded account shares one password. None of this is acceptable
  once real staff accounts or real case data are involved — see
  `docs/SECURITY.md`'s "Implementation status" section for the full list.
- **Audit logging covers every write listed in "Current status" above**
  (plus file downloads, logged as `EXPORT`), but login/logout and
  permission-denial events aren't logged yet, and neither are the
  not-yet-built writes (Client/Matter/Deadline/etc.) — see
  `docs/SECURITY.md`.

### Known limitations to address in the next phase

- **No row-level locking on Bates sequencing.** Two simultaneous file
  registrations on the same production could race on
  `DiscoveryProduction.batesStart`/`batesEnd`. Fine at current
  single-firm, low-concurrency scale; would need a `SELECT ... FOR UPDATE`
  (or similar) to be airtight.
- **No custom Bates starting number.** Every production starts numbering
  at 1 — there's no way to continue a physical/pre-existing Bates range
  from outside this system.
- **Orphaned storage risk on a failed registration.** A discovery file's
  bytes are written to `local-data/discovery-files/` before the database
  row is created; if the DB write fails after a successful disk write, the
  file is left on disk with no DB record pointing to it. Acceptable for a
  local dev/demo store, worth revisiting before any real storage backend.
- **`LocalDocumentStore` is not the final storage backend.** It's a
  correct implementation of the `DocumentStore` interface, but real
  discovery evidence needs Dropbox (or another durable, backed-up store)
  before this system holds anything but fictional test files.

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
