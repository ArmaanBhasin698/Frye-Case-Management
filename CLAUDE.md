# CLAUDE.md

This file gives Claude (and any other AI coding assistant) the context needed to
work correctly and safely in this repository. Read this before making changes.

## 1. What this project is

Frye Case Management is a custom case-management platform being built for a
criminal defense law firm. It is being developed incrementally, one developer
at a time, potentially across multiple machines and multiple Claude Code
sessions. There is no team of engineers behind this — architecture and code
must stay simple enough for one person to fully understand and maintain.

The system will eventually manage, for every criminal matter the firm
handles:

- Clients and contacts (witnesses, opposing counsel, experts, judges, etc.)
- Matters / cases
- Attorney and staff assignments
- Notes
- Tasks
- Deadlines (including statute-of-limitations and speedy-trial deadlines)
- Calendar events
- Communications (calls, SMS, email, letters)
- Criminal discovery (documents, video, audio, photos)
- General documents
- Reporting
- Full activity/audit history

### What we're keeping vs. replacing

| Tool | Status | Notes |
|---|---|---|
| Loop / HighLevel | **Keep** | Leads and intake stay here. This system starts at the "client is retained" stage — new contacts are pulled into a staff-review queue, never turned into a Client automatically. |
| MyCase | **Replace** | This platform replaces MyCase for active client and case management. |
| monday.com | **Possibly replace** | Tasks/workflows may move here later. Not a v1 goal. |
| Dropbox | **Keep** | Remains the source of truth for document storage. This app organizes, indexes, and links to Dropbox files/folders — it does not become a second file store. |
| Vonage | **Keep** | Remains the phone/SMS provider. This app will eventually surface and file call/SMS activity against the right client/matter. |
| QuickBooks Online | **Keep (future)** | Billing/accounting integration is a later phase, not v1. |

Integration status differs per tool — some code exists for HighLevel,
Dropbox, and Vonage, none for MyCase or QuickBooks, and **none of it is
connected to production**. See "Integration status" in section 2.

## 2. Current phase — functional MVP, pre-production

The application is a working Next.js + Prisma + PostgreSQL app, not
scaffolding (verified against the codebase in October 2026). It has been
built and exercised **only with fictional data and fictional development
accounts**. It is **not deployed to production**: no hosting, production
database, real staff account, or real client data exists yet. What still
blocks production use is tracked in `docs/PRODUCTION_READINESS.md`; the
session-by-session build history is in `docs/ROADMAP.md`.

### Current architecture

One Next.js App Router application serves both UI and backend:

- **Routes** — `app/(auth)/` (login, MFA, forced password change, signup),
  `app/(dashboard)/` (all signed-in pages), and `app/api/` (Auth.js, health
  check, HighLevel cron/webhook endpoints).
- **Route gate** — `proxy.ts` redirects any request without a session to
  `/login`, except the explicitly public auth pages and the API routes that
  carry their own secret check. It only checks "signed in"; real
  authorization happens server-side per request (section 4).
- **Business logic** — `lib/<module>/` (`queries.ts` for reads,
  `actions.ts` for Server Action writes), with authorization helpers in
  `lib/auth/access.ts` and `lib/auth/authorization.ts`.
- **Data** — `prisma/schema.prisma` plus migrations in `prisma/migrations/`.
- **Tests** — Vitest unit tests in `tests/`, mirroring `lib/` modules.

### Implemented modules

- **Authentication & user management** — Auth.js credentials login with
  JWT sessions, TOTP MFA (with recovery codes and admin-assisted reset),
  forced first-login password change, self-registration that creates
  `PENDING` accounts only an `ADMIN` can approve, ADMIN-only user
  management (`/admin/users`), server-side session revocation on
  deactivation/password reset, and a production admin bootstrap script
  (`npm run bootstrap:admin`).
- **Roles & matter-level access** — roles `ADMIN`, `ATTORNEY`,
  `PARALEGAL`, `STAFF`. `ADMIN` sees every matter; everyone else sees only
  matters they're assigned to (a URL for any other matter returns a 404).
  Client/Matter create/edit is limited to `ADMIN`/`ATTORNEY`, and matter
  team changes to `ADMIN` or that matter's `LEAD_ATTORNEY`.
- **Clients & Matters** — create, edit, staff assignments, and reversible
  archive/reactivate (no permanent deletion).
