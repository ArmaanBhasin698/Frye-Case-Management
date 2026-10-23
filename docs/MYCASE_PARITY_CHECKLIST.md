# MyCase parity checklist

Evidence-based status of MyCase-equivalent capabilities in Frye Case
Management. Branch `feature/mycase-parity-completion`, base `main` @
`37e3c9b`. Schema/dependency approvals: see
`docs/MYCASE_PARITY_SCHEMA_PROPOSAL.md` (domains A–H approved; I deferred).

**Status legend.** NOT STARTED · IMPLEMENTED (code exists, not yet verified
by tests/browser) · TESTED (automated tests; "+B" = also exercised in the
browser walkthrough on fictional data) · PARTIAL · BLOCKED (needs an
approval/decision that hasn't been given) · DEFERRED BY OWNER.

**Evidence kinds are kept separate:** *Implementation* = source paths;
*Tests* = automated tests; *Browser* = the fictional-data walkthrough. A
fixture-tested adapter is never described as a live connection.

This pass does **not** make Frye a complete MyCase replacement; see
sections 11–13 for what remains.

---

## Baseline already merged (PR #27, #28) — verified at start of this pass

Independently re-run on `main` @ `37e3c9b` before any change: 85 test
files / 1024 tests passed, `npm run lint` clean, `tsc --noEmit` exit 0.
Per-feature detail for these modules is in
`docs/FIRM_OPERATIONS_EXPANSION.md` §7 (Appendix A requirements) and is not
duplicated here; regressions are re-checked in this pass's walkthrough.

| Capability | Implementation | Status |
|---|---|---|
| Auth, MFA, user admin, session revocation, incident monitoring | `lib/auth/`, `lib/security/` | TESTED (pre-existing) |
| Clients/matters, assignments, archive, notes, tasks/board, deadlines | `lib/clients/`, `lib/matters/` | TESTED (pre-existing) |
| Discovery (hash, Bates derivatives, comparison), DocumentStore | `lib/discovery/`, `lib/storage/` | TESTED (pre-existing) |
| Contacts directory, roles, relationships, interactions, duplicates | `lib/contacts/` | TESTED (+B in PR #27) |
| Professional history, closure workflow | `lib/history/` | TESTED (+B in PR #28) |
| Calendar views, recurrence, meeting links | `lib/calendar/` | TESTED (+B in PR #28) |
| Time entries/timers, usage analytics, PDFs | `lib/time/`, `lib/usage/`, `lib/reports/` | TESTED (+B in PR #28) |
| Team chat, Slack scaffolding (disconnected) | `lib/chat/`, `lib/integrations/slack/` | TESTED (+B in PR #28) |

---

<!-- SECTIONS 4–10: filled in with evidence as each workstream lands -->

---

## 11. Client-facing and connected features — design & approval gates

None of these are built in this pass. Nothing here is "integrated".

| Capability | Current state | Required design before approval | Status |
|---|---|---|---|
| **A. Client portal & secure client messaging** | None. Clients/contacts have no login. Staff identities only (`User`). | Separate `PortalIdentity` (never a `User`/staff role), per-matter share grants for selected documents/versions, messages, tasks, events only; invitations with expiry/revocation; recovery; client uploads with file-type/size checks and malware-scan decision; message retention; full audit. Internal channels, notes, observations, staff activity are never shareable. | BLOCKED (identity/schema design + approval; live email invitations need separate authorization) |
| **B. Email & SMS filing** | Manual call logging; `lib/telephony/` Vonage normalization tested with fixtures only — not connected. No email. | Native `Communication` records per matter/contact; inbound/outbound provider boundary (Vonage for SMS); provider message ids + idempotency; attachments; threading; staff review queue for ambiguous matches; delivery state machine that never shows "delivered" without a provider receipt. Email provider (Gmail/Outlook/other) must be chosen and approved first. | BLOCKED (provider choice + approval) |
| **C. Google/Outlook calendar sync** | None. Occurrence identity (`CalendarEventException.originalStart`) is designed to support future sync. | OAuth + encrypted token storage, staff↔calendar mapping, least-privilege scopes, two-way create/edit/cancel, recurring-exception mapping, time zones, conflict resolution, replay/idempotency, revocation. An `.ics` download would not be two-way sync. | BLOCKED (approval; no accounts/tokens) |
| **D. E-signatures** | None. | Provider choice; signers/order; sent/viewed/signed/declined/expired states; verified webhooks + replay protection; completion certificate; immutable executed bytes stored as a new DocumentVersion. | BLOCKED (provider + approval) |
| **E. Production Dropbox / Vonage / Slack** | Dropbox dev/test store only; Vonage library only; Slack `DisconnectedSlackProvider` (no network). | Firm-owned Dropbox app, folder mapping, encrypted tokens, original-byte retention; Vonage webhooks/credentials; Slack event notifications separate from history sync, with matter/channel membership re-checked before anything is published. | BLOCKED (production approval) |

## 12. Transition plan and deferred product gaps

| Capability | Current state | Status |
|---|---|---|
| **A. Offline import/export & MyCase cutover** | Domain I (ImportBatch/ImportRow/ExternalRecordLink) proposed, **not approved**. No import code. CSV *exports* exist for saved reports/expenses (this pass). Current firm tools stay in use until staff acceptance, data coverage, backup/restore tests, and cutover approval. | DEFERRED BY OWNER |
| **B. Billing, invoices, retainers, payments, trust accounting, reconciliation, financial reports** | Absent by design. Time `billable` flag/rates and expenses (this pass) are capture only and do **not** close these gaps. Decision needed: what stays in MyCase/QuickBooks/a specialist provider. | NOT STARTED (needs separately approved scope) |
| **C. AI summaries / assistant / MCP connector** | None. No case data is sent to any AI service. Requirements to define: provider/data handling, inherited authorization, grounded citations, human review, retention, separately permissioned tool access; never infer billable time from activity or AI. | NOT STARTED (needs scope/security approval) |
| **D1. Mobile** | Responsive web shell only; no native app, offline, or push. Mobile-width usability checked in this pass's walkthrough (see section 14 evidence). | PARTIAL |
| **D2. Conflict review** | Global search (this pass) can support a manual conflict check; there is no conflict-clearance record and never an automatic "clear". Hidden matters are never exposed. | NOT STARTED |
| **D3. Lead intake** | Kept in Loop/HighLevel by decision; Frye's `/intake` review queue + `lib/intake/highlevelSync.ts` handle the handoff (not production-deployed). | TESTED (pre-existing; handoff only) |
| **D4. Practice-specific MyCase offerings** (e.g. personal-injury/immigration-specific features) | Not applicable to criminal defense unless the firm says otherwise. | DEFERRED BY OWNER (applicability) |

## 13. Approvals & schema discipline

- Approved this pass: schema domains A–H (one additive migration
  `20261023180000_mycase_parity`), dependencies `unpdf@1.9.1`,
  `mammoth@1.13.0` (lockfile +23 packages).
- Not approved: domain I (import), portal identities, provider credential
  models, AI/MCP, billing/trust, contact merge, session IP/user-agent capture.
- No production database, deployment, live service, or credential was used.
