# Security

This system will eventually hold confidential, privileged criminal-defense
case information: client identities, charges, discovery (which can include
sensitive evidence, victim/witness information, and law-enforcement
materials), attorney work product, and communications. Security is a
first-class requirement from day one, not something added before launch.

## Implementation status (read this first)

This document describes the target design. As of this session, the
following pieces of it are **actually implemented**, not just planned:

- **Authentication** via Auth.js (NextAuth v5), credentials provider,
  session-based (JWT) — see "Authentication" below for what's real vs.
  still open (MFA, rate limiting, HTTPS).
- **Matter-level authorization**, enforced server-side in
  `app/(dashboard)/matters/[matterId]/layout.tsx` and in every cross-matter
  query in `lib/dashboard/queries.ts` / `lib/matters/queries.ts` — see
  "Authorization" below.
- **Route-level login gating** via `proxy.ts` for every page except
  `/login`.

Also now real:

- **Write actions** for Task status changes, Notes, Tasks, and attaching a
  Call to a matter — see `lib/matters/actions.ts`. Each independently
  re-checks authentication and matter-level access rather than trusting
  that a page already did (see "Authorization" below).
- **Audit logging** for those same writes — `AuditEvent` rows are now
  produced by real `CREATE`/`UPDATE` actions, not only seeded, and the
  Timeline tab reflects them.

Still **not implemented** (tracked in `docs/ROADMAP.md`):

- Client/Matter create-edit-delete, Deadline/CalendarEvent writes, Document
  upload, logging a brand-new Call (only attaching an existing unfiled
  one), and Note/Task edit-delete — none of those have a write path yet,
  so `AuditEvent` for them is still only seeded demo data.
- No MFA, no rate limiting on failed logins, no forced sign-out on
  role/assignment change.
- No HTTPS enforcement (this is a local-dev prototype; see
  `AuthConfig.trustHost` in `lib/auth/config.ts`, which is itself a
  dev-only convenience that needs revisiting before any real deployment).
- Every seeded user shares one password (`FryeDemo!2026`, see README) —
  acceptable for a demo of five fictional accounts, never acceptable
  once real staff accounts exist.

## Guiding principles

1. **Confidentiality by default.** No one sees a matter's data unless
   they're specifically authorized (assigned to it, or an admin).
2. **Least privilege.** Staff and integrations get the minimum access they
   need, nothing more.
3. **Everything is auditable.** Every meaningful access to or change of
   case data is logged, immutably.
4. **No real data outside production.** Development, staging, and testing
   never touch real client/case data.
5. **Assume the repository is public.** Never rely on the repo being
   private as a security control — no secrets, no real data, ever, in
   version control.

## Secrets & configuration

- All credentials (database URL, auth secret, and future API keys for
  Dropbox/Vonage/QuickBooks/Loop) live in environment variables, never in
  code or committed files.
- `.env`, `.env.local`, `.env*.local` and similar are gitignored. Only
  `.env.example` (placeholders, no real values) is committed.
- If a secret is ever accidentally committed, it must be rotated
  immediately — removing it from a later commit is not sufficient, since
  it remains in git history.
- Production secrets should eventually live in a proper secret
  manager/host-provided environment config, not just a `.env` file on a
  server.

## Authentication

- Every staff user has their own account — no shared logins. **Implemented**
  via Auth.js (NextAuth v5) with a Credentials provider
  (`lib/auth/config.ts`); no OAuth/SSO provider is configured.
- Passwords hashed with bcrypt (`bcryptjs`, 10 rounds), never stored or
  logged in plaintext. **Implemented.**
- Session-based auth via Auth.js, JWT strategy. **Implemented** — but
  session expiry is Auth.js's default and there is no way yet to force a
  sign-out on role/assignment change (e.g., if someone is unassigned from
  a matter mid-session, their existing session still carries the old
  assignment until the JWT is next refreshed/re-issued). **Not
  implemented.**
- Design the auth flow so multi-factor authentication (TOTP) can be added
  later without restructuring. **Not implemented** — no MFA yet, but
  nothing in the current design blocks adding it (Auth.js supports
  additional verification steps without a rewrite).
- Failed login attempts are logged and rate-limited to slow credential
  stuffing/brute force. **Not implemented.** Failed `authorize()` calls
  currently just return `null` (Auth.js shows a generic error) with no
  logging or throttling — acceptable for five fictional dev accounts
  behind a private environment, not for a real deployment.
