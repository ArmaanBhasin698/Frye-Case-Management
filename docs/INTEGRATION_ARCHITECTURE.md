# Integration Architecture

This document covers the three planned external integrations —
Dropbox (document storage), Vonage (calls/SMS/recordings), and
Loop/HighLevel (intake) — as of the pre-integration scaffolding pass. It
describes what is implemented and tested today using only fictional
fixtures and local/mock code, what still requires real provider access to
finish, and what is a deployment-time decision rather than a code
question.

**No real credentials, real external service calls, or real client data
were used to produce or verify anything in this document.** Everything
here was verified with fictional fixtures and mocked/local test doubles —
see each section's "Confidence" note for exactly what that does and
doesn't prove.

## Cross-integration principles (applied consistently in all three)

- **Provider-specific code is isolated at one boundary per integration.**
  `lib/storage/DocumentStore` (Dropbox), `lib/telephony/normalize.ts`
  (Vonage), `lib/intake/normalize.ts` (Loop/HighLevel) are the only places
  a provider-specific payload shape is allowed to appear. Everything else
  in the app — Server Actions, queries, UI — depends only on the
  normalized/provider-neutral types next to each boundary.
- **Server-side authorization stays authoritative and unchanged.** No
  integration adds a new way to bypass `hasMatterAccess`,
  `canManageClientsAndMatters`, or `isAdmin`. A webhook/adapter has no
  user session, so it never gets to assert matter membership or create a
  Client on its own — see each section below for exactly where the
  human-authenticated step still is.
