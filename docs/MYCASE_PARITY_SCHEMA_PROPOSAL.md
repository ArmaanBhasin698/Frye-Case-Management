# MyCase parity pass — additive schema & dependency proposal

Status: **APPROVED 2026-10-23 for domains A–H** (owner decision); domain I
(import dry-run) **not approved — deferred**. Expense amounts: visible to
ADMIN and to ATTORNEYs assigned to the matter. Dependencies `unpdf@1.9.1`
and `mammoth@1.13.0` approved. Base: `main` @ `37e3c9b` (PR #28 merged). Every change is
additive (new tables, new nullable columns, new enum types); no table or
column is dropped, renamed, or narrowed; existing rows stay valid with no
required backfill except where noted. Migrations are applied only to the
disposable local Postgres in the dev container with fictional seed data.

Approval is requested per domain (A–I). Unapproved domains stay BLOCKED in
`docs/MYCASE_PARITY_CHECKLIST.md`; independent, schema-free work (global
search, CSV export, chat thread UI, contact-prefilled scheduling, task-due
calendar layer) proceeds regardless.

## A. Workflow templates (section 4)

| Model | Key fields | Constraints / notes |
|---|---|---|
| `WorkflowTemplate` | name, description, `category` (RETAINED_CLIENT_SETUP, DISCOVERY_REVIEW, HEARING_PREPARATION, TRIAL_PREPARATION, CLOSURE_FOLLOW_UP, OTHER), `status` ACTIVE/ARCHIVED, createdById | Archive only; never deleted. |
| `WorkflowTemplateVersion` | templateId, `version`, createdById, createdAt | `@@unique([templateId, version])`. Editing a template creates a new version; old versions are immutable. |
| `WorkflowTemplateStep` | versionId, `position`, `kind` TASK/EVENT, title, description, `priority`, `offsetDays` (calendar days, may be negative), `timeOfDay` ("HH:mm", events), `durationMinutes`, `eventType`, `assigneeRule` (UNASSIGNED / LEAD_ATTORNEY / ASSIGNED_PARALEGAL / SPECIFIC_USER), `assigneeUserId?` | `@@unique([versionId, position])`. Offsets are explicitly calendar days; no court-rule or holiday inference. |
| `WorkflowApplication` | matterId, templateVersionId, `anchorDate`, `timeZone`, `requestKey` (client-generated per form submission), appliedById, createdAt | `@@unique([requestKey])` makes a retried submission a no-op; a deliberate second application uses a new key, so same template + same anchor is allowed. |
| `Task.workflowApplicationId?`, `Task.workflowStepId?`; `CalendarEvent.workflowApplicationId?`, `CalendarEvent.workflowStepId?` | nullable FKs (SetNull) | Provenance only; later template edits never touch created rows. Recalculation is preview → confirm, skips completed tasks/past events, never touches `Deadline`. |

## B. Case stages (section 5)

| Model | Key fields | Constraints |
|---|---|---|
| `MatterStage` | name, `position`, archivedAt | name unique among active stages (app-enforced). |
| `Matter.stageId?` | nullable FK (SetNull) | Independent of `status`, `archived`, closure. Existing matters start with no stage. |
| `MatterStageChange` | matterId, fromStageId?, toStageId?, changedById, changedAt | Append-only history. |

## C. Custom fields (section 5)

| Model | Key fields | Constraints |
|---|---|---|
| `CustomFieldDefinition` | `entity` MATTER/CONTACT/CLIENT, `key` (stable slug), label, helpText, `type` SHORT_TEXT/LONG_TEXT/NUMBER/BOOLEAN/DATE/SINGLE_SELECT, `options` Json `[{id,label,archived}]`, `position`, archivedAt | `@@unique([entity, key])`. **Type is immutable once any value exists**; options are retired (archived), never deleted, so stored option ids keep resolving. |
| `CustomFieldValue` | definitionId, one of matterId?/contactId?/clientId?, valueText?, valueNumber Decimal(18,4)?, valueBoolean?, valueDate?, valueOptionId?, updatedById, updatedAt | `@@unique([definitionId, matterId])`, `([definitionId, contactId])`, `([definitionId, clientId])`; typed columns mean a definition change can't corrupt values. Audit records "changed" + definition id only — never the value. |

## D. Saved reports (section 6)

| Model | Key fields | Notes |
|---|---|---|
| `SavedReport` | ownerId, name, `kind` MATTERS/TASKS/TIME/USAGE/SEARCH, `filters` Json (Zod-validated per kind), createdAt, updatedAt | Stores filters only — no results, no ids-with-privileges. Re-scoped to the *running* user every time; USAGE kind ADMIN-only. |

## E. Document workflows (section 7)

| Model | Key fields | Constraints / compatibility |
|---|---|---|
| `DocumentFolder` | matterId, name, parentId?, position | `@@unique([matterId, parentId, name])`. |
| `DocumentFolderSet` / `DocumentFolderSetItem` | set: name, archivedAt; item: setId, path ("Discovery/Body cam"), position | Applying a set creates missing folders only (idempotent by unique key). |
| `Document.folderId?`, `Document.tags String[]` (default `{}`), `Document.currentVersionId?` (`@unique`) | additive | Moving changes metadata only. |
| `DocumentVersion` | documentId, `version`, storageKey, originalFilename, mimeType, sizeBytes, contentHash, uploadedById, createdAt | `@@unique([documentId, version])`, append-only. **Backfill:** one v1 row per existing stored Document copied from its current columns (the existing columns stay authoritative for old rows and are kept in sync for the current version — existing download links keep working). |
| `DocumentTemplate` / `DocumentTemplateVersion` | template: name, category, status, createdById; version: templateId, version, `body` (text with `{{merge.field}}` tokens), createdById | Versions immutable. |
| `Document.generatedFromTemplateVersionId?`, `Document.generatedById?` | additive | Provenance for generated PDFs (pdf-lib, standard fonts; non-WinAnsi characters reported, not silently dropped). |
| `DocumentTextIndex` | documentVersionId `@unique`, `status` INDEXED/UNSUPPORTED/FAILED/PENDING, `text`, extractedAt, extractor | Searched with parameterized Postgres full-text (`to_tsvector`/`plainto_tsquery`) inside the caller's matter scope. |

## F. Notifications & reminders (section 8)

| Model | Key fields | Constraints |
|---|---|---|
| `Notification` | userId, `kind` (TASK_ASSIGNED, TASK_DUE, TASK_OVERDUE, DEADLINE_DUE, DEADLINE_OVERDUE, EVENT_REMINDER, EVENT_CHANGED, EVENT_CANCELLED, CHAT_MENTION/CHAT_DM), `entityType`, `entityId`, matterId?, `dedupeKey`, `title` (generated, no free text), createdAt, readAt, dismissedAt | `@@unique([userId, dedupeKey])` → scheduler retries never duplicate. Access re-checked on list/open; inaccessible ones hidden and not counted. |
| `NotificationPreference` | userId, kind, `inApp` Boolean | `@@unique([userId, kind])`. External channels not modeled (disconnected). |
| `Task.reminderOffsetsMinutes Int[]`, `CalendarEvent.reminderOffsetsMinutes Int[]`, `Deadline` reminders reuse existing `reminderDaysBefore` | additive, default `{}` | `CalendarEvent.reminderMinutesBefore` kept and honored. |
| `SchedulerLock` | `name` @unique, lockedUntil, lastRunAt, lastOutcome | Mutex for the bounded job (same pattern as `HighLevelSyncState`). Runs from a secret-protected cron route + a dev CLI script; production scheduler choice recorded as pending. |

## G. Calendar occurrence exceptions (section 10)

| Model | Key fields | Constraints |
|---|---|---|
| `CalendarEventException` | eventId, `originalStart` (UTC instant of the generated occurrence), `kind` CANCELLED/MODIFIED, override start/end/title/location/meetingUrl?, createdById, createdAt | `@@unique([eventId, originalStart])` — stable occurrence identity for future sync. Whole-series edits keep existing exceptions whose original start still exists in the new series. |

## H. Matter expenses (section 9) — **financial domain, separate approval**

| Model | Key fields | Notes |
|---|---|---|
| `Expense` | matterId, `incurredOn`, recordedById, responsibleUserId?, `category` (FILING_FEE, EXPERT, INVESTIGATOR, TRANSCRIPT, COPIES, POSTAGE, TRAVEL, SERVICE_OF_PROCESS, OTHER), description, `quantity` Decimal(12,3), `unitCostCents` Int, `totalCents` Int (server-computed, integer arithmetic with half-up rounding), `billable`, receiptDocumentId? (same matter), voidedAt/voidReason, createdAt/updatedAt | No invoices, payments, trust, reconciliation, or QuickBooks. **Visibility of amounts needs a decision (see question).** |

## I. Offline import dry-run (section 12A) — optional now

`ImportBatch` (source FICTIONAL_FIXTURE, status, counts, hash, createdById) +
`ImportRow` (batchId, rowNumber, externalId, entity, outcome, errors Json) +
`ExternalRecordLink` (source, externalId, entity, localId; `@@unique([source, entity, externalId])`).
Recommended to defer until a reviewed fictional export-format fixture exists.

## Not proposed now
Client portal identities, email/SMS filing, calendar sync tokens,
e-signature, production Dropbox/Vonage/Slack, billing/trust, AI/MCP,
contact merge, session IP/UA capture — each stays in the checklist as
BLOCKED/DEFERRED with its design requirements.

## Dependencies (separate approval)

| Package | Version | Purpose | Installed alternative | Lockfile impact |
|---|---|---|---|---|
| `unpdf` | 1.9.1 (MIT, zero runtime deps; bundles a serverless pdf.js build) | Extract text from text-based PDFs for the content index | none — `pdf-lib` cannot extract text | +1 package |
| `mammoth` | 1.13.0 (BSD-2) | Extract raw text from .docx | none | +~8 transitive (jszip, lop, xmldom, …) |

Without these, content indexing covers plain-text formats (.txt, .md,
.csv) only; PDF/DOCX are recorded as UNSUPPORTED and never reported as
matches. Scanned PDFs (no text layer) remain UNSUPPORTED either way — no
OCR, no external service.

## Testing steps (disposable DB)
1. `npx prisma migrate dev --create-only --name mycase_parity`; review SQL
   for DROP/ALTER COLUMN (only `ADD` expected) and append the
   DocumentVersion v1 backfill.
2. `npx prisma migrate dev` against the container-local
   `frye_case_management` database; `prisma migrate diff` must report no
   drift; `NODE_ENV=development npm run db:seed` (fictional only).
3. Full Vitest, lint, typecheck, build, and the browser walkthrough.

Rollback: the migration is additive; reverting the app commit leaves
unused tables/columns harmlessly. A down-migration is not generated
(Prisma doesn't); dropping the new tables would be a separate reviewed
change.
