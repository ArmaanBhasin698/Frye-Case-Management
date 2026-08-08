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

**Polished visual prototype with real authentication, built on the
Matters vertical slice.** The app runs with a firm-wide Dashboard, a
Matters list, and a Matter detail view (Overview, Discovery, Documents,
Calls, Notes, Tasks, Deadlines, Timeline tabs) backed by a real Postgres
database via Prisma. The Discovery tab demos a New/Changed/Duplicate/
Missing production comparison, the Calls tab demos attaching an unfiled
call to a matter, and Tasks is a drag-and-drop Kanban board — all on
fictional seeded data, all clearly marked where the interaction is
UI-only.

Login is real: Auth.js (credentials, fictional dev users) gates every
page, and matter-level authorization is enforced server-side — admins see
every matter, everyone else only sees matters they're assigned to,
including on a direct URL to a matter they don't have. See "Demo login
credentials" below to sign in, and
[`docs/ROADMAP.md`](./docs/ROADMAP.md) for exactly what's built vs.
planned, and "What's mocked / not implemented yet" below for what auth
does *not* cover yet (no create/edit forms, no MFA, no rate limiting).

## Tech stack

- [Next.js](https://nextjs.org/) 16 (App Router, Turbopack) + TypeScript (`strict`)
- [PostgreSQL](https://www.postgresql.org/) + [Prisma](https://www.prisma.io/)
- [shadcn/ui](https://ui.shadcn.com/) primitives + Tailwind CSS
- [Auth.js](https://authjs.dev/) (NextAuth v5) — Credentials provider,
  JWT sessions, no OAuth/SSO provider configured
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

This is intentionally a small slice. Not real, not built, or not wired up
yet:

- **Authentication and matter-level authorization are real** (Auth.js,
  credentials login, server-side enforcement — see `docs/SECURITY.md`),
  but several things around them are still dev-only or missing: no MFA,
  no rate-limiting/lockout on failed logins, no forced sign-out when a
  user's role or assignments change mid-session, no HTTPS enforcement,
  and every seeded account shares one password. None of this is
  acceptable once real staff accounts or real case data are involved —
  see `docs/SECURITY.md`'s "Implementation status" section for the full
  list.
- **No create/edit forms.** Everything currently on screen is read-only,
  rendered from seed data — there's no way yet to add a matter, note, task,
  etc. through the UI. The Matter Overview's "Quick actions" buttons (Add
  Note, Log a Call, Upload Document, New Task) show what the entry point
  will feel like but only display a "coming soon" message.
- **No Dropbox, Vonage, Loop/HighLevel, MyCase, or QuickBooks integration.**
  General (non-discovery) documents show fake Dropbox paths as plain text;
  calls are manually-seeded rows, not pulled from Vonage. Discovery files
  are stored on local disk (`lib/storage/DocumentStore`) as a stand-in
  behind the same interface Dropbox will eventually implement.
- **Bates numbering and discovery comparison are real** for anything
  created through the Discovery tab: registering a PDF hashes it, reads
  its page count, and generates a separate Bates-stamped derivative
  (original untouched); "Compare" classifies files as New/Changed/
  Duplicate/Missing using stored hashes and filenames (`lib/discovery/`).
  Productions/comparisons seeded before this feature existed remain as
  illustrative historical demo data with no real stored files behind them.
- **Tasks board drag-and-drop is UI-only.** Moving a card between columns
  updates the screen, not the database — there's no Task-update Server
  Action yet, so refreshing resets it.
- **"Attach to Matter" on the Calls tab is UI-only.** Clicking it updates
  local component state to show the intended workflow; it doesn't file the
  call in the database.
- **Sidebar items other than Dashboard/Matters** (Clients, Tasks, Calendar,
  Discovery, Communications, Reports) are shown but disabled ("Soon") —
  present for layout/orientation, not yet functional as their own
  sections.
- **Audit trail is seeded, not generated.** `AuditEvent` rows exist to
  demonstrate the Timeline tab, but since there are no write actions yet,
  nothing in the running app currently produces them — including login/
  logout and permission-denial events, which `docs/SECURITY.md` calls for
  logging but which aren't wired up yet.

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