- **No secrets, tokens, or raw provider payloads in logs or audit
  metadata.** Every new audit event follows the existing restraint pattern
  (booleans/enums/ids only — see `docs/SECURITY.md`'s "Audit logging").
  Nothing here reads, prints, or stores `.env` values.
- **Idempotency is handled where the schema already supports it, and
  called out explicitly where it doesn't.** See the table below.
- **A provider failure never corrupts local state.** Every new function
  either changes nothing (malformed/unsupported input) or makes one
  coherent, safe change (create-if-absent, update-only-if-missing) — never
  a partial write left for a retry to compound.
- **Fictional data only.** Every fixture, test, and example in the three
  new `lib/telephony`, `lib/intake`, and `lib/storage` test suites uses
  invented names, numbers, and ids.

### Idempotency strategy by integration

| Integration | Idempotency key | Where enforced | Strength |
|---|---|---|---|
| Dropbox | Storage key (fresh UUID per upload) | `DocumentStore.save` (write-once; `DocumentAlreadyExistsError` on collision) | Local: atomic (`wx` flag). Dropbox: atomic (`mode: "add"`), already true before this pass. |
| Vonage | `Call.vonageCallId` | `lib/telephony/ingest.ts` (find-then-create, with a DB-constraint fallback) | **Atomic as of the pre-integration hardening pass** — `@unique` on the column; a check-then-act race is caught (`P2002`) and resolved by re-reading, never a duplicate row or a 500. |
| Loop/HighLevel | `(provider, externalId)` on `ExternalLeadLink` | `lib/intake/linking.ts` (find-then-create, with a DB-constraint fallback) | **Atomic as of the pre-integration hardening pass** — `@@unique([provider, externalId])`; same race-resolution pattern as Vonage above. No automatic *Client creation* write path exists yet (still staff-reviewed by design — see `lib/intake/README.md`). |

### What happens when… (Phase 5)

| Situation | Behavior implemented this pass |
|---|---|
| Storage provider unavailable/read fails | `DocumentStore.read` throws; both download routes already catch any failure and return a generic 404 (unchanged, still correct with the new typed errors). |
| A Vonage webhook is duplicated/retried | `ingestVonageCallEvent` finds the existing `Call` by `vonageCallId` and returns `{outcome: "duplicate", ...}` — no second row, no field overwritten. |
| A Vonage event arrives out of order (e.g. "ringing" after "completed") | Non-terminal statuses are never ingested (`{outcome: "ignored", reason: "unsupported_status"}`), so an out-of-order earlier-stage event can't regress an already-created row — it's simply not actionable on its own. |
| A recording is temporarily unavailable | `storeCallRecording` is a distinct step from event ingestion specifically so this can't block call ingestion — a `Call` row is created/updated without a recording; recording storage is retried independently whenever the (future) adapter successfully fetches the bytes. |
| A call's matter association can't be determined | It isn't attempted. `ingestVonageCallEvent` never sets `matterId` — the call is created unfiled, exactly like a manually-logged call nobody has filed yet, and stays that way until an authorized staff member uses the existing `attachCallToMatter`. |
| Malformed data arrives (either integration) | Normalization returns a typed `{ok: false, reason: "malformed", detail}` — never throws, never partially writes. A webhook handler built on top of this can always respond 200 (so the provider doesn't retry-storm something Frye will never be able to use) while logging `detail` server-side only. |

## Dropbox boundary

**Boundary:** `lib/storage/DocumentStore` (`save`/`read`), implementation
selected via `STORAGE_PROVIDER` (`lib/storage/config.ts`).
`LocalDocumentStore` (default, used everywhere in dev/test) and
`DropboxDocumentStore` (dev/test Dropbox app, `STORAGE_PROVIDER=dropbox`)
both already exist and were reviewed, not redesigned — the interface
already covered upload/download/stable-key handling.

**What changed this pass (implemented and tested):**
- `DocumentNotFoundError` / `DocumentAlreadyExistsError` — the write-once
  and missing-file contract is now a typed, testable part of the
  interface (`lib/storage/DocumentStore.ts`). `LocalDocumentStore` now
  enforces both (previously it silently overwrote on key reuse and threw
  a raw `ENOENT`). `DropboxDocumentStore` already enforced write-once
  (`mode: "add"`); its error *typing* is intentionally unchanged (see
  below).
- Tests simulate: creating a fictional matter-scoped key, saving, reading
  it back, reading a never-saved key (`DocumentNotFoundError`), and
  retrying a save to an already-used key (`DocumentAlreadyExistsError`,
  original bytes untouched) — `tests/storage/document-store.test.ts`.

**Matter folder mapping:** no explicit "create folder" call is needed for
either backend — Dropbox creates intermediate folders implicitly on
upload, and the app's own key convention
(`matters/<matterId>/documents/<uuid>/...`,
`matters/<matterId>/discovery/<productionId>/<fileId>/...`) already
encodes the matter into the key. No extension was needed here.

**Metadata lookup:** deliberately **not added**. No current or planned-
this-pass caller needs an existence/size check independent of a full
`read()` — adding a speculative `exists()`/`stat()` method now would be
exactly the "invent an abstraction the product doesn't need yet" this
pass was told to avoid. If a future workflow needs one, extending the
interface with a narrow method is a small, additive change at that time.

**Confidence:** Real filesystem semantics (Node `fs`, `wx` flag) are
fully exercised and verified locally. `DropboxDocumentStore`'s behavior is
verified only against a mocked SDK client (existing tests, unchanged) —
never a live Dropbox call.

**What must be wired to real API behavior later:**
- Mapping Dropbox's actual error tags (`path/not_found` on download,
  `path/conflict` on a non-overwriting upload) onto `DocumentNotFoundError`
  / `DocumentAlreadyExistsError`. The comment above `DropboxDocumentStore`
  documents the expected tag names from Dropbox's public API docs, but
  this is explicitly unverified — confirm against a live/sandbox call
  before narrowing those catch blocks.
- OAuth/token handling: the existing design already keeps this
  server-side-only (`DROPBOX_REFRESH_TOKEN` etc. read once at process
  start in `lib/storage/config.ts`, never sent to a client) — unchanged,
  nothing new to build here besides supplying real values.
- Least-privilege scope: `docs/SECURITY.md` already specifies "App
  folder" access type plus `files.content.write`/`files.content.read`
  scopes only — a decision to make when generating the real refresh
  token, not a code change.

## Vonage boundary

**Boundary:** `lib/telephony/normalize.ts` (raw payload → normalized
event), `lib/telephony/ingest.ts` (normalized event → `Call` row,
idempotent, always unfiled), `lib/telephony/recording.ts` (already-fetched
bytes → `DocumentStore` → `Call.recordingDropboxPath`).

**Intended eventual flow** (unchanged from the brief, now with each step
mapped to actual code):

```
Vonage event -> normalizeVonageCallEvent -> ingestVonageCallEvent
  -> (unfiled Call row) -> attachCallToMatter (authenticated staff action,
     already exists, unmodified)
  -> [separately] adapter fetches recording bytes -> storeCallRecording
     -> DocumentStore -> Call.recordingDropboxPath
```

Matter association and recording retrieval are independent branches, not
a strict sequence — a call can be filed before, during, or after its
recording becomes available; neither step blocks the other.

**What's implemented and tested:**
- `normalizeVonageCallEvent` — validates a raw Vonage-shaped payload,
  ignores non-terminal/unsupported statuses (`ringing`, `answered`,
  `busy`, etc.) rather than erroring, and only produces a
  `NormalizedCallEvent` for a `"completed"` call with a real duration.
- `ingestVonageCallEvent` — idempotent by `Call.vonageCallId`; always
  creates unfiled (`matterId: null`); audits creation with `actorId: null`
  (no user session originated it) and non-sensitive metadata only; treats
  a foreign-key failure the same generic way every other create action
  in this codebase does.
- `storeCallRecording` — takes bytes as a parameter (never fetches them),
  stores under a call-scoped key (`calls/<callId>/recording`, not
  matter-scoped — see the code comment for why), updates
  `Call.recordingDropboxPath` with the storage key (never the provider's
  raw URL), and is safe against both the DB-level "already stored" check
  and a `DocumentAlreadyExistsError` race from a concurrent delivery.
- Fixtures cover: inbound (ringing, ignored), outbound completed, inbound
  completed with a recording reference, a duplicate/retried delivery, a
  malformed payload, and an unsupported-but-recognized status —
  `lib/telephony/fixtures.ts`, exercised in `tests/telephony/`.

**Resolved (pre-integration hardening pass):** `Call.vonageCallId` now
carries a `@unique` constraint (migration
`20260822005209_add_external_lead_link_and_vonage_call_id_unique`).
`ingestVonageCallEvent`'s `findFirst` check is still the fast path (avoids
an unnecessary insert attempt on the common case), but the constraint —
not that check — is the final authority: a genuine concurrent-delivery
race that gets past the check fails `create` with Postgres error `P2002`,
which is caught and resolved by re-reading the now-existing row, returning
the identical `{outcome: "duplicate", ...}` result the fast path would
have given with better timing. No duplicate row, no unhandled 500. Every
existing manually-logged `Call` has `vonageCallId: null`, and Postgres
treats every `NULL` as distinct for uniqueness purposes, so the migration
required no data changes and no manually-logged call is affected.

