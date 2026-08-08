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
| Loop / HighLevel | **Keep** | Leads and intake stay here. This system starts at the "client is retained" stage. |
| MyCase | **Replace** | This platform replaces MyCase for active client and case management. |
| monday.com | **Possibly replace** | Tasks/workflows may move here later. Not a v1 goal. |
| Dropbox | **Keep** | Remains the source of truth for document storage. This app organizes, indexes, and links to Dropbox files/folders — it does not become a second file store. |
| Vonage | **Keep** | Remains the phone/SMS provider. This app will eventually surface and file call/SMS activity against the right client/matter. |
| QuickBooks Online | **Keep (future)** | Billing/accounting integration is a later phase, not v1. |

None of the integrations above (Loop, MyCase, Dropbox, Vonage, QuickBooks) are
implemented yet. See "Current phase" below.

## 2. Current phase — groundwork only

As of this writing, the repository contains **only foundational
documentation, configuration, and folder scaffolding** — no working
application code, no database connection, no integrations.

Until a human explicitly says otherwise, do **NOT**:

- Build or wire up integrations with Vonage, Dropbox, Loop/HighLevel, MyCase,
  or QuickBooks Online.
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
- **Auth:** Auth.js (NextAuth) with credentials + session-based auth,
  designed so MFA can be added later without a rewrite.
- **Validation:** Zod for all input validation (forms and API/server actions).
- **Testing:** Vitest for unit tests, Playwright for end-to-end tests (added
  when there is a UI worth testing end-to-end).

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
6. **Integrations are isolated behind interfaces.** When Dropbox/Vonage/etc.
   integrations are eventually built, they must live behind a narrow
   interface (e.g., `lib/storage/DocumentStore`) so the rest of the app never
   calls a third-party SDK directly. This keeps future provider swaps and
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
- Formatting/linting via Prettier + ESLint; do not hand-format against the
  configured rules.
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
- `docs/ROADMAP.md` — phased plan from groundwork to full feature set.

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
