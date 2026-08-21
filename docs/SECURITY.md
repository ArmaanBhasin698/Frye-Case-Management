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
  still open (rate limiting on the password step, HTTPS).
- **TOTP-based MFA/2FA**, including admin-assisted reset and forced
  first-login password change, for fictional development accounts only
  (no real staff account exists yet) — see "MFA/2FA status" below for the
  full design, what's enforced server-side, and what's still deferred (the
  admin-reset identity-verification process, bulk required-MFA rollout).
- **Minimal ADMIN-only user management** (`/admin/users`) — create, role
  change, activate/deactivate, `mfaRequired` toggle — see "Authorization"
  below.
- **Matter-level authorization**, enforced server-side in
  `app/(dashboard)/matters/[matterId]/layout.tsx` and in every cross-matter
  query in `lib/dashboard/queries.ts` / `lib/matters/queries.ts` — see
  "Authorization" below.
- **Route-level login gating** via `proxy.ts` for every page except
  `/login`, `/login/mfa*`, `/login/change-password`, and `/api/health`.
- **Baseline security response headers** (`next.config.mjs`) — see
  "Security headers" below.
- **Production-safety guard on `db:seed`/`db:reset`** and a
  **health/readiness endpoint** (`/api/health`) — see
  `docs/PRODUCTION_READINESS.md`.

Also now real:

- **Write actions** for Task status changes, Notes, Tasks, logging a
  brand-new Call (filed or unfiled) and attaching an already-existing
  unfiled Call to a matter, Client create/edit, Matter create/edit,
  MatterAssignment add/remove, Deadline create/update/status-change,
  CalendarEvent create/update, general Document upload/metadata-edit, and
  the Discovery/Bates engine (creating a production, registering a file,
  running a comparison) — see `lib/matters/actions.ts`,
  `lib/clients/actions.ts`, `lib/documents/actions.ts`, and
  `lib/discovery/actions.ts`. Each independently re-checks authentication
  and the relevant authorization rule rather than trusting that a page
  already did (see "Authorization" below).
- **Audit logging** for those same writes — `AuditEvent` rows are now
  produced by real `CREATE`/`UPDATE`/`EXPORT` actions, not only seeded, and
  the Timeline tab reflects them.
- **Two `DocumentStore` implementations**, selected via `STORAGE_PROVIDER`
  — fictional/test discovery files and general matter documents uploaded
  through the UI are actually hashed, stored, and (for Discovery PDFs)
  Bates-stamped, not just represented as metadata, regardless of which one
  is active:
  - `LocalDocumentStore` (default) — local disk, no credentials.
  - `DropboxDocumentStore` (`STORAGE_PROVIDER=dropbox`) — a **development/
    test** Dropbox integration, scoped to a dedicated test folder
    (`DROPBOX_ROOT_PATH`, default `/FryeCaseManagement-DEV`). This is not
    the production Dropbox integration `docs/ROADMAP.md` still tracks as
    future work, and the firm's real Dropbox account still requires staff
    2FA to authorize (deliberately deferred) — see "Third-party
    integrations" below for exactly what that distinction means and
    what's still missing before real discovery evidence or real matter
    documents should touch it. `STORAGE_PROVIDER` stays on `local` for all
    browser/integration testing until that authorization happens.

Still **not implemented** (tracked in `docs/ROADMAP.md`):

- Client/Matter/Deadline/CalendarEvent/Document/Note/Task *deletion* or
  archival (create/edit are real as of the ninth through twelfth sessions
  — see `docs/ROADMAP.md`) — none of those have a write path yet, so
  `AuditEvent` for them is still only seeded demo data. Logging a
  brand-new Call is now real too (fourteenth session, see below).
- The **production** Dropbox integration (a firm-wide app, a real per-matter
  folder convention, encrypted-at-rest token storage, monitoring) — see
  "Third-party integrations" below. What exists now is a development/test
  integration behind the same interface, not that.
