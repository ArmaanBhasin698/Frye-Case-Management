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

Dropbox will eventually be the actual production file store. `lib/storage/DocumentStore`
is the narrow interface every file-backed feature talks to instead of a
storage SDK directly, and as of the eighth session it has **two** real
implementations, selected via `STORAGE_PROVIDER` (see `.env.example`):

- `LocalDocumentStore` (default, `STORAGE_PROVIDER=local` or unset) —
  writes fictional/test discovery files to a gitignored
  `local-data/discovery-files/` directory. No credentials, fully offline.
- `DropboxDocumentStore` (`STORAGE_PROVIDER=dropbox`,
  `lib/storage/DropboxDocumentStore.ts`) — writes the same fictional/test
  files to a dedicated Dropbox **test** folder
  (`DROPBOX_ROOT_PATH`, default `/FryeCaseManagement-DEV`) via the
  official `dropbox` SDK, authenticated with a long-lived refresh token
  (`DROPBOX_APP_KEY`/`DROPBOX_APP_SECRET`/`DROPBOX_REFRESH_TOKEN`). This is
  a **development/test** integration, not the production Dropbox
  integration described below — see docs/SECURITY.md for exactly what
  still needs to change before real discovery evidence goes anywhere near
  it.

Both implementations satisfy the same `save(key, data)`/`read(key)`
contract, so:

- `lib/discovery/actions.ts` and, as of the eleventh session,
  `lib/documents/actions.ts` both call `documentStore.save`/`.read` — they
  have no idea, and don't need to know, whether that's local disk or
  Dropbox underneath. Nothing in either module changed to add the Dropbox
  implementation, and nothing in `lib/documents/` needs to change if/when
  `STORAGE_PROVIDER` switches to `dropbox` for real matter documents —
  proving out the interface's whole reason for existing (see the
  sixth-session milestone in `docs/ROADMAP.md`).
- `lib/storage/DocumentStore.ts#createDocumentStore()` picks the
  implementation once, at module load, via `lib/storage/config.ts`. An
  incomplete Dropbox configuration fails immediately and loudly (a clear
  error naming which environment variable is missing) rather than
  silently falling back to local disk or failing confusingly mid-request.
- A **standardized folder structure per matter** in Dropbox for real
  production use (defined in a future `docs/DISCOVERY.md` once that phase
  starts) will likely replace both Discovery's flat
  `matters/<id>/discovery/<productionId>/<uuid>/...` key scheme and
  Documents' flat `matters/<id>/documents/<uuid>/original` scheme so
  discovery, correspondence, pleadings, etc. are organized consistently
  across all matters — that key scheme is unchanged by the Dropbox
  storage backend, since key generation lives in `lib/discovery/actions.ts`
  and `lib/documents/actions.ts` respectively, not in either
  `DocumentStore` implementation. Neither key scheme ever embeds the
  uploaded file's real name — only a server-generated id — since a
  client-supplied filename could contain a client's real name or other
  case details that must never end up in a storage path (see
  docs/SECURITY.md); the true original filename is preserved only as DB
  metadata (`Document.originalFilename`).
- `Document` (general, non-discovery files) now uses `DocumentStore` for
  real — `lib/documents/actions.ts#uploadDocument` saves the uploaded
  bytes and creates the `Document` row; `updateDocumentMetadata` edits
  title/category/notes only and never touches the stored bytes or
  `storageKey`. Downloads stream through
  `app/(dashboard)/matters/[matterId]/documents/files/[documentId]/route.ts`,
  the same authenticated-Route-Handler pattern Discovery's download route
  already established (see docs/SECURITY.md).

**What's still required before Dropbox is safe for production use** (not
done in this pass — see docs/SECURITY.md): a production Dropbox app (not
a personal dev app), a real per-matter/per-firm folder convention instead
of the flat dev key schemes, encrypted-at-rest storage of the refresh
token in a real secrets manager instead of a local `.env` file, monitoring/
alerting on storage errors, and a decision on what happens to files
already on local disk if a firm ever migrates from local to Dropbox
storage (no migration tooling exists — this pass only adds the second
implementation, it doesn't move data between them). The firm's real
Dropbox account also still requires staff 2FA to authorize, which is
explicitly deferred — `STORAGE_PROVIDER` stays on `local` for all
browser/integration testing until that happens.

## Calls & Vonage

Similarly deferred, but planned for behind an interface
(e.g. `lib/telephony/CallProvider`) so that, when built, staff can:

- View/search call and SMS activity.
- Flag a call and attach it to the correct client/matter.
- Add notes to a call.
- Save the recording into the matter's Dropbox structure and create a
  corresponding `Call` record in Postgres.

## Discovery management (core differentiator)

Real as of the fifth session (see `docs/ROADMAP.md`) — `lib/discovery/` is
fully unit tested and independent of the UI:

- Each `DiscoveryProduction` represents one batch of discovery received
  (e.g., "Initial Production", "Supplemental Production 2"), created via
  the Discovery tab's "New Production" form
  (`lib/discovery/actions.ts#createDiscoveryProduction`).
- Registering a file (`#registerDiscoveryFile`) computes a SHA-256 content
  hash (`lib/discovery/hash.ts`) and, for PDFs, reads the page count and
  generates a Bates-stamped derivative (`lib/discovery/pdf.ts`, via
  `pdf-lib`) with a sequential range continuing from whatever's already
  been assigned in that production (`lib/discovery/bates.ts`). Non-paginated
  media (video/audio/photo/other) gets a sequential evidence ID instead of
  pretending to have page numbers.
- Original files are always preserved untouched — stamping loads the bytes
  into a fresh in-memory PDF document and saves a *new* byte array; the
  stored original is never written to. Both the original and the stamped
  derivative are saved via `lib/storage/DocumentStore` under separate keys.
- Re-served discovery is compared production-to-production
  (`lib/discovery/compare.ts`, run via `#runDiscoveryComparison`) to flag
  files as new, changed, duplicated, or missing relative to a prior
  production — matched first by content hash (so a rename doesn't register
  as a new file), falling back to filename (so a same-named file with
  different content is flagged as changed rather than missed).

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
│   ├── dashboard/               # Cross-matter aggregate reads for the dashboard home page
│   ├── matters/                 # Matter-scoped data access + presentation helpers (format.ts)
│   ├── clients/                 # Client CRUD data access + Server Actions
│   ├── discovery/              # Bates numbering, identifiers, comparison logic
│   ├── documents/               # General (non-discovery) matter document upload/edit
│   ├── storage/                # DocumentStore interface (local disk + Dropbox implementations)
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

This structure was created as empty scaffolding in the groundwork phase and
is now populated feature-by-feature — the `matters/` slice (list, detail,
and its tabs) is the first real example. See `docs/ROADMAP.md` for what's
built vs. still a placeholder.

## Deployment (future decision, not needed yet)

Not decided in this session — options to evaluate when it's time to deploy
a working app: a managed Postgres provider (e.g. Neon, RDS, Supabase-as-DB)
plus a Node-friendly host (Vercel, Fly.io, a small VPS). Whatever is chosen
must support environment-variable-based secrets and regular automated
backups given the sensitivity of the data.
