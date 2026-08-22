# lib/intake

Pre-integration scaffolding for the eventual Loop/HighLevel intake
integration. **No Loop/HighLevel code exists here**: nothing in this
directory calls Loop/HighLevel, registers a webhook, or creates a `Client`
automatically.

- `types.ts` — `NormalizedIntakeLead`, the provider-neutral shape.
- `normalize.ts` — `normalizeIntakeLead`, a pure function turning a raw
  (fixture-shaped, never real) Loop/HighLevel-looking webhook payload into
  a `NormalizedIntakeLead`, or explaining why it couldn't. **Written from
  HighLevel's public webhook docs, never verified against a live
  payload.**
- `mapToClientFields.ts` — `mapIntakeLeadToClientFields`, a pure function
  mapping a normalized lead onto exactly the field shape
  `lib/clients/actions.ts#createClient` accepts. Does **not** call
  `createClient` itself.
- `linking.ts` — `findClientIdByExternalContact` /
  `linkExternalContactToClient`, the durable persistence layer described
  below (`ExternalLeadLink`). This is the piece that makes repeated
  webhook deliveries safe.
- `fixtures.ts` — fictional payloads (new lead, updated lead,
  duplicate/retried, incomplete, malformed) used by `tests/intake/`.

## Durable external-identity mapping (`ExternalLeadLink`)

As of the pre-integration hardening pass, `prisma/schema.prisma` has a
dedicated `ExternalLeadLink` model — `{ provider, externalId, clientId }`,
unique on `(provider, externalId)` — mapping one external contact to one
Frye `Client`. This is a **separate model, not a `Client.externalIntakeId`
column**, chosen specifically so:

- `Client` stays provider-agnostic; nothing about its own columns implies
  "this came from HighLevel."
- A second intake provider can be added later with **zero** change to
  `Client` — just a new `ExternalLeadProvider` enum value and new
  `ExternalLeadLink` rows.
- Duplicate mappings are prevented **at the database level**
  (`@@unique([provider, externalId])`), not just by an application-level
  check — see `linking.ts#linkExternalContactToClient` for exactly how a
  genuine concurrent-delivery race is resolved rather than allowed to
  create two links or corrupt state.

**Idempotency guarantee:** given the same `(provider, externalId)` pair,
`findClientIdByExternalContact` always returns the same `clientId` once a
link exists, and `linkExternalContactToClient` never creates a second link
for it — a retried/duplicated webhook delivery is a safe no-op
(`already_linked_to_same_client`), and an attempt to point the same
external contact at a *different* Client is surfaced as
`conflict_linked_to_different_client` rather than silently overwritten.

## Why there's still no automatic write path (by design, not a gap)

The schema gap that used to block this is closed, but **no code
automatically creates a `Client` from a webhook, and none is added by this
pass** — that's a deliberate, separate decision from "can this be done
safely," which this pass only answers "yes, now." CLAUDE.md §1 is explicit
that this system "starts at the 'client is retained' stage," and the
intended flow remains **staff-reviewed**: a future adapter receives the
webhook, normalizes it, checks `findClientIdByExternalContact` first (so a
resent delivery for an already-linked contact is recognized immediately),
and — only for a genuinely new contact — presents the mapped fields to a
staff member to deliberately create through the existing, authenticated
`createClient` action, then calls `linkExternalContactToClient` to persist
the mapping. If the firm later wants fully automatic Client creation from
intake with no staff review step, that is a separate product decision to
make explicitly, not something to default into now that the persistence
layer exists.

See `docs/INTEGRATION_ARCHITECTURE.md` for the full write-up.
