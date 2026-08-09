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

- **Write actions** for Task status changes, Notes, Tasks, attaching a Call
  to a matter, Client create/edit, Matter create/edit, MatterAssignment
  add/remove, and the Discovery/Bates engine (creating a production,
  registering a file, running a comparison) — see `lib/matters/actions.ts`,
  `lib/clients/actions.ts`, and `lib/discovery/actions.ts`. Each
  independently re-checks authentication and the relevant authorization
  rule rather than trusting that a page already did (see "Authorization"
  below).
- **Audit logging** for those same writes — `AuditEvent` rows are now
  produced by real `CREATE`/`UPDATE`/`EXPORT` actions, not only seeded, and
  the Timeline tab reflects them.
- **Two `DocumentStore` implementations**, selected via `STORAGE_PROVIDER`
  — fictional/test discovery files registered through the UI are actually
  hashed, stored, and (for PDFs) Bates-stamped, not just represented as
  metadata, regardless of which one is active:
  - `LocalDocumentStore` (default) — local disk, no credentials.
  - `DropboxDocumentStore` (`STORAGE_PROVIDER=dropbox`) — a **development/
    test** Dropbox integration, scoped to a dedicated test folder
    (`DROPBOX_ROOT_PATH`, default `/FryeCaseManagement-DEV`). This is not
    the production Dropbox integration `docs/ROADMAP.md` still tracks as
    future work — see "Third-party integrations" below for exactly what
    that distinction means and what's still missing before real discovery
    evidence should touch it.

Still **not implemented** (tracked in `docs/ROADMAP.md`):

- Client/Matter *deletion* or archival (create/edit are real as of the
  ninth session — see below), Deadline/CalendarEvent writes, Document
  upload, logging a brand-new Call (only attaching an existing unfiled
  one), Note/Task edit-delete, and Discovery production/file edit-delete —
  none of those have a write path yet, so `AuditEvent` for them is still
  only seeded demo data.
- The **production** Dropbox integration (a firm-wide app, a real per-matter
  folder convention, encrypted-at-rest token storage, monitoring) — see
  "Third-party integrations" below. What exists now is a development/test
  integration behind the same interface, not that.
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

- All credentials (database URL, auth secret, Dropbox app key/secret/
  refresh token, and future API keys for Vonage/QuickBooks/Loop) live in
  environment variables, never in code or committed files.
- `.env`, `.env.local`, `.env*.local` and similar are gitignored. Only
  `.env.example` (placeholders, no real values) is committed.
- If a secret is ever accidentally committed, it must be rotated
  immediately — removing it from a later commit is not sufficient, since
  it remains in git history.
- Production secrets should eventually live in a proper secret
  manager/host-provided environment config, not just a `.env` file on a
  server. **Not yet true for the Dropbox dev/test integration** — its
  refresh token lives in a local `.env` file like everything else in this
  phase, which is acceptable for disposable dev/test credentials scoped
  to a throwaway test folder, not for anything touching real discovery.
- `lib/storage/config.ts#readDropboxConfig()` never includes a variable's
  *value* in an error message — only which variable names are missing —
  so a misconfiguration can be reported (in a log, a crash message, or to
  a developer) without any risk of echoing a partial secret.
