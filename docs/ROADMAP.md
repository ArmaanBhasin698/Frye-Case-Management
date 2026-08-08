# Roadmap

This roadmap sequences the work from groundwork to a functioning system. It
intentionally avoids dates — pace depends on one developer's available time.
Each phase should be fully usable/stable before starting the next.

## Phase 0 — Groundwork (this session)

- [x] Inspect the repository.
- [x] Decide and document architecture direction (Next.js, TypeScript,
      PostgreSQL, Prisma, shadcn/ui).
- [x] Write `CLAUDE.md` and the `docs/` folder
      (`PROJECT_PLAN.md`, `ARCHITECTURE.md`, `DATA_MODEL.md`,
      `SECURITY.md`, `ROADMAP.md`).
- [x] Design core entities and relationships.
- [x] Create initial folder structure (empty scaffolding).
- [x] Create `.gitignore` and `.env.example`.
- [x] Write project README.
- [ ] **Not done yet, deliberately:** any actual application code, Next.js
      project initialization, Prisma schema, or dependencies.

## Phase 1 — Application bootstrap

- [ ] Initialize the actual Next.js + TypeScript project (`package.json`,
      config files) matching the folder structure in
      `docs/ARCHITECTURE.md`.
- [ ] Set up Prisma with a local PostgreSQL instance; create the initial
      schema for User, Client, Matter, MatterAssignment (the minimum needed
      for login + "see my matters").
- [ ] Set up Auth.js with credentials-based login and role field.
- [ ] Install and configure shadcn/ui + Tailwind.
- [ ] Basic authenticated app shell (sign in, sign out, empty dashboard).

**Exit criteria:** a developer can clone the repo, set env vars from
`.env.example`, run migrations, and log in to an empty dashboard.

## Phase 2 — Clients & Matters (first real vertical slice)

- [ ] Client CRUD (create/list/view/edit) with server-side validation.
- [ ] Matter CRUD, linked to a Client, with MatterAssignment.
- [ ] Matter-level authorization: users only see matters they're assigned
      to, unless admin.
- [ ] AuditEvent wired in for all of the above from the start.

**Exit criteria:** a staff member can create a client, open a matter for
them, assign staff to it, and have that access properly restricted and
audited.

## Phase 3 — Case workflow essentials

- [ ] Notes on a matter.
- [ ] Tasks (assignable, with status/priority) on a matter.
- [ ] Deadlines on a matter, with a simple upcoming-deadlines view.
- [ ] Calendar events on a matter.
- [ ] A per-matter timeline/activity view combining the above (backed by
      AuditEvent + the entities themselves).

**Exit criteria:** day-to-day case management (notes, tasks, deadlines,
calendar) works without MyCase for a pilot matter.

## Phase 4 — Discovery management (core differentiator)

- [ ] `DiscoveryProduction` and `DiscoveryFile` CRUD.
- [ ] Standardized Dropbox folder-structure convention per matter
      (documented in a new `docs/DISCOVERY.md` once designed).
- [ ] Bates numbering for PDFs (apply to a copy; preserve the original).
- [ ] Consistent identifier scheme for video/audio/photo files.
- [ ] Content hashing on ingest to support later comparison.
- [ ] Discovery production comparison (new/changed/duplicate/missing)
      across two productions.

**Exit criteria:** discovery for a pilot matter can be received, numbered,
organized, and a re-served production compared against the original.

## Phase 5 — Communications (groundwork for Vonage)

- [ ] Generic `Communication` logging (manual entry first — no Vonage yet).
- [ ] `Call` entity and UI for manually logging/filing a call to a matter,
      as a stand-in for the eventual Vonage sync.

**Exit criteria:** the data model and UI for communications are proven out
manually before any Vonage API work begins.

## Phase 6 — Integrations (Dropbox, Vonage)

- [ ] Dropbox integration behind `lib/storage/DocumentStore`: link matter
      folders, browse/upload/reference files from the app.
- [ ] Vonage integration behind `lib/telephony/CallProvider`: pull call/SMS
      history, support flagging and filing a real call to a matter, save
      recordings into the matter's Dropbox structure.
- [ ] Re-run the security checklist in `docs/SECURITY.md` specifically for
      these integrations (scoped tokens, encrypted storage of credentials,
      audit logging of integration actions) before enabling them with real
      data.

**Exit criteria:** the "search a call, flag it, attach to client/matter,
save recording" workflow described in the project goals works end-to-end.

## Phase 7 — Reporting & polish

- [ ] Reporting views (caseload by attorney, upcoming deadlines firm-wide,
      discovery status, etc.).
- [ ] Full audit/activity history views per matter and firm-wide (admin).
- [ ] UI/UX polish pass.

## Later / not yet scheduled

- [ ] Loop/HighLevel intake handoff (bring a new client from lead → Matter
      automatically or semi-automatically).
- [ ] monday.com replacement for tasks/workflows firm-wide (if still
      desired once native Tasks are in daily use).
- [ ] QuickBooks Online integration for billing/accounting.
- [ ] Migrating any historical data out of MyCase (only after the
      replacement is trusted in daily use on new matters).
- [ ] MFA for staff logins.
- [ ] Formal backup/disaster-recovery testing.

## Explicitly deferred (do not build until asked)

Per the current project phase, the following should **not** be started
without explicit direction from the firm:

- Any live third-party integration (Dropbox, Vonage, Loop/HighLevel,
  MyCase, QuickBooks).
- Billing/invoicing features.
- Real data migration of any kind.
- A fully built-out UI in one pass — build and stabilize one phase at a
  time.
