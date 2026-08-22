# Security Monitoring + Incident Response Exercise (Local, Fictional Data)

This document records a controlled local exercise: adding suspicious-login
detection and admin triage to the app, generating a fictional incident, and
getting introductory hands-on exposure to Nmap/osquery — all against the
local development environment, using only fictional accounts and data. It
is not a professional penetration test or a production incident. See
"Limitations" below.

## Scope

Local Frye Case Management development environment (`security/local-app-
assessment` branch) only. No production systems, real network, real client
data, or external services (Dropbox, Vonage, Loop/HighLevel, MyCase,
QuickBooks) were touched. All accounts used are the fictional seed accounts
from `prisma/seed.ts` (see README's demo credentials table).

## Tools used

- **Nmap** — local port/service discovery against `127.0.0.1` only.
- **osquery** — osquery 5.23.1 installed locally; `osqueryi` used manually
  (by the user, after the automated work in this session) for introductory
  endpoint/system investigation exposure. See "osquery" below.
- **Vitest, ESLint, `tsc`, `next build`** — the project's existing
  verification suite.

## Security testing performed this session

No new vulnerabilities were being hunted for as a primary goal — the focus
was monitoring/IR. What was exercised:

- **Authorization boundary of the new admin feature**
  (`tests/security/actions.test.ts`): a STAFF and an ATTORNEY caller are
  both rejected by `updateSecurityIncidentStatus`, without the database
  being touched. Confirmed live: an unauthenticated `GET /admin/security`
  returns `307` to `/login?callbackUrl=%2Fadmin%2Fsecurity`, the same gate
  every other protected route uses.
- **Forged/nonexistent ID handling**: passing a `SecurityIncident` id that
  doesn't exist returns the same generic "Not found or access denied."
  rather than a distinguishable error.
- **Invalid state-transition handling**: the lifecycle is enforced
  forward-only (`OPEN → INVESTIGATING → RESOLVED|FALSE_POSITIVE`); a
  terminal-state incident or a skipped step (`OPEN → RESOLVED`) is
  rejected server-side, not just hidden in the UI.
- **Sensitive-data handling**: failed-login tracking never stores the
  attempted password. Status-change audit metadata is limited to
  `{ field, from, to }` — no email, no account name, no case data.
- **Local attack-surface assessment**: `nmap -sV -p 3000 127.0.0.1` (run
  by the user prior to this session) confirmed only the Frye dev server
  is reachable on that port; a follow-up scan this session
  (`nmap -sV -p 22,80,443,3000,5432,5555 127.0.0.1`) confirmed only
  `3000` (Next.js dev server) and `5432` (local Postgres) are open on
  localhost, everything else closed. See "Limitations" for an issue this
  second scan caused.
- **Local attack-surface reconfirmation via osquery**: the `listening_ports`
  table, queried with `osqueryi` (by the user, after the automated work
  this session), independently confirmed the same two localhost ports Nmap
  found — the Frye Next.js development server on `3000` and local Postgres
  on `5432` — from OS-level socket/process state rather than active
  network probing. See "osquery" below.

## Monitoring: suspicious-login detection and admin triage

### What was built

**`lib/security/detection.ts`** — `recordFailedLoginAttempt(email)` is
called from the login Server Action
(`app/(auth)/login/actions.ts#authenticate`) every time `verifyPassword`
returns null (wrong password, inactive account, or unknown email). It:

1. Looks up the account by email (for correlation only — never re-derives
   or stores anything about the password).
2. Records a `FailedLoginAttempt` row (`accountId?`, `emailAttempted`,
   `occurredAt`).
3. If the account has **5 failures inside a rolling 10-minute window**
   (`SUSPICIOUS_LOGIN_THRESHOLD` / `SUSPICIOUS_LOGIN_WINDOW_MS`, both
   named constants — a configurable demonstration rule, not an
   industry-standard threshold) and no `SecurityIncident` is already
   `OPEN`/`INVESTIGATING` for that account, opens one
   (`category: SUSPICIOUS_LOGIN`, `severity: MEDIUM`).

Attempts against an email with no matching account are still recorded
(`accountId: null`) but never count toward the threshold or open an
incident, since there's no account to correlate them against.

**Schema change (approved before running):** two new tables,
`FailedLoginAttempt` and `SecurityIncident`, plus three small enums
(`SecurityIncidentCategory`, `SecurityIncidentSeverity`,
`SecurityIncidentStatus`). No existing model could hold this safely —
`AuditEvent`'s `action` enum (`CREATE/UPDATE/DELETE/VIEW/EXPORT`) is tied to
real business entities elsewhere in the database, and repurposing it for a
mutable incident-status machine would have meant deriving "current status"
by rescanning a general-purpose audit table — fragile, and a bad precedent
for a table the rest of the app relies on for real audit meaning. Migration
`20260821214932_add_security_incident_tracking` was applied to the local
dev database only.

**`/admin/security`** (`app/(dashboard)/admin/security/`) — ADMIN-only
page (`assertIsAdmin`, same pattern as `/admin/users`), listing incidents
with a status badge and buttons for each valid next status.
**`lib/security/actions.ts#updateSecurityIncidentStatus`** — the only way
status changes: independently re-checks `isAdmin()` (never trusts the page
alone), validates the id exists, validates the requested transition against
a forward-only transition map, updates the row, and writes an `AuditEvent`
(`entityType: "SecurityIncident"`, actor = the admin, `metadata: { field:
"status", from, to }`).

### What this is not

Detection and alerting only — **not rate limiting**. A failed attempt is
never slowed, throttled, or blocked; it's recorded and, past the threshold,
flagged for a human. Real rate limiting on the password step remains a
documented, separate gap in `docs/SECURITY.md` (needs a platform-level
WAF/rate-limiter or a shared store like Redis — an infrastructure decision
outside this codebase, unchanged by this session).

## Mock incident

Using the fictional STAFF account `taylor.brooks@fryelawgroup.example`
(from `prisma/seed.ts` — no real person), 5 wrong-password attempts were
made against the real local dev database, exercising the exact
`recordFailedLoginAttempt` function the app calls on every failed login (a
raw-HTTP click-through of the login form itself was attempted but proved
too fragile to hand-craft reliably against Next.js's dev-mode Server Action
wire protocol — see "Limitations"). Result, read back from the database:

```json
{
  "attemptCount": 5,
  "incidents": [
    { "status": "OPEN", "severity": "MEDIUM", "failedAttemptCount": 5, "category": "SUSPICIOUS_LOGIN" }
  ]
}
```

## Investigation and incident-response walkthrough

1. **Detection** — the 5th failed attempt inside the 10-minute window
   crossed the threshold; `detectSuspiciousLogin` ran automatically as
   part of recording that attempt.
2. **Alert generation** — a `SecurityIncident` row was created
   (`OPEN`, `MEDIUM`). Verified manually: signed in as the fictional admin
   `alex.rivera@fryelawgroup.example` and opened `/admin/security` in the
   browser, where the generated `SUSPICIOUS_LOGIN` incident was visible
   with its `OPEN` status badge.
3. **Triage** — still as the fictional admin, in the browser, the incident
   was moved `OPEN → INVESTIGATING` by clicking the corresponding status
   button on `/admin/security`, exercising the real
   `updateSecurityIncidentStatus` Server Action end-to-end through an
   actual authenticated HTTP request (not just the direct
   database/function-level verification `tests/security/actions.test.ts`
   performs).
4. **Investigation** — in a real incident this is where an admin reads
   `emailAttempted`/timestamps on the `FailedLoginAttempt` rows and any
   correlated `AuditEvent`s for that account to judge intent (typo storm
   vs. targeted guessing) and check whether any *successful* login followed
   the failures (it didn't, here).
5. **Scope determination** — one fictional account, one time window, no
   other accounts crossed the threshold, no successful sign-in followed —
   scope is a single account, contained.
6. **Containment recommendation** — since this account showed no successful
   sign-in, no forced session revocation is needed; a real deployment would
   still want the password-step rate limiter (still absent — see above) to
   actually slow the next burst, since detection alone doesn't block
   anything.
7. **Remediation recommendation** — force a password reset on the affected
   account if the pattern looked credential-stuffing-like (it's a fixed
   demo password shared by all seed accounts here, so this step is
   illustrative only); require MFA going forward
   (`lib/admin/users/actions.ts#setUserMfaRequired` already exists for
   this).
8. **Verification / retest** — still in the browser as the fictional admin,
   the incident was moved `INVESTIGATING → RESOLVED` on `/admin/security`
   (audited). The page was then refreshed, and the incident's status was
   confirmed to still read `RESOLVED` — i.e. the change persisted server-side
   rather than being an artifact of client-side UI state. Separately, a
   fresh burst of 5 failures against the same account was generated
   against the database: it correctly opened a **new** `SecurityIncident`
   rather than silently reusing the resolved one, confirming detection
   isn't disabled by a prior resolution:

   ```json
   {
     "resolvedStatus": "RESOLVED",
     "incidentsAfterRetest": [
       { "status": "RESOLVED" },
       { "status": "OPEN" }
     ]
   }
   ```
9. **Access-control verification** — signed in as a fictional non-admin
   seed account and attempted to navigate to `/admin/security` in the
   browser: access was denied (redirected away from the Security feature),
   confirming the same ADMIN-only gate holds for a real authenticated
   non-admin session, not just the automated STAFF/ATTORNEY rejection
   tests in `tests/security/actions.test.ts`.

## Nmap experience

- `nmap -sV -p 3000 127.0.0.1` (run by the user prior to this session):
  confirmed port 3000 open, correctly fingerprinted as the Frye HTTP
  application. Recorded as authorized local service-discovery/
  attack-surface-assessment experience.
- One additional scan this session,
  `nmap -sV -p 22,80,443,3000,5432,5555 127.0.0.1`: confirmed only 3000
  (dev server) and 5432 (local Postgres) open, everything else closed —
  useful confirmation that the dev environment isn't exposing anything
  unexpected on localhost. **This scan's "unrecognized service" fingerprint
  dump included live `Set-Cookie` header values (Auth.js CSRF-pairing
  cookies) in its terminal output** — nmap echoes raw response
  bytes for services it can't positively identify, and version-detection
  probes provoke real HTTP responses. This was not anticipated before
  running the scan. Actual risk was low (unauthenticated, per-request,
  already-superseded nonces on a local fictional dev instance — not a
  password, session, or real credential), but it violated this exercise's
  own rule against printing CSRF values, so it's recorded here plainly
  rather than omitted. No further Nmap version-detection scans were run
  against the app's HTTP port after this was noticed.

## osquery

osquery 5.23.1 was installed locally (by the user, after the automated
work in this session — the install itself needed an interactive `sudo`
prompt this tool's shell can't supply) and `osqueryi` was used
interactively for introductory endpoint/system investigation exposure —
not a full osquery deployment, fleet enrollment, or scheduled-query setup.
Three ad hoc queries were run against the local machine:

- **Running processes** (`processes` table) — general familiarization with
  osquery's SQL-over-OS-state model.
- **Listening ports** (`listening_ports` table) — confirmed the Frye
  Next.js development server listening on port `3000` and local Postgres
  listening on port `5432`, corroborating the Nmap findings above from an
  OS-level (socket/process table) vantage point rather than external
  network probing.
- **Logged-in users** (`logged_in_users` table) — general familiarization;
  no anomalies expected or found on this single-user development machine.

## Findings

- No application vulnerabilities were found or fixed this session — the
  work was additive (monitoring) and confirmatory (existing RBAC/authz
  boundaries hold, localhost attack surface is as expected).
- One process finding: Nmap version-detection scans against the app's own
  HTTP port can leak live response headers (including CSRF cookies) into
  terminal/log output — worth remembering for future local scans.
- osquery's `listening_ports` query corroborated the Nmap port findings
  (only `3000` and `5432` open) from an independent, OS-level vantage
  point — consistent evidence, no discrepancy found.
- One environment finding: this Next.js/Turbopack dev setup does not
  reliably pick up a Prisma schema migration without also clearing the
  `.next/` build cache — a plain process restart was not sufficient
  (verified directly: a fresh `PrismaClient()` in plain Node had the new
  models immediately; the running dev server did not, until `.next/` was
  cleared). Not a security finding, but worth documenting since it could
  otherwise look like a broken migration.

## Containment / remediation actions taken

None needed for real risk — the "incident" was fictional and self-generated
for this exercise. The `SecurityIncident` model and admin page exist so a
*real* future detection has a place to be triaged; no account was locked,
reset, or had its role changed as part of this session.

## Retest

Confirmed above under "Verification / retest": after resolving the first
incident, a fresh qualifying burst of failures correctly opened a new one
rather than being suppressed — the control behaves correctly across the
full Open → Investigating → Resolved → (new detection) cycle.

## Limitations

- **This is a controlled local exercise, not a professional penetration
  test or a real incident response.** No production systems, real
  network, real client data, or external integrations were involved.
- Hand-crafting the raw Next.js Server Action HTTP protocol to click
  through the actual login *form* via `curl` was attempted and abandoned
  as unreliable in this environment (the dev-mode action-reference
  protocol didn't resolve as expected even with correctly-extracted
  tokens); the 5 wrong-password attempts that generated the mock incident
  were instead made directly against the real local database using the
  same `recordFailedLoginAttempt` function the app calls on every failed
  login, which is weaker than a genuine end-to-end browser click-through
  of the login *form* itself. (The admin-triage side of the walkthrough —
  opening `/admin/security`, changing incident status, and confirming a
  non-admin's access is denied — was subsequently verified manually
  through the browser; see "Investigation and incident-response
  walkthrough" above.) No browser-automation tool (e.g., Playwright) was
  available in this environment to close the remaining gap on the
  login-form side, and installing one would be a dependency change
  requiring separate approval.
- Rate limiting on the password step remains unimplemented (detection and
  alerting only); this was explicitly out of scope for this exercise per
  `docs/SECURITY.md`'s existing "Rate limiting status" section.
- Severity on detected incidents is a static `MEDIUM` for the one
  configured rule — no severity-scoring logic exists yet.

## Update (final internal-hardening pass)

The "What this is not" section above and the "Limitations"/"Findings"
callouts describing password-step rate limiting as unimplemented were
accurate when this document was written, but are now superseded: a later
session (the final internal-hardening pass, `security/final-internal-
hardening` branch) added an account-level cooldown
(`lib/security/password-cooldown.ts`) that actually blocks further
password attempts once one account crosses its own threshold — see
`docs/SECURITY.md`'s "Rate limiting status" section for the current,
accurate description, including what it does and does not cover. This
document's own detection/alerting mechanism (`SecurityIncident`,
`/admin/security`) is unchanged and independent of that cooldown; the two
are described together in `docs/SECURITY.md`.