- `lib/storage/DropboxDocumentStore.ts` never logs the Dropbox SDK's raw
  error object (which could carry request/response headers) — only an
  HTTP status and Dropbox's own `error_summary` string, and only to the
  server console, never to a client response.

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
- **Client/Matter management role rule (added the ninth session):** neither
  this document nor `docs/DATA_MODEL.md` previously said who may originate
  a brand-new Client or Matter — every other write path checks an
  *existing* `MatterAssignment`, but creating the very first record for a
  case has no assignment to check yet. Rather than default to "any
  logged-in user," a conservative rule was chosen and is now the
  documented answer:
  - Only `ADMIN` and `ATTORNEY` may create a Client or Matter, or edit a
    Client's own fields (`lib/auth/authorization.ts#canManageClientsAndMatters`,
    unit-tested in `tests/auth/authorization.test.ts`). Client records
    aren't matter-scoped in the data model (one client can span several
    matters with different staff), so this is a plain role gate, not a
    per-client assignment check.
  - Editing an *existing* Matter's own fields (or its `MatterAssignment`
    roster) additionally requires the existing matter-level check: an
    `ADMIN` always can; an `ATTORNEY` must actually be assigned to that
    matter, not just hold the role
    (`lib/auth/access.ts#canEditMatter`/`assertCanEditMatter`, tested in
    `tests/auth/access.test.ts`). A submitted `matterId` the caller isn't
    assigned to is denied exactly like a nonexistent one.
  - `PARALEGAL`/`STAFF` are unaffected everywhere else: full read/write
    access to Notes, Tasks, Calls, and Discovery on matters they're
    assigned to, unchanged. This rule only gates the Client/Matter records
    themselves and `MatterAssignment` membership.
  - `app/(dashboard)/clients/*`, `app/(dashboard)/matters/new`, and
    `app/(dashboard)/matters/[matterId]/edit` all call
    `assertCanManageClientsAndMatters`/`assertCanEditMatter` and return the
    same not-found page a nonexistent route would — same posture as
    matter-level access. `components/shared/app-shell.tsx` also grays out
    "Clients" in the sidebar for `PARALEGAL`/`STAFF`, but that's a UI
    convenience only; the pages and Server Actions enforce it
    independently regardless of what the sidebar shows.
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
    `createNote`, `createTask`, `attachCallToMatter`) and
    `lib/discovery/actions.ts` (`createDiscoveryProduction`,
    `registerDiscoveryFile`, `runDiscoveryComparison`) calls
    `hasMatterAccess` itself and returns the same generic
    "not found or access denied" failure whether the matter doesn't exist
    or the caller just isn't assigned to it — a denied write can't be used
    to probe for what matters/records exist.
  - `registerDiscoveryFile` and `runDiscoveryComparison` additionally
    re-check that every `productionId` they're given actually belongs to
    the given `matterId` (`prisma.discoveryProduction.findFirst({where:
    {id, matterId}})`) before touching it — the same "scope every id by
    matterId, not just the top-level check" pattern `updateTaskStatus` and
    `attachCallToMatter` already use.
  - `updateMatter`, `addMatterAssignment`, and `removeMatterAssignment`
    (`lib/matters/actions.ts`, ninth session) apply the same pattern one
    layer up: `canEditMatter` re-checks both the Client/Matter management
    role *and* matter assignment for the submitted `matterId`, and
    `removeMatterAssignment`'s delete is scoped by `{id: assignmentId,
    matterId}` together — so an `assignmentId` belonging to a different
    matter can never be removed through a matter the caller can edit, even
    if they can edit *some* matter. `createMatter` similarly re-validates
    every submitted `clientId` and assignment `userId` server-side (the
    client must exist; every assigned user must exist and be `active`)
    rather than trusting the form.
- All authorization checks happen **server-side** — `proxy.ts` gates
  "is anyone logged in," and every Server Component that reads matter data
  re-checks independently rather than trusting the proxy alone (see
  CLAUDE.md, section 4.4). The Server Actions in `lib/matters/actions.ts`
  and `lib/discovery/actions.ts` follow the same rule: each calls
  `requireCurrentUser()` and `hasMatterAccess()` itself rather than
  trusting that the page that rendered its form/button already checked —
  Server Actions can be invoked directly, not just through a page render.
  The discovery file download Route Handler
  (`app/(dashboard)/matters/[matterId]/discovery/files/[fileId]/route.ts`)
  does the same, since Route Handlers don't inherit a parent layout's
  checks either — every failure mode (not logged in, no matter access,
  wrong matter, file doesn't exist, content never stored) returns the same
  generic 404. Future write actions must do the same.
- Discovery, documents, notes, tasks, deadlines, and calls are scoped to
  the same per-matter check as the parent Matter record, since they only
  render inside a matter route the layout has already authorized —
  **implemented** by construction (there's no separate route for, say, a
  single Note that could be reached without going through the matter
  layout first). The discovery file download route is the one exception —
  it isn't nested under the matter layout (Route Handlers don't render
  through layouts), which is exactly why it repeats the matter-access and
  matter-scoping checks itself instead of relying on that construction.

## Audit logging

- Every create/update/delete on Client, Matter, Note, Task, Deadline,
  CalendarEvent, Communication, Call, Document, DiscoveryProduction, and
  DiscoveryFile produces an `AuditEvent` (see `docs/DATA_MODEL.md`).
  **Implemented so far** for: Note create, Task create, Task status
  update, Call attach-to-matter (`lib/matters/actions.ts`), Client
  create/update, Matter create/update, MatterAssignment create/delete
  (`lib/clients/actions.ts`, `lib/matters/actions.ts`, ninth session), and
  Discovery production create, file registration, Bates generation, and
  comparison (`lib/discovery/actions.ts`). Every other entity/action in
  that list still has no write path at all, so there's nothing yet to log
  for them (see `docs/ROADMAP.md`).
  - Registering a PDF logs **two** events: a `CREATE` for the file itself
    and a separate `UPDATE` carrying `metadata.event: "bates_generated"`
    with the assigned range — Bates generation is its own auditable action,
    not just a side effect of registration, per this document's original
    intent.
  - `createMatter` similarly logs a `CREATE` `Matter` event plus one
    `CREATE` `MatterAssignment` event per initial assignment — assigning
    staff to a new matter is its own auditable action, not folded into the
    matter's own event.
  - `updateClient`/`updateMatter` log an `UPDATE` event with
    `metadata.changed` containing only the fields that actually changed
    (before/after), via a shared `lib/utils/index.ts#diffFields` helper —
    a no-op edit produces no audit event at all. `Client.notes` is the one
    field excluded from the diff itself: since it's free text up to 5,000
    characters, the event only records `metadata.notesChanged: true`,
    never the before/after content, so the audit log can't become a
    second copy of potentially sensitive case notes.
