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

**Groundwork phase.** This repository currently contains documentation,
configuration, and empty folder scaffolding only — there is no working
application yet. See `docs/ROADMAP.md` for what's done and what's next
(Phase 0 vs. Phase 1+).

## Planned tech stack

- [Next.js](https://nextjs.org/) (App Router) + TypeScript
- [PostgreSQL](https://www.postgresql.org/) + [Prisma](https://www.prisma.io/)
- [shadcn/ui](https://ui.shadcn.com/) + Tailwind CSS
- [Auth.js](https://authjs.dev/) for authentication

## Getting started (once Phase 1 lands)

The application isn't scaffolded yet, so there's nothing to run today.
Once Phase 1 (`docs/ROADMAP.md`) is complete, development setup will look
like:

```bash
# 1. Install dependencies
npm install

# 2. Configure environment variables
cp .env.example .env.local
# then fill in .env.local with real local values — see docs/SECURITY.md
# for handling requirements. Never commit .env.local.

# 3. Set up the database
npx prisma migrate dev

# 4. Run the dev server
npm run dev
```

This section will be updated as soon as the app is actually runnable.

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