- **Matter workspace** — Notes, Tasks (including a Kanban board),
  Deadlines, Calendar Events, general Documents (authenticated
  upload/download), manual Call logging and filing, and an audit Timeline.
- **Discovery** — productions, file registration with SHA-256 hashing,
  Bates-stamped PDF copies (originals never modified), and comparing two
  productions.
- **Firm-wide views** — Dashboard, Tasks, Calendar, Communications,
  Discovery, and Reports, all scoped by the same server-side matter access
  rules.
- **Security center** — `/admin/security` (ADMIN-only) lists
  suspicious-login incidents detected from failed password attempts, for
  triage (Open → Investigating → Resolved / False Positive). A per-account
  password-attempt cooldown is backed by the database. Users manage their
  own MFA at `/account/security`. Also in place: security response headers
  (including a Content-Security-Policy), audit logging of case-data writes
  and file downloads, and an unauthenticated `/api/health` probe that
  exposes no internal details.
- **Intake review** — `/intake`, a staff review queue for leads pulled
  from HighLevel (see below).
- **Contacts** — `/contacts`, a permanent firm-wide directory (individuals
  and organizations, multiple criminal-defense categories, phones/emails,
  organization links), each client's own directory entry, per-matter roles
  (matter **Contacts** tab), associated-people relationships, and an
  interaction timeline that merges manual interactions with linked calls.
  Visibility is strictly matter-derived (`lib/contacts/visibility.ts`;
  `docs/SECURITY.md`, "Contact visibility").
- **Professional history & matter closure** — versioned judicial rulings
  and attorney observations (`lib/history/`), judge/prosecutor/counsel
  history on contact profiles, and a structured Close Matter / amend /
  historical-backfill / reopen workflow on the matter "Rulings & Outcome"
  tab. A matter can no longer be closed by editing its status.
- **Calendar & meetings** — month/week/day/agenda calendar
  (`lib/calendar/`), internal and matter events, attendees, linked
  contacts, time zones, recurrence, in-app reminders, validated meeting
  links (Join / Copy).
- **Time tracking & PDF reports** — manual entries and persistent timers
  (`lib/time/`), matter Time & Activity tab, `/time`, and Matter Time /
  Firm Utilization / Employee Activity PDFs (`lib/reports/`, pdf-lib).
- **Usage analytics** — sessions, identifier-only activity events,
  heartbeat-based *estimated* active time (`lib/usage/`), ADMIN-only
  `/admin/usage`, security-center integration, 365-day retention.
- **Team chat** — channels (incl. matter channels), DMs, fixed group DMs
  (≤ 5), unread state, search, polling refresh (`lib/chat/`).
- **Slack** — disconnected scaffolding only (`lib/integrations/slack/`,
  `/admin/integrations`).

### Integration status

| Integration | What exists | Production status |
|---|---|---|
| Loop / HighLevel | API-polling sync (`lib/intake/highlevelSync.ts`), started by a manual "Sync from Loop" action or a protected cron route (`app/api/cron/highlevel-sync`). It creates `PENDING` `IntakeLead` rows that staff link, convert to a Client, or dismiss. A webhook route (`app/api/intake/highlevel`) is also built but nothing is configured to call it. | Designated as the future production intake path, but not deployed: no host or scheduler has been chosen. |
| Dropbox | `lib/storage/DocumentStore` with a local-disk store (the default) and a **development/test-only** `DropboxDocumentStore` (`STORAGE_PROVIDER=dropbox`, pointed at a test App-folder account). | Not production: no firm-owned Dropbox app, production folder layout, or encrypted token storage. |
| Vonage | Library code only (`lib/telephony/`): payload normalization, idempotent unfiled-Call ingestion, and recording storage, tested with fixtures. No route, webhook, or API client calls it. | Not connected. Calls are logged manually today. |
| MyCase | Nothing. | No data migration has started. |
| QuickBooks Online | Nothing. | Later phase. |
| Slack | Interfaces and a `DisconnectedSlackProvider` only (`lib/integrations/slack/`); admin card shows Not connected. No network calls, no credentials. | Not connected; any real connection needs explicit authorization. |

