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

## 4. Workflow templates

| Capability | Implementation | Tests | Browser | Status |
|---|---|---|---|---|
| ADMIN-managed templates, versioned on edit, active/archive, category | `lib/workflows/{actions,queries,fields}.ts`, `app/(dashboard)/admin/workflows/**` | `tests/workflows/actions.test.ts` | §14-1 | TESTED |
| Ordered TASK/EVENT steps: title, description, priority, calendar-day offsets (explicitly not business days/court rules), time of day, duration, event type, assignee rule | `lib/workflows/schedule.ts`, `components/shared/workflows/template-editor.tsx` | `tests/workflows/schedule.test.ts` (offsets incl. negative, DST) | §14-3 | TESTED |
| Anchor date + time zone, full preview with resolved assignees/dates, explicit confirm | `components/shared/workflows/apply-workflow-panel.tsx`, `lib/workflows/actions.ts` | actions tests | §14-3 | TESTED |
| Starter templates (retained client, discovery review, hearing prep, trial prep, closure follow-up) stored as editable DB rows | `lib/workflows/starters.ts` (idempotent install; seed) | actions tests | §14-1 | TESTED |
| Atomic application into Task/CalendarEvent; normal board/calendar visibility; ids-only audit | `lib/workflows/actions.ts` | rollback + audit tests | §14-3 (event on calendar verified in re-run) | TESTED +B |
| Retry idempotency (per-form `requestKey`) vs deliberate second application | `WorkflowApplication.requestKey @unique` | concurrency/unique-violation tests | §14-3 | TESTED |
| History references exact version; later edits never rewrite created records | matter Workflows tab | version-immutability tests | §14-1/3 | TESTED |
| Preview-only confirmed recalculation; skips completed work; never moves Deadlines | `components/shared/workflows/recalculate-form.tsx` | recalculation tests | §14-3 (preview) | TESTED |
| Server-side authorization for every generated record/assignee (ADMIN or assigned ATTORNEY/PARALEGAL may apply; assignees must have matter access) | `lib/workflows/actions.ts` | role + forged-id tests | §14-11 | TESTED |
| Automatic stage-triggered application | — | — | — | NOT STARTED (manual application only, as permitted) |

## 5. Case stages & custom fields

| Capability | Implementation | Tests | Browser | Status |
|---|---|---|---|---|
| Ordered configurable stages, rename/reorder/archive, suggested set | `lib/stages/*`, `app/(dashboard)/admin/stages` | `tests/stages/stages.test.ts` | §14-1 | TESTED |
| Matter stage assignment (canEditMatter), append-only history, header badge, list column + filter, scoped counts | `lib/stages/actions.ts`, matter layout/overview, `/matters` | stages tests | §14-3 | TESTED |
| Stage change never closes/reopens/archives (separate from status/closure) | `lib/stages/actions.ts` writes `stageId` only | explicit no-side-effect test | §14-3 | TESTED |
| Custom field definitions: MATTER/CONTACT (incl. organizations)/CLIENT; 6 types; label, help, order, options, archive; key immutable; type locked once values exist; options retired not deleted | `lib/custom-fields/*`, `app/(dashboard)/admin/custom-fields` | `tests/custom-fields/*` | §14-1 | TESTED |
| Typed server-side value validation; retired option/definition display | `lib/custom-fields/values.ts` | values tests | §14-3 | TESTED |
| Render/edit on matter, contact, client pages with each record's own authorization | `components/shared/custom-fields/*`, `lib/custom-fields/access.ts` | access tests | §14-3 | TESTED |
| Filters: matter list by custom field; saved MATTERS reports | `/matters`, `lib/reports/saved.ts` | queries + saved tests | §14-10 | TESTED |
| Contacts-list custom-field filter | — | — | — | PARTIAL (not built) |
| Template merge fields `custom.matter.*`, `custom.client.*` | `lib/documents/merge-data.ts` | templates tests | §14-5 | TESTED |
| Audit never contains values | actions | audit assertions | — | TESTED |

