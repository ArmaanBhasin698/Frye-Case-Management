# lib/intake

Loop/HighLevel intake — normalize → durable pending record → staff review →
Client. See `docs/INTEGRATION_ARCHITECTURE.md` for the full write-up.

## Production intake strategy: pull-based sync, not the webhook

**Current production intake path is API polling** (`highlevelSync.ts`), not
the webhook (`webhookAuth.ts` + `app/api/intake/highlevel/route.ts`) —
depending on the paid HighLevel Workflow → Custom Webhook action was
deliberately dropped. **The webhook implementation is retained, not
deleted, but is inactive in production**: nothing in HighLevel is
configured to call it. It's kept because it was already built and locally
verified, and because it may be worth reactivating later (e.g. for
lower-latency intake) at negligible risk — it's a normal authenticated
Route Handler, not something that runs unless a real HighLevel Workflow is
pointed at it, and it shares every bit of normalization/idempotency logic
with the sync path (see below), so keeping it does **not** create a second,
divergent intake pipeline. If it's ever reactivated, update this section.

## Files

- `types.ts` — `NormalizedIntakeLead`, the provider-neutral shape.
- `normalize.ts` — `normalizeIntakeLead`, a pure function turning a raw
  HighLevel-shaped payload into a `NormalizedIntakeLead`, or explaining why
  it couldn't. Accepts **two** raw shapes on purpose: a webhook-delivery
  payload (`contactId`, `firstName`/`lastName`) and a live REST contact
  object (`id`, sometimes only a combined `contactName`) — the latter was
  confirmed against a real live call (see
  `docs/INTEGRATION_ARCHITECTURE.md`), the former still isn't (this
  codebase has never received a real webhook delivery). `type` is
  validated when present but never read — kept only so both raw shapes
  (one has it, one doesn't) can share this one validator.
- `config.ts` — `readHighLevelConfig` (API token/location),
  `readHighLevelWebhookSecret`, `readHighLevelSyncCronSecret`.
- `highlevelClient.ts` — small typed client: `fetchContactsPage` (the
  paginated read the sync service walks) and `listContactsForConfiguredLocation`
  (one-off verification only).
- `highlevelSync.ts` — `runHighLevelContactSync`, the **one** reusable
  sync service, called identically by the scheduled cron entry point
  (`app/api/cron/highlevel-sync`) and the manual "Sync from Loop" action
  (`reviewActions.ts#triggerHighLevelSync`). Walks contacts newest-first,
  stops once it crosses the persisted checkpoint (with a small overlap
  window), and feeds every contact through `ingestHighLevelContactEvent`
  below — see its own module comment for the full incremental-sync
  design and its one known limitation (a bare edit to an already-`PENDING`
  lead, with no new `dateAdded`, isn't reliably detectable this way).
- `ingest.ts` — `ingestHighLevelContactEvent`, the **shared** ingestion
  step both the webhook route and the sync service call: normalize, check
  `ExternalLeadLink` first (already-linked contacts are a no-op), then
  create-or-refresh a `PENDING` `IntakeLead`.
- `linking.ts` — `findClientIdByExternalContact` /
  `linkExternalContactToClient`, the durable persistence layer described
  below (`ExternalLeadLink`).
- `queries.ts` — `listPendingIntakeLeads`, `getIntakeLeadById`,
  `getHighLevelSyncState` (for the Intake page's "Last synced" display).
- `reviewActions.ts` — staff Server Actions: `dismissIntakeLead`,
  `linkIntakeLeadToExistingClient`, `createClientFromIntakeLead`,
  `triggerHighLevelSync`.
- `webhookAuth.ts` — `isAuthorizedBearerToken`, shared by the (inactive)
  webhook route and the cron endpoint.
- `fixtures.ts` — fictional payloads used by `tests/intake/`.

## Durable external-identity mapping (`ExternalLeadLink`)

`ExternalLeadLink` — `{ provider, externalId, clientId }`, unique on
`(provider, externalId)` — maps one external contact to one Frye `Client`.
A **separate model, not a `Client.externalIntakeId`** column, so:

- `Client` stays provider-agnostic.
- A second intake provider needs zero `Client` schema change.
- Duplicate mappings are prevented **at the database level**, not just an
  application-level check — see `linking.ts#linkExternalContactToClient`
  for how a genuine concurrent-delivery race is resolved.

**Idempotency guarantee:** given the same `(provider, externalId)` pair,
`findClientIdByExternalContact` always returns the same `clientId` once a
link exists, and a retried/duplicated delivery (webhook **or** sync) is a
safe no-op.

## `IntakeLead`: the pending-review record

Before a `Client` exists, a first-seen external contact becomes a `PENDING`
`IntakeLead` (`prisma/schema.prisma`) — only the already-normalized fields,
never a raw payload. Staff review it (`/intake`) and either link it to an
existing `Client`, create a new one (through the existing, authenticated
`createClientRecord`/`linkExternalContactToClient`), or dismiss it. A
settled (`LINKED`/`DISMISSED`) lead is never reopened by a later duplicate
delivery from either pipeline.

## Why there's still no automatic write path (by design, not a gap)

No code automatically creates a `Client` — CLAUDE.md §1 is explicit that
this system "starts at the 'client is retained' stage." The flow is
**staff-reviewed**: normalize → check `ExternalLeadLink` → (only for a
genuinely new contact) a `PENDING` `IntakeLead` → staff deliberately create
or link through the existing authenticated actions. If the firm later
wants fully automatic Client creation from intake, that's a separate,
explicit product decision.