- Every seeded account uses one shared password
  (`FryeDemo!2026` — see README's demo credentials table) purely so a demo
  doesn't require memorizing five passwords. This must never happen with
  real accounts.

## Authorization

- Role-based: `ADMIN`, `ATTORNEY`, `PARALEGAL`, `STAFF`
  (`prisma/schema.prisma`'s `UserRole` enum). **Implemented.**
- **Matter-level access control**: being logged in is not enough. A user
  must be assigned to a matter (via `MatterAssignment`) or hold the
  `ADMIN` role to view or write that matter's data — this mirrors
  ethical-wall and confidentiality expectations in a law firm.
  **Implemented** for reads and for the write actions that exist so far:
  - The decision logic is pure and unit-tested
    (`lib/auth/authorization.ts`, `tests/auth/authorization.test.ts`).
  - `lib/auth/access.ts` exposes two DB-backed wrappers around that logic:
    `assertMatterAccess` (throws `notFound()`, for page renders) and
    `hasMatterAccess` (returns a boolean, for Server Actions that can't use
    `notFound()` since they aren't rendering a page).
  - `app/(dashboard)/matters/[matterId]/layout.tsx` enforces it for a
    single matter's pages via `assertMatterAccess` — an unassigned,
    non-admin user gets the same `not-found` page as a nonexistent matter
    id, so access can't be distinguished from "doesn't exist."
  - Every cross-matter read (`lib/dashboard/queries.ts`,
    `lib/matters/queries.ts`'s `listMatters`) filters by the same rule, so
    the Dashboard and Matters list never leak the existence of matters a
    non-admin can't open.
  - Every write action in `lib/matters/actions.ts` (`updateTaskStatus`,
    `createNote`, `createTask`, `attachCallToMatter`) calls
    `hasMatterAccess` itself and returns the same generic
    "not found or access denied" failure whether the matter doesn't exist
    or the caller just isn't assigned to it — a denied write can't be used
    to probe for what matters/records exist.
- All authorization checks happen **server-side** — `proxy.ts` gates
  "is anyone logged in," and every Server Component that reads matter data
  re-checks independently rather than trusting the proxy alone (see
  CLAUDE.md, section 4.4). The Server Actions in `lib/matters/actions.ts`
  follow the same rule: each calls `requireCurrentUser()` and
  `hasMatterAccess()` itself rather than trusting that the page that
  rendered its form/button already checked — Server Actions can be invoked
  directly, not just through a page render. Future write actions must do
  the same.
- Discovery, documents, notes, tasks, deadlines, and calls are scoped to
  the same per-matter check as the parent Matter record, since they only
  render inside a matter route the layout has already authorized —
  **implemented** by construction (there's no separate route for, say, a
  single Note that could be reached without going through the matter
  layout first).

## Audit logging

- Every create/update/delete on Client, Matter, Note, Task, Deadline,
  CalendarEvent, Communication, Call, Document, DiscoveryProduction, and
  DiscoveryFile produces an `AuditEvent` (see `docs/DATA_MODEL.md`).
  **Implemented so far** for: Note create, Task create, Task status
  update, and Call attach-to-matter (`lib/matters/actions.ts`). Every
  other entity/action in that list still has no write path at all, so
  there's nothing yet to log for them (see `docs/ROADMAP.md`).
- Sensitive read actions that matter for accountability (e.g., viewing/
  exporting discovery, exporting a client's full file) should also be
  logged, not just writes.
- Audit records are append-only. No feature should ever allow editing or
  deleting an `AuditEvent`, including for admins, through the application
  layer.
- Audit metadata should capture enough to reconstruct "what changed"
  (e.g., before/after for updates) without duplicating large content
  (e.g., don't dump entire document contents into audit metadata).

## Data handling

- **No real client, witness, or case data in development or test
  environments.** Use clearly fictional data (e.g., "Jane Doe",
  "State v. Test Case", fake case numbers) for all local development,
  fixtures, screenshots, and example files shared anywhere (including with
  Claude/AI tooling).
- Personally identifiable information and case specifics should never
  appear in logs, error messages sent to a client browser, or crash
  reporting payloads.
- All input from users or external systems is validated (Zod) before
  reaching the database or filesystem — never trust client-submitted data,
  including hidden form fields or IDs.
- Use parameterized queries via Prisma; never build raw SQL from string
  concatenation.
- File uploads (once built) must validate file type/size server-side and
  store them via the internal storage interface, never trusting a
  client-supplied path.

## Data in transit / at rest

- All traffic (including local development against any shared/staging
  environment) should be over HTTPS/TLS once deployed anywhere beyond
  localhost.
- Database connections use TLS where the hosting provider supports it.
- Backups (once the system holds real data) must be encrypted and access
  to them restricted and logged like any other access to case data.

## Third-party integrations (future)

When Dropbox, Vonage, Loop/HighLevel, or QuickBooks integrations are
eventually built:

- Use scoped API tokens with the minimum permissions needed (e.g., access
  only to the firm's specific Dropbox folder structure, not the whole
  account, if the API supports scoping).
- Store integration tokens as secrets, never in the database in plaintext —
  encrypt at rest if they must be stored, or use short-lived tokens with
  server-side refresh.
- Log integration actions (e.g., "pulled call recording X into matter Y")
  through the same `AuditEvent` mechanism as everything else.
- Each integration lives behind a narrow internal interface (see
  `docs/ARCHITECTURE.md`) so a compromised or misbehaving third-party SDK
  has a small blast radius.

## Dependency & code hygiene

- Keep dependencies current; review `npm audit`/equivalent regularly once
  the project has a `package.json`.
- No use of `eval`, dynamic `require`, or other patterns that make code
  injection easier.
- Code review (even solo — re-reading your own diff before merging,
  ideally via a PR) is expected for anything touching auth, authorization,
  or data access.

## Incident response (baseline expectation)

Even at small scale, once real data is in the system:

- Rotate any credential suspected of exposure immediately.
- Preserve audit logs relevant to any suspected incident before taking
  remediation steps that could overwrite them.
- Document what happened, in `docs/` or an internal record, once resolved.

## Open items for later phases

- Formal data retention/deletion policy (how long to keep closed-matter
  data, and secure deletion procedures).
- Backup and disaster-recovery plan with tested restores.
- Whether encryption-at-rest at the application layer (beyond disk/DB-level
  encryption) is needed for particularly sensitive fields.
- MFA rollout plan for all staff accounts.