Existing integration code may be maintained and extended **only when a
human explicitly authorizes that specific work**. Production connections and
credentials remain restricted (see below). Don't describe any of these
integrations as production-ready unless `docs/PRODUCTION_READINESS.md` says
so.

### Rules for this phase

Until a human explicitly says otherwise, do **NOT**:

- Start new integration work, or extend existing integration code (Vonage,
  Dropbox, Loop/HighLevel, MyCase, QuickBooks Online), without explicit
  authorization for that specific work.
- Connect to any live external service, including test or sandbox accounts,
  without explicit approval. Never connect to a production service, use or
  request production credentials, or make production changes (hosting,
  production database, production configuration, or production data).
  Tests use fixtures and mocks, never live calls.
- Create, edit, or apply Prisma migrations or `schema.prisma` changes
  without explicit approval.
- Add, remove, or upgrade dependencies without explicit approval.
- Run destructive database commands (`db:reset`, `db:seed`,
  `prisma migrate reset`, or manual data changes) against anything except
  a local development/test database.
- Implement billing/invoicing.
- Migrate or import any real firm or client data.
- Add real API keys, tokens, or credentials anywhere in the repo (only
  placeholders belong in version control — see `.env.example`).
- Attempt to build the entire UI in one pass. Build one vertical slice at a
  time (e.g., "Clients CRUD" end-to-end) and get it reviewed before moving on.
- Use real client names, case numbers, discovery, or any other confidential
  firm data in code, comments, tests, fixtures, or example files. Always use
  clearly fake placeholder data (e.g., "Jane Doe", "State v. Test Case").

When in doubt about scope, do less and ask.

## 3. Technology stack (decided direction)

- **Framework:** Next.js (App Router), TypeScript throughout (`strict: true`).
- **Database:** PostgreSQL.
- **ORM:** Prisma.
- **UI:** shadcn/ui components on top of Tailwind CSS.
- **Auth:** Auth.js (NextAuth v5) with a credentials provider and JWT
  sessions, plus TOTP MFA (implemented — see section 2).
- **Validation:** Zod for all input validation (forms and API/server actions).
- **Testing:** Vitest for unit tests (`npm run test`). Playwright for
  end-to-end tests is still planned but not installed — adding it is a new
  dependency and needs approval (section 2).

Rationale for these choices, trade-offs, and deployment thinking are in
`docs/ARCHITECTURE.md`.

## 4. Architecture rules

1. **One deployable app.** A single Next.js application serves both the UI
   and the backend (via Route Handlers / Server Actions). Do not split into
   separate frontend/backend services or introduce microservices — that is
   unnecessary complexity for a one-developer team.
2. **Postgres is the single source of truth for structured data.** Dropbox
   stays the source of truth for file *contents*; Postgres stores metadata,
   references (paths/IDs), and everything relational.
3. **All schema changes go through Prisma migrations.** Never hand-edit the
   database; never hand-edit generated Prisma client code.
4. **Server-side authorization on every request.** Never rely on hiding a UI
   element as the only access control — every Server Action and Route
   Handler must independently verify the caller is allowed to see/modify the
   data (see `docs/SECURITY.md`).
5. **Every write to case data is audited.** Any create/update/delete on
   client, matter, discovery, document, communication, or call records must
   produce an `AuditEvent` (see `docs/DATA_MODEL.md`). This is not optional
   and should not be bolted on later — build it in from the first real
   feature.
6. **Integrations are isolated behind interfaces.** Every integration must
   live behind a narrow interface so the rest of the app never calls a
   third-party SDK or API directly. Existing code already does this
   (`lib/storage/DocumentStore`, `lib/intake/`, `lib/telephony/`; see
   `docs/INTEGRATION_ARCHITECTURE.md`), and any authorized extension or new
   integration must keep it that way. This keeps future provider swaps and
   testing sane.
7. **No secrets in the repo.** Configuration comes from environment
   variables only, documented (with placeholders) in `.env.example`.

## 5. Security requirements (non-negotiable)

This system will eventually hold confidential, privileged criminal-defense
case data. Treat security as a first-class requirement, not a polish step.

- Never commit real credentials, API keys, tokens, connection strings, or
  client data. `.env*` files (other than `.env.example`) are gitignored —
  keep it that way.
- Never use real client, witness, or case data in development, tests, or
  examples. Use obviously fictional data.