- Sensitive read actions that matter for accountability (e.g., viewing/
  exporting discovery, exporting a client's full file) should also be
  logged, not just writes. **Implemented** for discovery file downloads —
  the download route logs an `EXPORT` event (`variant: "original" |
  "stamped"`) for every successful download; other sensitive reads (e.g.
  viewing a matter) are not logged yet.
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
- File uploads validate type/size server-side and store bytes via the
  internal storage interface, never a client-supplied path. **Implemented**
  for discovery file registration (`lib/discovery/actions.ts`): file type
  is a fixed enum, size is capped at 25MB, and storage keys are always
  server-generated (`matters/<matterId>/discovery/<productionId>/<uuid>/...`)
  — never taken from the client. This holds regardless of which
  `DocumentStore` implementation is active: `DropboxDocumentStore` gets
  the exact same server-generated key `LocalDocumentStore` does, and
  additionally re-validates it's a safe relative path (no `..`, no
  leading slash, no `//`) before ever calling the Dropbox API — the same
  defense-in-depth check `LocalDocumentStore` already applied for the
  filesystem. Document upload isn't built yet.
- Discovery files are downloaded only through the app's own authenticated
  Route Handler (`app/(dashboard)/matters/[matterId]/discovery/files/[fileId]/route.ts`),
  regardless of storage backend — the app never generates or exposes a
  Dropbox shared/public link for a discovery file. Every request still
  goes through `hasMatterAccess` and file-existence checks before any
  `documentStore.read()` call, and every failure mode (not logged in, no
  matter access, wrong matter, file doesn't exist, Dropbox read fails)
  returns the same generic 404 — unchanged by which storage backend is
  active.

## Data in transit / at rest

- All traffic (including local development against any shared/staging
  environment) should be over HTTPS/TLS once deployed anywhere beyond
  localhost.
- Database connections use TLS where the hosting provider supports it.
- Backups (once the system holds real data) must be encrypted and access
  to them restricted and logged like any other access to case data.

## Third-party integrations

A **development/test** Dropbox integration exists as of the eighth
session (`lib/storage/DropboxDocumentStore.ts`) — read this section as
"done" for the bullets below, and "still future work" for the rest of
this section (Vonage, Loop/HighLevel, QuickBooks, and *production*
Dropbox use):

- **Use scoped API tokens with the minimum permissions needed.**
  **Implemented for dev/test**: the Dropbox app backing this integration
  should be created with access type "App folder" (configured in the
  Dropbox App Console, not in this codebase — see `.env.example`), so it
  can only ever see its own dedicated folder, never the rest of anyone's
  Dropbox account. `DropboxDocumentStore` adds a second layer on top
  regardless of that App Console setting: every key is additionally
  confined under a configurable root path (`DROPBOX_ROOT_PATH`, default
  `/FryeCaseManagement-DEV`) that's obviously a disposable test namespace,
  not a real firm folder. Request only `files.content.write` and
  `files.content.read` scopes when generating the refresh token — nothing
  broader (no sharing, no account-info scopes).
- **Store integration tokens as secrets, never in the database in
  plaintext.** **Partially implemented**: the refresh token lives in
  environment variables (`.env`, gitignored), never in the database or
  code — but it isn't yet in a real secrets manager or encrypted at rest,
  which is fine for a disposable dev/test credential and not acceptable
  before production use (see docs/ARCHITECTURE.md's "Documents & Dropbox"
  section for the full list of what's still required first).
- **Log integration actions through the same `AuditEvent` mechanism as
  everything else.** Already true by construction: `lib/discovery/actions.ts`
  logs a `CREATE`/`UPDATE`/`EXPORT` `AuditEvent` for every file
  registration, Bates generation, and download exactly as it did before
  this pass — it calls `documentStore.save`/`.read`, not the Dropbox SDK
  directly, so switching storage backends doesn't change what gets
  audited or when.
- **Each integration lives behind a narrow internal interface.**
  **Implemented** for storage: `lib/storage/DocumentStore` is that
  interface, and `DropboxDocumentStore` is the first thing other than
  `LocalDocumentStore` to implement it — no other file in the app talks
  to the `dropbox` package directly. Vonage, Loop/HighLevel, and
  QuickBooks remain future work behind their own interfaces
  (`lib/telephony/CallProvider`, etc.) when those phases start.

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