## 6. Global search, saved reports, CSV

| Capability | Implementation | Tests | Browser | Status |
|---|---|---|---|---|
| Header search + `/search`: matters, clients (ADMIN/ATTORNEY), contacts, tasks, document metadata, time, notes, chat, rulings, observations — scope inside each query before count/page/snippet | `lib/search/{index,scope,params}.ts`, `components/shared/global-search-box.tsx` | `tests/search/*` | §14-4, §14-11 | TESTED |
| Type/date/matter/active-archived filters; forged matter filter returns nothing; bounded 2–100 chars; case-insensitive partial, exact first; stable pagination | `lib/search/params.ts` | params/scope/run tests | §14-4 | TESTED |
| Document **content** results (separate section, own full-text index) | `app/(dashboard)/search/page.tsx` → `lib/documents/content-search.ts` | content-search tests | §14-5 | TESTED (date/archive filters don't apply to contents — stated in UI) |
| Saved reports (MATTERS w/ stage & custom field, TASKS, TIME, USAGE admin-only, SEARCH), re-scoped on every run | `lib/reports/saved*.ts`, `app/(dashboard)/reports/saved/**` | `tests/reports/saved*.test.ts` | §14-10 | TESTED |
| Authorized, audited CSV exports with formula-injection protection; time amounts ADMIN-only | `app/(dashboard)/reports/export/[kind]/route.ts`, `lib/csv` | export + `tests/csv` | §14-10 | TESTED |
| Query text never logged | search modules | asserted | — | TESTED |
| Custom-field filter UI is free-text equals (not typed picker); export cap 5,000 rows | — | — | — | PARTIAL |

## 7. Document workflows

| Capability | Implementation | Tests | Browser | Status |
|---|---|---|---|---|
| Matter folders (nest/move/rename), tags, filters; metadata only | `lib/documents/{folders,folder-actions}.ts`, `components/shared/document-workspace.tsx` | `tests/documents/folders.test.ts` | §14-5 | TESTED |
| Reusable folder sets, idempotent apply | `app/(dashboard)/admin/folder-sets` | folders tests | §14-5 | TESTED |
| Append-only versions, new storage key per version, current pointer, legacy (pre-version) documents still download; per-version authenticated download | `lib/documents/version-actions.ts`, `…/files/[documentId]/versions/[versionId]/route.ts`, migration v1 backfill | `versions.test.ts`, `version-route.test.ts` | §14-5 | TESTED |
| Template library (versioned), explicit merge-field catalog incl. custom fields, preview, missing-field validation, provenance | `lib/documents/{templates,merge-data,template-actions}.ts`, `app/(dashboard)/admin/document-templates` | `templates.test.ts` | §14-5 | TESTED |
| Generated output: formatted PDF via pdf-lib (multipage, page numbers, explicit handling of non-WinAnsi characters), stored as a normal Document | `lib/documents/generated-pdf.ts` | non-ASCII fixture tests | §14-5 | TESTED |
| DOCX/Word merge, rich editing, conditional clauses | — | — | — | PARTIAL (plain-text templates → PDF only) |
| Content index: txt/md/csv, text-layer PDF (`unpdf`), .docx (`mammoth`); scanned/other formats UNSUPPORTED and never match; failures never block upload | `lib/documents/{extraction,indexing,schedule}.ts` | `extraction.test.ts` with real fixture bytes | §14-5 | TESTED |
| Permission-scoped content search (matter scope inside parameterized SQL, current versions only) | `lib/documents/content-search.ts` | `content-search.test.ts` | §14-5, §14-11 | TESTED |
| OCR | — | — | — | NOT STARTED (no OCR; no external service) |
| Discovery originals/Bates untouched | `lib/discovery/*` unchanged | existing discovery tests | — | TESTED (pre-existing) |

## 8. Notifications & reminders

| Capability | Implementation | Tests | Browser | Status |
|---|---|---|---|---|
| Persisted inbox (unread/read/dismissed, mark all), per-user preferences, header bell | `lib/notifications/{queries,actions}.ts`, `app/(dashboard)/notifications`, `app/(dashboard)/account/notifications`, `components/shared/notification-bell.tsx` | `tests/notifications/inbox.test.ts` | §14-6 | TESTED |
| Task assigned/due (multiple offsets)/overdue; deadline due/overdue; event reminders (multiple offsets, recurrence, DST, occurrence exceptions); event changed/cancelled; DM activity | `lib/notifications/planner.ts` | `planner.test.ts` (deterministic clock) | §14-6 | TESTED |
| Completed tasks, cancelled events/occurrences, satisfied deadlines never notify; rescheduling re-arms | planner | explicit tests | — | TESTED |
| Idempotent bounded scheduler: atomic lock, stale recovery, `skipDuplicates`, retries/concurrency | `lib/notifications/scheduler.ts`, `SchedulerLock` | `scheduler.test.ts` | §14-6 (dev CLI run) | TESTED |
| Runs without any browser: secret-protected cron route + dev CLI | `app/api/cron/notifications/route.ts`, `scripts/run-notifications.ts` | `cron-route.test.ts` | §14-6 | TESTED |
| Access re-checked on list/count/open (revoked matter access / left conversation hidden and not counted) | queries | inbox tests | §14-6 (Taylor) | TESTED |
| Production scheduler host | — | — | — | BLOCKED (hosting not chosen) |
| External delivery (email/SMS/push) | none | — | — | NOT STARTED (disconnected; nothing ever reports "delivered") |

Computed dashboard reminder cards (pre-existing), persisted in-app notifications (this pass), and external delivery (absent) are distinct.

## 9. Matter expenses (approved domain H)

| Capability | Implementation | Tests | Browser | Status |
|---|---|---|---|---|
| Manual expenses: date, recorder/responsible staff, category, description, quantity × unit cost (exact integer/BigInt cents, half-up), billable, receipt Document (same matter) | `lib/expenses/*`, `app/(dashboard)/matters/[matterId]/expenses` | `tests/expenses/money.test.ts`, `actions.test.ts` | §14-9 | TESTED |
| Amount visibility: ADMIN + assigned ATTORNEYs only, omitted server-side (rows, totals, CSV) | `lib/expenses/access.ts`, `views` | `views.test.ts` | §14-9 | TESTED |
| Corrections (field-name audit), void with reason, never delete | actions | actions tests | §14-9 | TESTED |
| Totals, filters, firm-wide view, authorized audited CSV | `app/(dashboard)/expenses/**` | `export-route.test.ts` | §14-9 | TESTED |
| Invoices, payments, trust ledger, reconciliation, QuickBooks | — | — | — | NOT STARTED (out of scope; see §12B) |

## 10. Known expansion follow-ups

| Capability | Implementation | Tests | Browser | Status |
|---|---|---|---|---|
| Chat reply threads: reply, thread view with parent context, counts, pagination, unread, soft-delete, access re-check on every poll | `lib/chat/*`, `components/shared/chat-thread-panel.tsx`, messages route `?parentId=` | `tests/chat/{queries,actions}.test.ts` | §14-8 | TESTED |
| Calendar occurrence exceptions (cancel/edit one vs whole series; identity = original UTC start) | `lib/calendar/occurrences.ts`, `…/events/[eventId]/occurrence` | `tests/calendar/occurrence*.test.ts` | §14-7 | TESTED |
| Multiple event reminder offsets | `CalendarEvent.reminderOffsetsMinutes`, event form | calendar + planner tests | — | TESTED |
| "Schedule with this contact" prefill (visibility-checked) | `lib/calendar/prefill.ts`, `schedule-with-contact-link.tsx` | calendar tests | §14-7 | TESTED |
| Task due dates as optional calendar layer (existing Task rows) | `lib/calendar/queries.ts` (`?tasks=1`) | calendar tests | §14-7 | TESTED |
| Matter "Deadlines & Calendar" tab shows series-level events (not per-occurrence changes) | — | — | — | PARTIAL |
| Configurable event labels/colors | evaluated: keep enum types authoritative; optional admin label/color table would need its own schema approval | — | — | NOT STARTED (recommendation recorded) |
| Contact manual merge/redirect tool | **Proposal:** ADMIN-only; merge B into A only when the admin can see both; move MatterContact/relationships/interactions/calls/custom values in one transaction with per-row conflict rules (duplicate role links collapse, earliest dates kept); B kept as an archived redirect stub (`mergedIntoId`) — never deleted; full audit; no automatic merging. Needs schema approval (`Contact.mergedIntoId`). | — | — | BLOCKED (approval) |
| Session IP/user-agent capture | Not captured (Auth.js sign-in callback lacks the request). **Proposal:** capture on the first heartbeat per session (request headers available), store truncated UA + IP, retention 365 days, ADMIN-only. Privacy review required. | — | — | BLOCKED (privacy review) |

## 14. Verification evidence (this pass)

- Full Vitest: **115 files / 1331 tests passed** (baseline 1024).
- `npm run lint`: clean. `npm run typecheck`: exit 0. `npm run build`: exit 0.
- Migration `20261023180000_mycase_parity` applied to the disposable local DB; `prisma migrate diff` reports no drift; seed (fictional) succeeds.
- Browser walkthrough (production build, fictional seed accounts ADMIN /
  2 ATTORNEYs / PARALEGAL / STAFF; screenshots kept out of the repo):
  - First run: **71 PASS, 4 FAIL** from two real defects, plus 3 checks
    blocked by them:
    1. Document-folder writes failed at runtime — the per-matter advisory
       lock used `$queryRaw` on a `void` function (Prisma P2010). Unit tests
       mocked the client, so they passed. **Fixed:** `$executeRaw`
       (`lib/documents/folder-actions.ts`).
    2. Zone-labelled time formatting combined `dateStyle`/`timeStyle` with
       `timeZoneName`, which Intl rejects (TypeError) — crashing workflow
       previews with timed event steps, the workflow history page, and
       contact profiles with a timed meeting (the last one shipped in PR
       #28). **Fixed:** shared `DATE_TIME_WITH_ZONE` component options
       (`lib/calendar/timezone.ts`) + a real-Intl regression test
       (`tests/calendar/format-options.test.ts`).
  - Re-run of every failed/blocked check after the fixes: **7/7 PASS**
    (timed-event workflow preview + apply + event on calendar + history
    page; folder set apply idempotent 8→8; document move changes folder
    only, storage key/hash unchanged; contact profile with timed meeting);
    server log free of P2010/Intl errors.
  - Covered in the walkthrough: §14-1 admin configuration, §14-3 custom
    values/stage change (status unchanged)/workflow apply incl. retry and
    deliberate re-application, §14-4 global search incl. forged matter
    filter, §14-5 versions (distinct bytes per version), content index
    hit, template generation → PDF, §14-6 scheduler (23 created, re-run 0),
    inbox read/dismiss, restricted user sees nothing, §14-7 occurrence
    cancel, contact prefill, task layer, §14-8 thread reply + count, §14-9
    expense amount gating (paralegal hidden / attorney + admin visible /
    CSV / STAFF 404), §14-10 saved report + CSV, §14-11 STAFF 404 matrix,
    §14-12 regression spot checks (history, outcome, time, chat, PDF,
    usage), §14-13 mobile 390px without horizontal overflow (dashboard,
    matter, search).


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
| **D1. Mobile** | Responsive web shell only; no native app, offline, or push. 390px-wide dashboard, matter, and search pages render without horizontal overflow (§14). | PARTIAL (web only) |
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
