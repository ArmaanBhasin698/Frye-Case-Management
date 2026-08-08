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

**First vertical slice: Matters.** The app now runs, with a dashboard shell
and a working Matters list + Matter detail view (Overview, Discovery,
Documents, Calls, Notes, Tasks, Deadlines, Timeline tabs) backed by a real
Postgres database via Prisma. There is no authentication yet, no
create/edit forms, and no third-party integrations — see
[`docs/ROADMAP.md`](./docs/ROADMAP.md) for exactly what's built vs. planned,
and the "What's mocked / not implemented yet" section below.

## Tech stack

- [Next.js](https://nextjs.org/) 16 (App Router, Turbopack) + TypeScript (`strict`)
- [PostgreSQL](https://www.postgresql.org/) + [Prisma](https://www.prisma.io/)
- [shadcn/ui](https://ui.shadcn.com/) primitives + Tailwind CSS
- [Auth.js](https://authjs.dev/) for authentication (planned — not wired up yet)

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

# 5. Load fake sample data (clearly fictional — see docs/SECURITY.md)
npm run db:seed

# 6. Run the dev server
npm run dev
```

Then visit http://localhost:3000 — it redirects to `/matters`.

### Available scripts

| Script | What it does |
|---|---|
| `npm run dev` | Start the dev server (Turbopack). |
| `npm run build` | Production build. |
| `npm run start` | Run a production build. |
| `npm run lint` | ESLint (flat config; Next.js no longer ships `next lint`). |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run db:migrate` | Create/apply a Prisma migration (`prisma migrate dev`). |
| `npm run db:seed` | Reset and reload fake sample data (`prisma/seed.ts`). |
| `npm run db:reset` | Drop, recreate, migrate, and reseed the database. |
| `npm run db:studio` | Open Prisma Studio to browse the database. |

## What's mocked / not implemented yet

This is intentionally a small first slice. Not real, not built, or not
wired up yet:

- **No authentication.** There is no login; the app shows all matters to
  anyone who can reach it. The topbar's "Dev preview — no login yet" badge
  is a deliberate, visible reminder of this gap. Do not deploy this
  anywhere reachable by non-developers until Auth.js + matter-level
  authorization (`docs/ROADMAP.md`, Phase 1–2) are in place.
- **No create/edit forms.** Everything currently on screen is read-only,
  rendered from seed data — there's no way yet to add a matter, note, task,
  etc. through the UI.
- **No Dropbox, Vonage, Loop/HighLevel, MyCase, or QuickBooks integration.**
  Documents/discovery show fake Dropbox paths as plain text; calls are
  manually-seeded rows, not pulled from Vonage.
- **No Bates numbering or discovery comparison logic.** The Discovery tab
  only lists production/file records seeded directly into the database.
- **Sidebar items other than Matters** (Clients, Tasks, Calendar, Discovery,
  Communications, Reports) are shown but disabled ("Soon") — present for
  layout/orientation, not yet functional as their own sections.
- **Audit trail is seeded, not generated.** `AuditEvent` rows exist to
  demonstrate the Timeline tab, but since there are no write actions yet,
  nothing in the running app currently produces them.

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
