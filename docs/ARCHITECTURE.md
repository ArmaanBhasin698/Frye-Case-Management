# Architecture

## Design goal

A single developer must be able to hold this entire system in their head.
Every choice below optimizes for that over theoretical scalability or
flexibility this firm doesn't need.

## High-level shape

```
                    ┌─────────────────────────────┐
                    │        Next.js app          │
                    │  (UI + Server Actions/API)  │
                    └───────────────┬──────────────┘
                                    │ Prisma
                                    ▼
                          ┌───────────────────┐
                          │   PostgreSQL DB    │
                          │ (all structured    │
                          │  case data)        │
                          └───────────────────┘

        Future, isolated behind interfaces (not built yet):
        ┌───────────┐  ┌───────────┐  ┌────────────────┐  ┌───────────┐
        │  Dropbox  │  │  Vonage   │  │ Loop/HighLevel  │  │QuickBooks │
        │(documents)│  │(calls/SMS)│  │   (intake)      │  │ (billing) │
        └───────────┘  └───────────┘  └────────────────┘  └───────────┘
```

One deployable application. No microservices, no separate API server, no
message queue — none of that is justified by the actual scale (one firm,
a handful of staff, thousands of matters at most).

## Why Next.js + TypeScript

- One codebase, one deployment, for both UI and backend. Server Actions and
  Route Handlers remove the need for a separate API project.
- TypeScript end-to-end (including Prisma-generated types) means schema
  changes surface as compile errors in the UI, which matters a lot for a
  solo maintainer with no QA team.
- Large ecosystem and long-term support reduce the risk of the framework
  becoming a maintenance burden itself.

## Why PostgreSQL + Prisma

- Case management data is fundamentally relational (clients → matters →
  tasks/deadlines/discovery/communications). Postgres is the right shape for
  that, and is a safe, boring, well-understood default.
- Prisma gives type-safe queries and a migration workflow that's easy for
  one person to manage without a DBA.
- JSON columns (`jsonb`) are available for the few places semi-structured
  data makes sense (e.g., audit event metadata) without needing a second
  database technology.

## Why shadcn/ui

- Ships accessible, unstyled-enough components as code you own (not an
  opaque npm dependency), which keeps the UI consistent without locking us
  into a component library's release cycle.
- Pairs naturally with Tailwind, which keeps styling co-located and fast to
  change without a separate design-system project.

## Authentication & authorization

- Auth.js (NextAuth) handles session management. Start with
  email+password (hashed with a strong algorithm, e.g. argon2/bcrypt);
  structure it so MFA (TOTP) can be added later without restructuring.
- Roles (initial set, expand as needed): `admin`, `attorney`, `paralegal`,
  `staff`. Authorization is enforced server-side, per request, based on
  role **and** explicit matter assignment — an attorney/paralegal should
  only see matters they're assigned to unless they're an admin. This mirrors
  how confidentiality actually works in a law firm.
- No client-side-only access control. UI hiding is a convenience, not a
  security boundary.

## Documents & Dropbox

Dropbox remains the actual file store. This application will (in a later
phase, not now):

- Store Dropbox paths/IDs and metadata in Postgres (`Document`,
  `DiscoveryFile` records), not file contents.
- Enforce a **standardized folder structure per matter** in Dropbox (defined
  in a future `docs/DISCOVERY.md` once that phase starts) so discovery,
  correspondence, pleadings, etc. are organized consistently across all
  matters.
- Talk to Dropbox only through a narrow internal interface
  (e.g. `lib/storage/DocumentStore`), so the Dropbox SDK is never called
  directly from UI code, and swapping/mocking it later is straightforward.

## Calls & Vonage

Similarly deferred, but planned for behind an interface
(e.g. `lib/telephony/CallProvider`) so that, when built, staff can:

- View/search call and SMS activity.
- Flag a call and attach it to the correct client/matter.
- Add notes to a call.
- Save the recording into the matter's Dropbox structure and create a
  corresponding `Call` record in Postgres.

## Discovery management (core differentiator)

Planned architecture (not implemented yet — see `docs/ROADMAP.md`):

- Each `DiscoveryProduction` represents one batch of discovery received
  (e.g., "Initial Production", "Supplemental Production 2").
- Every file gets a stable, consistent identifier: Bates numbers for PDFs
  (applied by the system, not manually), and a parallel consistent ID scheme
  for non-paginated media (video/audio/photo) that doesn't naturally take
  Bates numbers.
- Original files are always preserved untouched; numbering/identifiers are
  applied to copies or via a non-destructive overlay, never by mutating the
  source file the firm received.
- Re-served discovery can be compared production-to-production to flag
  files that are new, changed (e.g., re-hashed/modified), duplicated, or
  missing relative to a prior production. This requires content hashing and
  metadata comparison — logic that belongs in `lib/discovery/`, fully unit
  tested, independent of the UI.

## Folder structure

```
/
├── app/                        # Next.js App Router
│   ├── (auth)/                 # Sign-in, sign-out routes
│   ├── (dashboard)/            # Authenticated app shell
│   │   ├── clients/
│   │   ├── matters/
│   │   ├── tasks/
│   │   ├── calendar/
│   │   ├── discovery/
│   │   ├── communications/
│   │   └── reports/
│   └── api/                    # Route Handlers (only where Server Actions don't fit, e.g. webhooks later)
├── components/
│   ├── ui/                     # shadcn/ui primitives (generated, owned code)
│   └── shared/                 # App-specific shared components
├── lib/
│   ├── auth/                   # Auth.js config, session/permission helpers
│   ├── db/                     # Prisma client singleton
│   ├── discovery/              # Bates numbering, identifiers, comparison logic (future)
│   ├── storage/                # Dropbox interface (future)
│   ├── telephony/              # Vonage interface (future)
│   ├── validation/             # Zod schemas
│   └── utils/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── docs/                        # This documentation
├── types/                       # Shared types not generated by Prisma
├── tests/
├── public/
├── .env.example
├── CLAUDE.md
└── README.md
```

This structure is created as empty scaffolding in this groundwork phase;
files are added feature-by-feature.

## Deployment (future decision, not needed yet)

Not decided in this session — options to evaluate when it's time to deploy
a working app: a managed Postgres provider (e.g. Neon, RDS, Supabase-as-DB)
plus a Node-friendly host (Vercel, Fly.io, a small VPS). Whatever is chosen
must support environment-variable-based secrets and regular automated
backups given the sensitivity of the data.