**Confidence:** All logic is exercised against fictional fixtures with a
fully mocked Prisma client — never a real Vonage payload, never a real
database write in this pass beyond the ad hoc read-only/cleanup runtime
checks described in the verification checkpoint.

**What must be wired to real API/webhook/recording behavior later:**
- An actual webhook Route Handler receiving Vonage's real HTTP callback
  (signature/auth verification, calling `ingestVonageCallEvent` with the
  parsed body) does not exist yet — `lib/telephony/` provides the
  processing logic a route handler would call, not the route itself.
- The real adapter that fetches recording bytes from Vonage's recording
  URL (with Vonage's own auth) and hands them to `storeCallRecording` — a
  fictional `Buffer` stands in for that today.
- Confirming the raw payload shape in `normalize.ts` against Vonage's
  actual webhook delivery (field names, status vocabulary, timestamp
  format) — written from docs, never a live event.

## Loop/HighLevel boundary

**Boundary:** `lib/intake/normalize.ts` (raw payload → normalized lead),
`lib/intake/mapToClientFields.ts` (normalized lead → `createClient`'s
input shape), `lib/intake/linking.ts` (durable external-contact ↔ `Client`
mapping, backed by the `ExternalLeadLink` model). **Still no automatic
Client-creation write path** — see `lib/intake/README.md` for the full
reasoning; that remains a deliberate product decision, not a technical
gap.

**What's implemented and tested:**
- `normalizeIntakeLead` — validates a raw HighLevel-contact-shaped
  payload, rejects incomplete/malformed payloads without throwing, treats
  an empty-string email as absent rather than invalid.
- `mapIntakeLeadToClientFields` — pure mapping onto exactly
  `createClient`'s field shape; proven not to touch the database (it has
  no dependency on `@/lib/db` at all).
