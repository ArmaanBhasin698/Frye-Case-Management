# Production Readiness Checklist

This is the final pre-production checklist, written after a fictional-data
end-to-end smoke test of the application (see `docs/ROADMAP.md` for the
session-by-session build history and `docs/SECURITY.md` for the detailed
security design/status). It exists to answer one question: **what
concretely has to happen before this app can be trusted with a real client
and real case data?**

Nothing in this document changes application behavior — it's a checklist,
not code. Items are grouped by who has to act on them.

**This checklist is a snapshot, updated most recently by the pre-meeting
production-hardening pass** (MFA/2FA, admin-assisted reset, minimal user
management, forced first-login password change, the seed/reset production
guard, the health endpoint, and Node version pinning — see
`docs/SECURITY.md` for the full design of each). A dedicated, final
security review is still expected **after** the firm demo and its
feedback, before any real staff account or real case data is allowed —
this document does not substitute for that review.

## Smoke-test result (most recent pass)

- Full Vitest suite, `npm run lint`, `npm run typecheck`, and
  `npm run build` all pass cleanly with zero code changes required.
- Server-side authorization was exercised end-to-end with fictional ADMIN
  and STAFF accounts (`prisma/seed.ts`): unauthenticated redirect, ADMIN
  full access, STAFF matter-scoped access, forged/unassigned matter URLs
  (safe 404, not a distinguishable "denied" page), unfiled-call visibility
  restricted to ADMIN/ATTORNEY, and Reports/Tasks/Calendar/Discovery/
  Communications firm-wide scoping — all matched documented behavior with
  no data leakage found.
- No bugs were found or fixed in this pass.
- **Not exercised by this pass, and requiring a manual browser
  click-check before go-live** (no headless-browser tooling was available
  in this environment, and installing one requires separate approval —
  see "Manual click-check list" below): Client/Matter create and edit
  forms, the Archive/Reactivate UI flow, Task/Deadline/CalendarEvent
  create and edit forms, and Document upload/download/edit-metadata. Each
  of these has passing unit-level test coverage for its authorization and
  validation logic (`tests/clients/actions.test.ts`,
  `tests/matters/actions.test.ts`, `tests/documents/actions.test.ts`,
  `tests/discovery/actions.test.ts`), but that does not substitute for
  clicking through the real form once in a browser against the live dev
  server.

### Manual click-check list (do this once, in a browser, against `npm run dev`)

1. Log in as `alex.rivera@fryelawgroup.example` (ADMIN). Create a new
   fictional Client, then a new fictional Matter for that client. Edit
   both. Confirm both appear in their respective lists and the Matter's
   Timeline records the creates.
2. Archive that new Matter, confirm it disappears from the default Matters
   list, then reactivate it and confirm it reappears unchanged.
3. Try to archive a Client that still has an OPEN/PENDING Matter (e.g. the
   seeded "Jordan Ellis" or "Amara Patel") and confirm the UI blocks it
   with a clear message. Then archive an eligible Client (e.g. seeded
   "Devon Marsh," whose only Matter is CLOSED) and reactivate it.
4. Create a Task and a Deadline/CalendarEvent on any Matter, edit each,
   and confirm they show up in the firm-wide Tasks and Calendar pages.
5. Upload a small harmless fictional test file as a Document on any
   Matter, confirm its metadata (title/category), download it and confirm
   the bytes match the original file, edit its metadata, then confirm a
   user without access to that Matter gets a 404 (not the file) when
   given the direct download URL.
6. Log in as a restricted user (e.g. `taylor.brooks@fryelawgroup.example`,
   STAFF) and repeat steps 4–5 to confirm the same matter-scoping applies
   to writes, not just reads.

## Staff / credential dependencies (blockers — need firm involvement)

