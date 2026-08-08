# Security

This system will eventually hold confidential, privileged criminal-defense
case information: client identities, charges, discovery (which can include
sensitive evidence, victim/witness information, and law-enforcement
materials), attorney work product, and communications. Security is a
first-class requirement from day one, not something added before launch.

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

- Every staff user has their own account — no shared logins.
- Passwords hashed with a strong, modern algorithm (argon2 or bcrypt), never
  stored or logged in plaintext.
- Session-based auth via Auth.js, with reasonable session expiry and the
  ability to force sign-out (e.g., on role change or offboarding).
- Design the auth flow so multi-factor authentication (TOTP) can be added
  later without restructuring — do not paint ourselves into a
  password-only corner.
- Failed login attempts are logged and rate-limited to slow credential
  stuffing/brute force.

## Authorization

- Role-based: `admin`, `attorney`, `paralegal`, `staff` (expand as needed).
- **Matter-level access control**: being logged in is not enough. A user
  must be assigned to a matter (via `MatterAssignment`) or hold an admin
  role to view or modify that matter's data — this mirrors ethical-wall and
  confidentiality expectations in a law firm.
- All authorization checks happen **server-side**, on every Server
  Action/Route Handler, regardless of what the UI does or doesn't show.
  Never trust the client.
- Discovery and communications are especially sensitive — apply the same
  matter-assignment check to them, not just to the parent Matter record.

## Audit logging

- Every create/update/delete on Client, Matter, Note, Task, Deadline,
  CalendarEvent, Communication, Call, Document, DiscoveryProduction, and
  DiscoveryFile produces an `AuditEvent` (see `docs/DATA_MODEL.md`).
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