- `findClientIdByExternalContact` / `linkExternalContactToClient` — the
  durable persistence layer resolved this pass (see "Resolved" below):
  idempotent lookup, first-time linking with audit logging (provider
  only, never the raw external id), a no-op on a repeated delivery to the
  same client, an explicit `conflict_linked_to_different_client` result
  rather than a silent overwrite when an external contact is already
  linked elsewhere, and a `client_not_found` result for a forged/
  nonexistent `clientId` instead of an unhandled FK error.
- Fixtures cover: new lead, updated lead, a duplicate/retried delivery
  (same `contactId`), an incomplete payload (missing `lastName`), and a
  malformed payload — `lib/intake/fixtures.ts`, exercised in
  `tests/intake/`.
- A test proves normalizing the same duplicate payload twice yields
  byte-identical output.

**Resolved (pre-integration hardening pass):** the schema gap that
previously blocked persistent, idempotent linking is closed —
`ExternalLeadLink { provider, externalId, clientId }`, unique on
`(provider, externalId)` (migration
`20260822005209_add_external_lead_link_and_vonage_call_id_unique`), chosen
over a `Client.externalIntakeId` column specifically so a second intake
provider never requires a `Client` schema change (see
`lib/intake/README.md` and the schema comment above the model for the
full reasoning). `linkExternalContactToClient` checks first (fast path)
and falls back to catching the unique-constraint error on a genuine
concurrent-link race, resolved by re-reading — the same pattern as
Vonage's `ingestVonageCallEvent` above, applied consistently across both
integrations.

**What remains a deliberate product decision, not a technical gap:**
whether/when to build an unattended webhook that automatically creates a
`Client` for a brand-new contact. The persistence layer now makes that
safe to build whenever the firm decides it wants it; this pass
deliberately does not build it, per the staff-reviewed design intent in
`lib/intake/README.md`.

**Confidence:** All logic (including `linking.ts`) is exercised against
fictional fixtures with a fully mocked Prisma client, plus one real
(fictional-data) run against the actual local dev database in this pass's
verification — never a real HighLevel payload or webhook call.

**What must be wired to real API/webhook behavior later:**
- An actual webhook Route Handler (signature/auth verification, calling
  `normalizeIntakeLead` and then `findClientIdByExternalContact`) does not
  exist yet.
- Whatever UI/review step presents a mapped, not-yet-linked lead to staff
  for deliberate Client creation does not exist yet — today
  `mapIntakeLeadToClientFields` and `linkExternalContactToClient` are
  library functions with no caller.
- Confirming the raw payload shape against a real HighLevel webhook
  delivery — written from docs, never verified live.

## What's implemented vs. requires access vs. deployment-only

**Implemented and tested now (fictional data, local/mock only):**
- Dropbox: `DocumentStore` write-once/missing-file contract,
  `LocalDocumentStore` enforcing it, fixtures/tests for create/read/
  missing/duplicate.
- Vonage: full normalize → ingest → (separately) store-recording pipeline,
  idempotent by `vonageCallId` (now DB-enforced via `@unique`, not just
  application-level), never auto-files a matter, fixtures/tests for all
  required scenarios including a simulated concurrent-delivery race.
- Loop/HighLevel: normalize → map-to-Client-fields →
  find-or-link-durably (`ExternalLeadLink`, DB-enforced via
  `@@unique([provider, externalId])`), fixtures/tests for all required
  scenarios including first-time link, repeated delivery,
  duplicate/conflicting external id, and a simulated concurrent-link race.
  Automatic Client creation from a webhook remains a deliberate product
  decision not made this pass — see `lib/intake/README.md`.

**Requires real provider access to finish (see each section above for
specifics):** live-verifying the three raw payload shapes; building the
three actual webhook Route Handlers; the real Dropbox error-tag mapping;
the real Vonage recording-fetch adapter; the real HighLevel API calls (if
any beyond webhooks); the staff-review UI for a mapped, not-yet-linked
intake lead.

**Deployment-only concerns (not this document's scope, already tracked in
`docs/SECURITY.md`):** HTTPS/webhook-signature verification at the edge,
secret storage in a real secrets manager, IP/global rate limiting on any
new public webhook endpoint, and the existing pre-integration
baseline gaps (`docs/SECURITY.md`'s "Rate limiting status", "Open items
for later phases") — unrelated to and unaffected by this pass.