- [x] **MFA/2FA — implemented, fictional accounts only.** TOTP second
      factor, admin-assisted reset (re-auth-gated, forces re-enrollment,
      never reveals the previous secret/codes), and forced first-login
      password change for admin-created accounts are all built and tested
      (pre-meeting production-hardening pass; `docs/SECURITY.md`'s "MFA/2FA
      status"). **Still a blocker:** no real Frye staff account has ever
      used this — that's the actual gap between "demo" and "production,"
      not the missing feature itself. Also still open: no admin-assisted
      *password* reset for an existing account (only new accounts get a
      temporary password today), and required-MFA rollout still needs an
      admin to explicitly set it per account (no bulk tooling).
- [ ] **Production Auth.js secret.** `AUTH_SECRET` must be a freshly
      generated, unique-to-production value, stored only in the hosting
      provider's secret manager — never reused from any `.env` used in
      development. `MFA_ENCRYPTION_KEY` needs the same treatment, plus a
      documented rotation procedure (see `docs/SECURITY.md`'s "Secrets &
      configuration") since rotating it without one would lock out every
      enrolled account's TOTP.
- [ ] **Real Dropbox authorization.** The `DropboxDocumentStore` interface
      already exists and is exercised in development/test
      (`STORAGE_PROVIDER=dropbox`), but production needs the firm's real
      Dropbox account, a firm-owned (not personal-dev) Dropbox app,
      encrypted-at-rest token storage, and a real per-matter folder
      structure decision. Deliberately deferred per `CLAUDE.md`.
- [x] **Production user/account provisioning — mechanism implemented,
      decision still pending.** ADMIN-only user management
      (`/admin/users`: create, role, activate/deactivate, `mfaRequired`,
      MFA status) now exists, so creating a real account no longer needs
      direct database access. **Still a firm decision, not a code gap:**
      who the first 1–2 real ADMINs are, and the rollout order for
      everyone else.

## Infrastructure (blockers)

- [ ] **Hosting choice/configuration** for the Next.js app.
- [ ] **Managed production PostgreSQL** (not the local dev instance) —
      connection string, network access rules, and version compatible
      with the Prisma schema.
- [ ] **Backups and restore testing.** Not yet done at all
      (`docs/ROADMAP.md`, "Later / not yet scheduled" — "Formal
      backup/disaster-recovery testing"). Must include at least one
      practiced restore, not just a backup job that's assumed to work.
- [ ] **HTTPS/domain.** Required not just for transport security but for
      `Strict-Transport-Security` (already sent by `next.config.mjs`, a
      no-op over HTTP today) to take effect.
- [ ] **Production environment variables/secrets** set directly in the
      hosting provider, matching `.env.example`'s keys — never copied from
      a developer's local `.env`.
- [ ] **Rate limiting / WAF.** Not implemented (`docs/SECURITY.md`, "Rate
      limiting status"). Needs either a hosting-provider/reverse-proxy
      layer in front of `/login` and the Auth.js credentials callback, or
      a shared external store (Redis or equivalent) backing a real
      limiter — a per-process in-memory counter was deliberately not
      built as a placeholder since it silently stops working with more
      than one instance.
- [ ] **Logging/monitoring.** No centralized log aggregation or error
      alerting exists yet; the app currently only logs to stdout/stderr in
      dev.
- [ ] **Content-Security-Policy.** Deliberately not implemented yet
      (`docs/SECURITY.md`, "Security headers") — Radix UI's inline-style
      usage needs a nonce-based or scoped policy, not a one-line addition.
      Not a hard launch blocker on its own (baseline headers are already
      in place), but should be scheduled as near-term follow-up once
      real traffic exists.
- [x] **Health/readiness endpoint — implemented.** `GET /api/health`
      checks real DB reachability, returns only `{status, db}` (no
      versions, counts, or internal config), and is excluded from the auth
      gate so a host's uptime probe doesn't need a session.
- [x] **Node version pinning — implemented.** `package.json#engines` and
      `.nvmrc` both pin the documented `>=20.9.0` baseline, so a host can't
      silently pick a different Node major version.
- [x] **Seed/reset production guard — implemented.** `db:seed`/`db:reset`
      now refuse to run unless `NODE_ENV` is `development` or `test`
      (`lib/db/seed-guard.ts`), closing a real gap where either could have
      wiped a live database with zero confirmation. **Known residual
      limitation:** the guard covers the `npm run` scripts and
      `prisma/seed.ts` itself; it can't intercept the Prisma CLI invoked
      directly (e.g. `npx prisma migrate reset`), bypassing `package.json`
      entirely — the production host should simply not have these scripts
      or an interactive `prisma` CLI reachable at all, as defense in depth.
- [ ] **`trustHost` validation.** `lib/auth/config.ts`'s `AuthConfig.trustHost:
      true` has not been validated against any real host, because none has
      been chosen — see `docs/SECURITY.md`'s "Authentication" section for
      the exact checklist to run through once one is.

## Data migration (blockers before any real import)

- [ ] Identify exact source system(s)/exports to migrate from (MyCase at
      minimum; confirm scope with the firm — Loop/HighLevel and monday.com
      are explicitly out of scope per `CLAUDE.md`).
- [ ] Write and review a field-by-field migration mapping (MyCase fields →
      `prisma/schema.prisma` models) before any script is written.
- [ ] Build and validate the migration against a **test** import first —
      fictional or de-identified data only, never real client data, until
      the mapping is verified end-to-end.
- [ ] Take a full backup of the production database immediately before any
      real import runs.
- [ ] No real client/firm data is to be loaded during this pass or any
      pass before the above are complete — this document does not change
      that.

## Rollout (blockers before daily use)

- [ ] Final staff role/access verification: confirm every real staff
      member's `UserRole` and `MatterAssignment` rows match what the firm
      actually wants before anyone relies on the scoping to hide a matter.
- [ ] Limited pilot: run with one or two real matters (not the full
      caseload) before full cutover from MyCase.
- [ ] Backup/rollback plan: a documented way to fall back to MyCase if the
      pilot surfaces a blocking issue.
- [ ] Basic staff training/operating notes: at minimum, how to log in,
      what a 404 on a matter means (no access, not "doesn't exist"), and
      how archive/reactivate works.

## Optional / non-blocking (can happen after launch)

These are real roadmap items but do not block staff-assisted production
setup or a limited pilot:

- Vonage integration (`docs/ROADMAP.md`, Phase 6) — manual call logging
  already works; Vonage automates it later.
- QuickBooks Online / billing integration — not built into the schema yet,
  explicitly a later phase.
- monday.com replacement for tasks/workflows — native Tasks already work;
  this is a "nice to have" once they're in daily use.
- Full firm-wide raw audit-feed UI (per-matter Timeline already exists;
  only the firm-wide raw feed is missing — Reports' Activity section
  already gives derived counts).
- Content-Security-Policy (see infrastructure section — not launch-blocking
  given baseline headers are already in place, but shouldn't be pushed off
  indefinitely).

## What can still be done without staff involvement

- The manual click-check list above (create/edit/archive/reactivate flows,
  Document upload/download).
- Any further code-level bug fixes surfaced by that click-check.
- Writing the migration mapping document (design work, not the real
  import).
- Evaluating/shortlisting hosting and managed-Postgres providers (decision
  work, not signing up with real firm billing details).
- Drafting the staff training notes.
