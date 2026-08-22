# lib/telephony

Pre-integration scaffolding for the eventual Vonage integration — normalization
and ingestion boundary only. **No Vonage code exists here**: nothing in this
directory calls Vonage, makes a call, sends an SMS, downloads a real
recording, or registers a webhook.

- `types.ts` — `NormalizedCallEvent`, the provider-neutral shape everything
  else in the app should depend on instead of a Vonage-specific payload.
- `normalize.ts` — `normalizeVonageCallEvent`, a pure function turning a raw
  (fixture-shaped, never real) Vonage-looking webhook payload into a
  `NormalizedCallEvent`, or explaining why it couldn't. **The raw payload
  shape here is written from Vonage's public API docs and has never been
  verified against a live payload** — treat field names as best-effort until
  a real sandbox event proves otherwise.
- `ingest.ts` — `ingestVonageCallEvent`, idempotent (by `Call.vonageCallId`)
  creation of an always-**unfiled** `Call` row from a normalized event. Never
  sets `matterId` — matter association stays a separate, authenticated step
  through the existing `attachCallToMatter` (`lib/matters/actions.ts`).
- `recording.ts` — `storeCallRecording`, the second half of the recording
  flow: given bytes a *future* adapter already fetched from Vonage, stores
  them through `DocumentStore` and records the resulting key on `Call`.
  Never fetches anything itself.
- `fixtures.ts` — fictional event payloads (inbound, outbound, completed
  with a recording reference, duplicate/retried, malformed, unsupported
  status) used by `tests/telephony/`.

`Call.vonageCallId` carries a `@unique` constraint (prisma/schema.prisma,
pre-integration hardening pass) — the database, not `ingestVonageCallEvent`'s
own `findFirst` pre-check, is the final authority on "has this external
call already been ingested." A genuine concurrent-delivery race that gets
past the pre-check fails the constraint on `create` and is resolved by
re-reading, never by surfacing a 500 or creating a duplicate row.

See `docs/INTEGRATION_ARCHITECTURE.md` for the full boundary write-up and
what's still needed for a real Vonage adapter.