- All authentication and authorization logic lives on the server. Every
  data-access function must check that the current user has a legitimate
  reason to access that client/matter (role- and assignment-based).
- Log security-relevant events (login, failed login, permission denials,
  data exports, discovery access) to the audit trail without leaking
  sensitive content into logs.
- Validate and sanitize all external input with Zod before it touches the
  database or filesystem.
- Prefer parameterized queries via Prisma; never construct raw SQL from
  string concatenation.
- Assume the database will eventually contain privileged attorney-client
  communications — design access control and audit logging accordingly from
  the start.

Full detail lives in `docs/SECURITY.md`. If a task conflicts with something
in that document, follow the document and flag the conflict to the user.

## 6. Coding standards

- TypeScript everywhere, `strict` mode on, no `any` unless truly
  unavoidable (and commented why).
- Linting via ESLint (`npm run lint`) and type-checking via `npm run
  typecheck`; do not hand-format against the configured rules. Prettier is
  not configured yet — adding it is a new dependency and needs approval.
- Prefer small, focused modules over large multi-purpose files.
- Business logic (discovery numbering, deadline calculation, etc.) belongs
  in `lib/`, not scattered inline in route handlers or components — it needs
  to be unit-testable.
- Comments explain *why*, not *what*. Do not narrate obvious code.
- No dead code, no commented-out blocks, no speculative
  "just in case" abstractions. Build what the current task needs.
- Every new table/model needs a short comment in `prisma/schema.prisma`
  explaining its purpose if it's not obvious from the name.
- Write tests for business logic (discovery numbering/comparison, deadline
  math, permission checks) as it's built, not as an afterthought.

## 7. Where things live

See `docs/ARCHITECTURE.md` for the full folder structure and reasoning. In
short:

- `app/` — Next.js routes, layouts, Server Actions.
- `components/` — React components (`components/ui` = shadcn/ui primitives).
- `lib/` — business logic, database client, auth, validation schemas.
- `prisma/` — schema and migrations.
- `docs/` — all project documentation (this is the source of truth for
  planning; keep it up to date as decisions change).
- `types/` — shared TypeScript types not generated by Prisma.
- `tests/` — automated tests.

## 8. Documentation map

- `docs/PROJECT_PLAN.md` — what we're building, for whom, and why.
- `docs/ARCHITECTURE.md` — system architecture and technical rationale.
- `docs/DATA_MODEL.md` — core entities, fields, and relationships.
- `docs/SECURITY.md` — security and confidentiality requirements in detail.
- `docs/ROADMAP.md` — phased plan and session-by-session build history.
- `docs/INTEGRATION_ARCHITECTURE.md` — Dropbox, Vonage, and Loop/HighLevel
  boundaries (also see `lib/intake/README.md` and `lib/telephony/README.md`).
- `docs/PRODUCTION_READINESS.md` — what must happen before real data or
  real staff accounts are allowed.
- `docs/SECURITY_MONITORING_ASSESSMENT.md` — record of the local,
  fictional-data exercise that added suspicious-login detection and admin
  incident triage.
- `docs/FIRM_OPERATIONS_EXPANSION.md` — architecture, confidentiality
  model, and phased delivery plan for the contacts / professional history /
  matter closure / calendar / time tracking / usage reporting / team chat /
  Slack scaffolding initiative, including open decisions.

Keep these documents current. If you make an architectural decision while
implementing a feature, record it in the relevant doc in the same change.

## 9. Working across sessions

This project may be picked up by a different Claude Code session, on a
different machine, at a later time, with no memory of this conversation.
Because of that:

- Do not leave work half-done without a clear note (commit message, TODO in
  `docs/ROADMAP.md`, or similar) explaining what's finished and what isn't.
- Prefer finishing one small vertical slice completely over starting many
  things at once.
- Keep this file and the `docs/` folder accurate — they are the persistent
  memory of the project between sessions.

### Branch and pull request workflow

- Do all work on a feature branch created from the latest `origin/main`;
  never commit or push directly to `main`.
- Deliver changes through a pull request targeting `main`. Do not merge a
  pull request, force-push `main`, or rewrite shared history unless a
  human explicitly asks.
- Before opening a PR, run the checks relevant to the change
  (`npm run lint`, `npm run typecheck`, `npm run test`, and
  `npm run build` for code changes), and report any that were skipped or
  failed.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