- No rate limiting on failed *password* attempts (the MFA code-entry step
  now has its own DB-backed lockout — see "MFA/2FA status" and "Rate
  limiting status" below), no forced sign-out on role/assignment change
  (see "Authentication" and "Security hardening pass (eighteenth session)"
  below for exactly what's required to close each of these before real
  staff accounts go live).
- No admin-assisted MFA reset for a user who has lost both their
  authenticator and every recovery code — deliberately deferred (see "MFA/
  2FA status" below for why).
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

- All credentials (database URL, auth secret, `MFA_ENCRYPTION_KEY`, Dropbox
  app key/secret/refresh token, and future API keys for
  Vonage/QuickBooks/Loop) live in environment variables, never in code or
  committed files. `MFA_ENCRYPTION_KEY` is deliberately a separate secret
  from `AUTH_SECRET` — it's HKDF-split (`lib/auth/mfa/crypto.ts`) into a
  subkey that encrypts TOTP secrets at rest and a subkey that signs MFA
  challenge/enrollment ticket references, so rotating session signing and
  rotating MFA secrets are independent operations.
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
- Session-based auth via Auth.js, JWT strategy. **Partially implemented** —
  as of the eighteenth session's hardening pass, the session now expires
  after 12 hours (`session.maxAge`, `lib/auth/config.ts`) instead of
  Auth.js's 30-day default, bounding how long a stolen session cookie stays
  useful. **Still not implemented**: there is no way to force a sign-out on
  role/assignment change or account deactivation before that expiry — a JWT
  session isn't revocable server-side once issued. `/admin/users` now makes
  deactivation and role changes reachable through the app itself
  (`lib/admin/users/actions.ts`, pre-meeting production-hardening pass) —
  which means this is now a **live** gap, not the latent one it used to be
  when no in-app path to deactivate/role-change existed at all: an admin
  deactivating a user through the UI does not immediately end that user's
  existing session, which can remain valid for up to 12 hours. Closing it
  fully needs one of: (a) a DB check added to the `jwt` callback on every
  request (works today, but adds a query to every session check — a
  deliberate latency/DB-load trade-off), or (b) switching to the database
  session strategy (a session row per login, revocable by deleting it) — a
  larger, deliberate architecture change, not something to do incidentally
  alongside an unrelated feature. **Explicit decision needed from the firm
  before real accounts rely on deactivation** (see "Open items for later
  phases" below) on whether this residual window is acceptable.
- TOTP-based MFA, additive to the existing Credentials-provider flow.
  **Implemented, for fictional development accounts only** — see "MFA/2FA
  status" below for the full design and what's still deferred before any
  real staff account can use it.
- `AuthConfig.trustHost` (`lib/auth/config.ts`) is `true` — fine for local
  development, where Auth.js just needs to infer its own URL from
  whatever `Host` header the dev server sees. **This has not been
  validated against any real production host, because none has been
  chosen yet** — deliberately not "fixed" preemptively, since the correct
  answer depends on that choice, not on this codebase. Before real
  deployment, whoever picks the host must confirm:
  - Does every request that reaches this Node process pass through a
    reverse proxy / platform edge that *sets* the `Host` (and
    `X-Forwarded-Host`/`X-Forwarded-Proto`) headers itself, rather than
    forwarding a client-supplied one unchanged? If yes, `trustHost: true`
    plus a real `https://` `AUTH_URL` is fine. If the app could ever be
    reached directly (bypassing that proxy) or the proxy blindly forwards
    client headers, `trustHost` should be set to `false` and `AUTH_URL`
    relied on exclusively instead.
  - Is `AUTH_URL` (and `APP_URL`) set to the real `https://` domain, not
    the `http://localhost:3000` value in `.env.example`?
  - Does the platform terminate TLS itself, or does this app need to
    handle that (it doesn't today — no HTTPS enforcement exists in code;
    see "Data in transit / at rest" below)?
  This is a deployment-time validation item, not a code change to make
  now against an unknown target.
- Failed login attempts are logged and rate-limited to slow credential
  stuffing/brute force. **Partially implemented.** Every failed password
  attempt is now recorded (`lib/security/detection.ts`), and 5 failures for
  the same account within 10 minutes opens a `SecurityIncident` an ADMIN
  can triage at `/admin/security` (Open → Investigating → Resolved/False
  Positive) — see `docs/SECURITY_MONITORING_ASSESSMENT.md` for the full
  design and a local IR-lifecycle walkthrough. This is detection and
  alerting only, still **not rate limiting**: a failed attempt is never
  slowed or blocked, only recorded and (past the threshold) flagged for a
  human to act on. See "Rate limiting status" below for what a real
  blocking fix requires and why it wasn't built as part of this pass.
- Every seeded account uses one shared password
  (`FryeDemo!2026` — see README's demo credentials table) purely so a demo
  doesn't require memorizing five passwords. This must never happen with
  real accounts.

### MFA/2FA status

**Implemented, for fictional development/demo accounts only** — no real
Frye staff account has been created, and this feature must not be used with
real accounts or real case data until the deferred items below are
resolved. See `lib/auth/mfa/` and `prisma/schema.prisma`'s `User`/
`MfaRecoveryCode`/`MfaChallengeTicket` models.

**Design.** `User.mfaEnabled` and `User.mfaRequired` are intentionally
separate: `mfaRequired` marks an account that must enroll, independent of
whether it has done so yet, so the login flow can route a
required-but-unenrolled account into forced setup
(`/login/mfa/setup`) instead of either granting access or issuing a
challenge it can't answer. `mfaEnabled` is set true only after a real TOTP
code is confirmed at the end of enrollment.

**How a password-only session is prevented.** The Credentials provider's
`authorize()` (`lib/auth/config.ts`) refuses to complete sign-in whenever
`mfaEnabled || mfaRequired` is true, regardless of how the request was
made — the login Server Action never even calls `signIn` for such an
account. The only other path that can complete sign-in is a second,
internal-only Credentials provider (`mfa-complete`), whose sole credential
is a challenge-ticket id that (a) is minted server-side only immediately
after a real TOTP or recovery-code check succeeds, (b) is HMAC-signed
(`lib/auth/mfa/crypto.ts`, keyed from `MFA_ENCRYPTION_KEY`) so a client
can't forge or guess one, and (c) can be consumed exactly once — the
`MfaChallengeTicket` row's `consumedAt IS NULL AND expiresAt > now()`
condition is enforced as a single atomic conditional `UPDATE`, not a
read-then-write check, so even two concurrent requests presenting the same
ticket can't both succeed. No client-supplied field is ever trusted as "MFA
passed" — that fact is only ever derived from a database check.

**Enrollment.** A TOTP secret is generated and held only in an
`MfaChallengeTicket` (purpose `MFA_ENROLLMENT`, encrypted, short-lived) —
never written to the `User` row until a current code confirms it, so an
abandoned enrollment leaves no trace. Confirmation also generates 10
recovery codes, shown exactly once; only their bcrypt hashes are persisted
(`MfaRecoveryCode`). Enrollment happens either from an existing session
(`/account/security`, voluntary) or pre-session (`/login/mfa/setup`, when
`mfaRequired && !mfaEnabled`) — both share the same confirmation logic in
`lib/auth/mfa/actions.ts`.

**Login challenge.** `/login/mfa` accepts a current TOTP code or an unused
recovery code. TOTP replay is prevented by `User.totpLastUsedStep`: the
library's `afterTimeStep` option rejects a code from an already-used time
step, and the step is recorded via the same atomic conditional `UPDATE`
pattern as ticket consumption, so a captured still-valid code can't be
replayed even by a concurrent request. Recovery codes are single-use for
the identical reason — redemption is a conditional `UPDATE ... WHERE
used = false`.

**Rate limiting on the MFA step.** `User.mfaFailedAttempts`/
`mfaLockedUntil` lock further second-factor attempts for 15 minutes after 5
consecutive failures — DB-backed, not an in-memory counter (see "Rate
limiting status" below for why that distinction matters). This covers only
the code-entry step; the password step's rate-limiting gap is unchanged
and unrelated (still open, see below).

**Admin-assisted reset — implemented (`lib/auth/mfa/actions.ts#adminResetMfa`).**
Recovers an account that has lost both its authenticator and every recovery
code. ADMIN-only, and an open authenticated admin session is deliberately
*not* sufficient: the admin must re-verify their own password, plus their
own current TOTP/recovery code if they have MFA enabled — exactly as
strictly as a self-service reset requires of the account holder. An admin
cannot use this path on their own account (self-service reset covers
that; allowing self-reset here would let MFA be turned off unilaterally
with no second party involved). The target's previous TOTP secret and
recovery codes are never read back or exposed — the action wipes them and
sets `mfaRequired: true`, forcing fresh enrollment on the target's next
login rather than leaving the account with no second factor at all. Every
reset is audited (`entityType: "User"`, actor = the admin, entity = the
target, no secret material in metadata).

**What this does *not* solve:** the identity-verification gap. Code can
prove "an authenticated, re-verified admin performed this reset," but it
cannot prove "the person who asked for the reset really is the locked-out
staff member and not an impersonator." That requires an off-platform
verification step (a known callback number, in-person confirmation, a
pre-agreed question) that is a firm policy decision, not something this
codebase can enforce — **still open, and required before any real account
relies on this path.**

**Required-MFA rollout — implemented.** `mfaRequired` exists in the schema
and the login-routing logic honors it; ADMIN can now set it per account
via `/admin/users` (`lib/admin/users/actions.ts#setUserMfaRequired`), and
every newly admin-created account gets `mfaRequired: true` by default.
**Still open:** no bulk/firm-wide toggle — enabling it for many existing
real accounts at once would need setting it one at a time, or a small
follow-up action if that's the firm's preferred rollout shape.

**Forced first-login password change — implemented
(`lib/auth/login-flow.ts`, `app/(auth)/login/change-password/`).** An
account created via `/admin/users` gets a server-generated temporary
password (shown to the admin exactly once, never logged) and
`mustChangePassword: true`. The password-change gate is checked *before*
the MFA gate — a temporary password is more likely to have passed through
an out-of-band/admin channel, so minimizing how long it stays the active
credential takes priority; ordering is otherwise safe either way since no
session is created until every gate passes. `authorize()` refuses to
complete sign-in for any account with `mustChangePassword` set, exactly
mirroring the MFA refusal — a direct request with the correct temporary
password still can't establish a session. The user re-enters their current
(temporary) password on the change-password page itself, re-verified
server-side, rather than any ticket/cookie carrying the plaintext password
across the redirect.

**`MFA_ENCRYPTION_KEY` secret handling.** Still a `.env` value like every
other secret in this phase (see "Secrets & configuration" above); revisit
alongside every other secret before real deployment. Rotating this key
needs a decrypt-with-old/re-encrypt-with-new migration procedure, planned
*before* rotation is ever needed — rotating it blind would lock out every
enrolled account's TOTP.

### Rate limiting status

Not implemented **for the password step**. (The MFA code-entry step now has
its own DB-backed lockout — `User.mfaFailedAttempts`/`mfaLockedUntil`, 5
attempts / 15 minutes — see "MFA/2FA status" above. That was built
DB-backed specifically because of the in-memory-counter problem described
below; it does not extend to `/login`'s password field.) No in-memory/fake
limiter was built as a placeholder for the password step — a
per-process in-memory counter would silently stop working the moment the
app runs behind more than one instance or restarts (a redeploy would reset
every counter to zero), which is worse than no limiter at all if anyone
starts relying on it. A real fix needs one of:

- A rate-limiting/WAF layer in front of the app (e.g., the hosting
  provider's platform-level protection, or a reverse proxy/CDN rule)
  covering `/login` and the Auth.js credentials callback route at minimum.
- An external shared store (Redis or equivalent) backing a proper limiter
  library, so limits are enforced consistently across every instance.

Either requires infrastructure decisions beyond this codebase — tracked
here as a hard requirement before real deployment, not a "nice to have."

### Security headers

Implemented as of the eighteenth session (`next.config.mjs#headers`),
applied to every route: `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`,
a restrictive `Permissions-Policy` (camera/microphone/geolocation all
denied), and `Strict-Transport-Security` (a no-op over local HTTP; only
honored by browsers over a real HTTPS response, so it doesn't need to be
conditionally applied). **Deliberately not implemented: a
Content-Security-Policy.** Radix UI (used throughout `components/ui`)
relies on inline `style` attributes for positioning popovers/dialogs/menus,
which a meaningfully strict `style-src` would break without a nonce-based
or `unsafe-inline`-permitting policy — that needs real testing across every
interactive component, not a one-line addition, and risks breaking local
development if done carelessly. Tracked as follow-up work, not attempted in
this pass.

## Authorization

- Role-based: `ADMIN`, `ATTORNEY`, `PARALEGAL`, `STAFF`
  (`prisma/schema.prisma`'s `UserRole` enum). **Implemented.**
- **User management (added the pre-meeting production-hardening pass):**
  creating a user, changing a role, activating/deactivating, and toggling
  `mfaRequired` (`/admin/users`, `lib/admin/users/actions.ts`) are `ADMIN`
  only — stricter than `canManageClientsAndMatters` below, which also
  allows `ATTORNEY`. Every action independently re-checks `isAdmin()`
  server-side (never trusts the page already did), blocks an admin from
  changing their own role/activation through this path (self-lockout
  guard), and blocks demoting or deactivating the last active `ADMIN` —
  the firm should never end up with zero admins and no one left to run an
  admin-assisted recovery. Admin-created accounts get a server-generated
  temporary password (shown once, never logged) and
  `mustChangePassword: true`; no admin ever chooses or sees a new
  account's password.
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
  - **Reversible Client/Matter archival (added the seventeenth session):**
    `archiveMatter`/`reactivateMatter` (`lib/matters/actions.ts`) reuse
    `canEditMatter` exactly as `updateMatter` does — no new permission was
    invented, and a `matterId` outside the caller's access is denied
    exactly like a nonexistent one. `archiveClient`/`reactivateClient`
    (`lib/clients/actions.ts`) reuse `canManageClientsAndMatters` exactly
    as `updateClient` does. Archiving/reactivating never changes
    matter-level or client-level authorization itself — `Client.archived`/
    `Matter.archived` (`prisma/schema.prisma`) is a pure default-list
    visibility flag (`lib/matters/queries.ts#listMatters`,
    `lib/clients/queries.ts#listClients`, both defaulting to `view:
    "active"`), so a direct link to an archived record a user is otherwise
    authorized for still works exactly as before, and one they aren't
    authorized for still 404s exactly as before — archiving cannot be used
    to bypass or widen access either way (see
    `tests/matters/queries.test.ts`/`tests/clients/queries.test.ts` for the
    regression coverage proving the archived filter is always `AND`-ed
    with the existing scope, never substituted for it).
  - **Deadlines and Calendar Events (tenth session)** use the plain
    matter-access rule above — `hasMatterAccess`, the same as Notes/Tasks/
    Calls — not the stricter `ADMIN`/`ATTORNEY` Client/Matter management
    rule: neither `docs/DATA_MODEL.md` nor this document specified a
    stricter rule for either entity, and per that session's explicit
    fallback instruction, "any assigned role may manage them" is the
    correct default (unlike originating a brand-new Client/Matter, editing
    a Deadline/CalendarEvent has an existing matter assignment to check
    against, same as every other per-matter sub-resource). `updateDeadline`
    and `updateCalendarEvent` re-fetch the record scoped by `{id, matterId}`
    together (`prisma.deadline.findFirst`/`calendarEvent.findFirst`) before
    editing it, and `setDeadlineSatisfied` scopes its `updateMany` the same
    way `updateTaskStatus` does — a `deadlineId`/`eventId` from a different
    matter can never be read or written through a matter the caller can
    access, even one they're genuinely assigned to. Neither model has an
    assignee/attendee column in `prisma/schema.prisma`, so there's no user
    id to validate for either write path.
  - **General Documents (eleventh session)** use the same plain
    matter-access rule too, same reasoning as Deadlines/CalendarEvents
    above. `uploadDocument` (`lib/documents/actions.ts`) checks
    `hasMatterAccess` *before* writing any bytes to `DocumentStore`, so a
    denied caller never causes a storage write. `updateDocumentMetadata`
    re-fetches the row scoped by `{id: documentId, matterId}` before
    editing it (same pattern as `updateDeadline`) and only ever touches
    `title`/`category`/`notes` — it never rewrites `storageKey` or calls
    `documentStore.save`, so an existing original file can never be
    destroyed by a metadata edit. Every storage key is generated
    server-side from a fresh UUID (`matters/<matterId>/documents/<uuid>/
    original`) — never the client-supplied filename, and never reused
    across uploads, so two files sharing a filename get distinct keys and
    neither can silently overwrite the other. The true original filename
    is preserved only as `Document.originalFilename` metadata, never in
    the storage path (see "Data handling" below for why).
  - **Note/Task editing (twelfth session)** also uses the plain
    matter-access rule — `hasMatterAccess`, same as every other per-matter
    sub-resource above, not the stricter Client/Matter management rule.
    `updateNote` and `updateTask` (`lib/matters/actions.ts`) re-fetch the
    record scoped by `{id, matterId}` together before editing it, same
    pattern as `updateDeadline`/`updateDocumentMetadata` — a `noteId`/
    `taskId` from a different matter is denied exactly like a nonexistent
    one, even for a caller genuinely assigned to some other matter.
  - **Task assignee security rule (twelfth session):** `Task.assignedToId`
    is a plain foreign key to `User`, with no matter-scoping of its own —
    submitting *any* globally-valid, active user id would otherwise let a
    caller assign a confidential matter's task to a user who has no
    legitimate reason to know that matter exists. `updateTask` closes this
    by requiring the submitted assignee be **active** and **either
    assigned to that matter (any role) or an active `ADMIN`** — reusing
    `hasMatterAccess` against the *candidate* assignee's `{id, role}`
    rather than the caller's, so the same authorization logic that decides
    who may access a matter also decides who may be assigned its tasks,
    instead of introducing a second, parallel rule. `lib/matters/
    queries.ts#getMatterAssignableUsers` mirrors this exact rule for the
    UI's assignee picker (matter-assigned active users ∪ active `ADMIN`s),
    so the picker never offers, and a user can never be tricked into
    submitting, an option the server would reject anyway. Clearing an
    assignee (submitting no id) is always allowed and skips this check
    entirely, since it does not grant anyone new visibility.
- **Firm-wide Tasks and Calendar (thirteenth session):** `app/(dashboard)/tasks`
  and `app/(dashboard)/calendar` introduce no new authorization rule — they
  reuse the plain matter-access scoping every cross-matter read already
  uses (`matterScopeFilterFor`, `lib/auth/access.ts`), the same primitive
  `lib/dashboard/queries.ts`'s widgets rely on. `lib/tasks/queries.ts#getFirmWideTasks`
  and `lib/calendar/queries.ts#getFirmWideCalendarItems` merge that scope
  with every user-supplied filter via Prisma `AND` — there is no unscoped
  "list every task/deadline/event" helper for either page to accidentally
  call, and every filter value is validated against a fixed allowlist
  before it reaches Prisma. Both pages are read-only aggregate views: a
  row's title links back to the existing per-matter Tasks or Deadlines &
  Calendar tab for editing, not a new write path, so no existing
  per-matter authorization rule changed.
- **Manual Call logging & firm-wide Communications (fourteenth session):**
  `lib/matters/actions.ts#createCall` uses the same plain matter-access
  rule as every other per-matter sub-resource (`hasMatterAccess`, any
  assigned role) when a `matterId` is submitted — not the stricter
  `ADMIN`/`ATTORNEY` Client/Matter rule — and re-verifies that `matterId`
  server-side regardless of what the form's picker offered, denying a
  forged/inaccessible one with the same generic error every other write
  action uses. An omitted `matterId` (an unfiled call) skips that check
  entirely, since there's no matter to check access against — the same
  posture `attachCallToMatter`'s destination-matter check already had.
  `app/(dashboard)/communications` (`lib/communications/queries.ts#getFirmWideCalls`)
  introduces one new authorization decision, not a new mechanism: filed
  calls reuse `matterScopeFilterFor` exactly like firm-wide Tasks/Calendar
  above, but unfiled calls have no assignment/ownership column of their
  own to scope by (`Call` only has `filedById`/`filedAt`, which stay null
  until filed — see `docs/DATA_MODEL.md`). Rather than invent a new
  scoping concept or expose every unfiled call's phone numbers/notes to
  every authenticated user firm-wide, unfiled-call visibility reuses the
  existing `canManageClientsAndMatters` (`ADMIN`/`ATTORNEY`) gate already
  documented above for Client/Matter origination — the same "no
  assignment to check against" reasoning applies. A `PARALEGAL`/`STAFF`
  caller therefore never sees an unfiled call on this page, including one
  they logged themselves; the existing per-matter "attach an unfiled
  call" workflow (`attachCallToMatter`, `getUnfiledCalls`) is unchanged
  and still has no role gate of its own — preserved, not modified, by
  this session.
- **Firm-wide Discovery (fifteenth session):** `app/(dashboard)/discovery`
  (`lib/discovery/queries.ts#getFirmWideDiscoveryFiles`) introduces no new
  authorization rule and no new write path — it reuses the same
  `matterScopeFilterFor` scoping every other firm-wide aggregate view
  above uses. The one wrinkle: `DiscoveryFile` has no `matterId` column of
  its own (unlike `Task`/`Deadline`/`CalendarEvent`/filed `Call`/
  `DiscoveryProduction`) — it only reaches a matter through its parent
  `DiscoveryProduction`, so the scope filter is nested under a `production`
  relation filter instead of applied directly. An `ADMIN`'s unrestricted
  scope (`{}`) is left at the top level of `where` rather than nested as
  `{ production: {} }`, the same "don't nest an empty object" caution the
  fourteenth session's `getFirmWideCalls` documents for `OR` branches —
  see `tests/discovery/queries.test.ts` for the regression proving an
  `ADMIN` still sees every file this way. Unlike Communications, there is
  no "unfiled" analogue to reason about: every `DiscoveryFile` belongs to a
  `DiscoveryProduction` which always belongs to a matter. The page is
  read-only: every row links back to the existing per-matter Discovery tab
  for registration, comparison, and authenticated download — none of that
  logic (including the discovery file download Route Handler below) was
  duplicated or modified.
- **Security hardening pass (eighteenth session) — fixed a real gap in
  unfiled-call visibility:** the fourteenth session's rule above (unfiled
  calls visible only to `ADMIN`/`ATTORNEY`, via
  `lib/communications/queries.ts#getCallVisibilityFilter`) had two
  call sites that never actually applied it. `lib/dashboard/queries.ts#
  getRecentCallsAcrossMatters`/`getDashboardStats` derived their own ad hoc
  unfiled-call scoping instead of reusing `getCallVisibilityFilter`, and
  missed the role gate entirely — a `PARALEGAL`/`STAFF` viewer's Dashboard
  home page was showing unfiled calls' contact names and durations.
  `lib/matters/queries.ts#getUnfiledCalls` (the per-matter Calls tab's
  "Attach to Matter" pool, unchanged since the third session) had **no**
  gate at all, on any role, since it predates the fourteenth session's rule
  and was never revisited when that rule was written. Both now reuse
  `getCallVisibilityFilter`/`canManageClientsAndMatters` instead of
  re-deriving the rule, so it can't drift again. The matching write path,
  `lib/matters/actions.ts#attachCallToMatter`, previously let any caller
  with access to the destination matter file an unfiled call regardless of
  role — it now also requires `canManageClientsAndMatters`, since a caller
  who can't legitimately know an unfiled call exists shouldn't be able to
  act on one via a forged `callId` either. See `docs/ROADMAP.md`'s
  eighteenth-session milestone for the full write-up and test coverage
  (`tests/dashboard/queries.test.ts`, `tests/matters/queries.test.ts`,
  `tests/matters/actions.test.ts`).
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
  and, as of the eleventh session, the general document download route
  (`app/(dashboard)/matters/[matterId]/documents/files/[documentId]/route.ts`)
  do the same, since Route Handlers don't inherit a parent layout's
  checks either — every failure mode (not logged in, no matter access,
  wrong matter, document doesn't exist, content never stored) returns the
  same generic 404. Future write actions must do the same.
- Discovery, documents, notes, tasks, deadlines, and calls are scoped to
  the same per-matter check as the parent Matter record, since they only
  render inside a matter route the layout has already authorized —
  **implemented** by construction (there's no separate route for, say, a
  single Note that could be reached without going through the matter
  layout first). The discovery and general-document download routes are
  the exception — neither is nested under the matter layout (Route
  Handlers don't render through layouts), which is exactly why each
  repeats the matter-access and matter-scoping checks itself instead of
  relying on that construction.

## Audit logging

- Every create/update/delete on Client, Matter, Note, Task, Deadline,
  CalendarEvent, Communication, Call, Document, DiscoveryProduction, and
  DiscoveryFile produces an `AuditEvent` (see `docs/DATA_MODEL.md`).
  **Implemented so far** for: Note create/update, Task create/update/status
  update, Call create and attach-to-matter (`lib/matters/actions.ts`),
  Client create/update, Matter create/update, MatterAssignment
  create/delete (`lib/clients/actions.ts`, `lib/matters/actions.ts`, ninth
  session), Deadline create/update/status-change, CalendarEvent
  create/update (`lib/matters/actions.ts`, tenth session), general
  Document upload/metadata-edit/download (`lib/documents/actions.ts` and
  its download Route Handler, eleventh session), Note/Task `UPDATE`
  (`lib/matters/actions.ts#updateNote`/`updateTask`, twelfth session), and
  Discovery production create, file registration, Bates generation, and
  comparison (`lib/discovery/actions.ts`). Every other entity/action in
  that list still has no write path at all, so there's nothing yet to log
  for them (see `docs/ROADMAP.md`).
  - `createCall` (fourteenth session) logs a `CREATE` event with
    restrained metadata only — `direction`, `filed` (whether a `matterId`
    was supplied), `flagged`, and `notesProvided` (a boolean, never the
    notes text itself, same restraint pattern as `Note.body`/
    `Task.description`/`Client.notes` below) — and deliberately never the
    raw `fromNumber`/`toNumber` either, since a phone number alone can
    identify a client or witness even without a matter attached.
  - Registering a PDF logs **two** events: a `CREATE` for the file itself
    and a separate `UPDATE` carrying `metadata.event: "bates_generated"`
    with the assigned range — Bates generation is its own auditable action,
    not just a side effect of registration, per this document's original
    intent.
  - `createMatter` similarly logs a `CREATE` `Matter` event plus one
    `CREATE` `MatterAssignment` event per initial assignment — assigning
    staff to a new matter is its own auditable action, not folded into the
    matter's own event.
  - `updateClient`/`updateMatter`/`updateDeadline`/`updateCalendarEvent`/
    `updateDocumentMetadata`/`updateNote`/`updateTask` log an `UPDATE`
    event with `metadata.changed` containing only the fields that actually
    changed (before/after), via a shared `lib/utils/index.ts#diffFields`
    helper — a no-op edit produces no audit event at all. `Client.notes`,
    `Document.notes`, `Note.body`, and `Task.description` are all excluded
    from the diff itself: since they're free text that could contain
    privileged case detail, the event only records `metadata.notesChanged`
    / `contentChanged` / `descriptionChanged: true`, never the before/after
    content, so the audit log can't become a second copy of potentially
    sensitive case notes.
  - `setDeadlineSatisfied` logs its own `UPDATE` event
    (`metadata: {satisfied}`) separately from `updateDeadline`'s
    field-diff event — same reasoning as Bates generation above: marking a
    deadline complete/incomplete is its own auditable action with legal
    significance (see `docs/DATA_MODEL.md`'s note on why Deadline has its
    own satisfied/audit lifecycle), not just an incidental field change.
  - `archiveMatter`/`reactivateMatter`/`archiveClient`/`reactivateClient`
    (seventeenth session) log their own `UPDATE` event
    (`metadata: {archived: true}` / `{archived: false}`) — same pattern as
    `setDeadlineSatisfied` above, a single safe boolean, never any other
    field on the record.
  - **Security hardening pass (eighteenth session) — three metadata leaks
    closed**, all contradicting this same restraint pattern rather than
    introducing a new rule: `updateCalendarEvent` was diffing `location`/
    `notes` directly into `metadata.changed` instead of excluding them like
    `updateNote`/`updateDocumentMetadata` already do (now
    `locationChanged`/`notesChanged` booleans); `uploadDocument` and
    `registerDiscoveryFile` were both writing the raw uploaded filename
    into `metadata.originalFilename` — directly contradicting the
    eleventh/sixth sessions' own reasoning for keeping filenames out of
    storage keys in the first place ("a client-supplied name could contain
    the client's real name or case details," `lib/documents/actions.ts`'s
    comment above `storageKey`). Both now omit the filename from audit
    metadata entirely; `registerDiscoveryFile`'s event carries the safe,
    server-generated `identifier` (Bates/evidence label) instead. The
    filename itself is unaffected as DB metadata
    (`Document.originalFilename`/`DiscoveryFile.originalFilename`), gated
    by the same matter-level authorization as the record — only the audit
    trail changed.
- Sensitive read actions that matter for accountability (e.g., viewing/
  exporting discovery, exporting a client's full file) should also be
  logged, not just writes. **Implemented** for discovery file downloads —
  the download route logs an `EXPORT` event (`variant: "original" |
  "stamped"`) for every successful download — and, as of the eleventh
  session, general document downloads, which log a plain `EXPORT` event
  the same way; other sensitive reads (e.g. viewing a matter) are not
  logged yet.
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
  for discovery file registration (`lib/discovery/actions.ts`) and, as of
  the eleventh session, general document upload
  (`lib/documents/actions.ts#uploadDocument`): file type is checked
  against a fixed extension allowlist (PDF, Word, Excel, text, common
  image formats — `lib/documents/validation.ts#isAllowedDocumentFile`,
  cross-checked against a permissive MIME list since browsers/OSes report
  `file.type` inconsistently), size is capped at 25MB, and storage keys
  are always server-generated from a fresh UUID
  (`matters/<matterId>/documents/<uuid>/original`) — never the
  client-supplied filename, so a filename that happened to contain a real
  client's name or case details can never leak into a storage path, and
  two uploads sharing a filename never collide. This holds regardless of
  which `DocumentStore` implementation is active: `DropboxDocumentStore`
  gets the exact same server-generated key `LocalDocumentStore` does, and
  additionally re-validates it's a safe relative path (no `..`, no
  leading slash, no `//`) before ever calling the Dropbox API — the same
  defense-in-depth check `LocalDocumentStore` already applied for the
  filesystem. Uploaded documents are never executed, previewed, or
  transformed server-side — only stored and served back byte-for-byte.
  **Reviewed, not changed, in the eighteenth session:** unlike general
  Documents, Discovery file registration (`lib/discovery/actions.ts#
  registerDiscoveryFile`) does not validate the uploaded file's MIME type
  against an allowlist — only the coarse `fileType` category (PDF/VIDEO/
  AUDIO/PHOTO/OTHER). The caller-declared MIME type is later echoed as the
  `Content-Type` response header on download. Accepted as low residual
  risk rather than fixed: the download route always forces
  `Content-Disposition: attachment`, which keeps a browser from rendering
  the response inline regardless of `Content-Type`, and Discovery's
  `OTHER`/video/audio evidence categories are intentionally broad — an
  allowlist tight enough to matter would conflict with that by design.
  Revisit if evidence-preview functionality is ever added, since that would
  remove the `attachment`-disposition mitigation.
- Discovery files and, as of the eleventh session, general documents are
  downloaded only through the app's own authenticated Route Handlers
  (`app/(dashboard)/matters/[matterId]/discovery/files/[fileId]/route.ts`
  and `.../documents/files/[documentId]/route.ts`), regardless of storage
  backend — the app never generates or exposes a Dropbox shared/public
  link for either. Every request still goes through `hasMatterAccess` and
  matter-scoped existence checks before any `documentStore.read()` call,
  and every failure mode (not logged in, no matter access, wrong matter,
  file doesn't exist, storage read fails) returns the same generic 404 —
  unchanged by which storage backend is active.

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
  and, as of the eleventh session, `lib/documents/actions.ts` log a
  `CREATE`/`UPDATE`/`EXPORT` `AuditEvent` for every file registration/
  upload, Bates generation, metadata edit, and download exactly the same
  way regardless of storage backend — both call `documentStore.save`/
  `.read`, not the Dropbox SDK directly, so switching storage backends
  doesn't change what gets audited or when.
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
- MFA rollout plan for all real staff accounts, including the
  admin-assisted-reset identity-verification process (a firm policy
  decision code cannot make — see "MFA/2FA status" above) and the
  required-MFA rollout order.
- Whether the JWT-revocability gap on deactivation (up to a 12-hour window
  — see "Authentication" above) is acceptable to launch with, or must be
  closed first.
- A final, dedicated security review after the firm demo and its
  feedback, before any real account or real case data is allowed — the
  pre-meeting hardening pass (this document's MFA/2FA, admin-reset, user
  management, and password-change updates) is not a substitute for that
  review.
