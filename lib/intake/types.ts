/**
 * Provider-neutral shape of an intake lead, once normalized from a raw
 * Loop/HighLevel-shaped webhook payload. Nothing outside
 * lib/intake/normalize.ts should ever branch on a HighLevel-specific field
 * name — see docs/INTEGRATION_ARCHITECTURE.md.
 *
 * Deliberately narrow: only the fields that map onto something
 * `Client` (prisma/schema.prisma) already has a place for. `externalContactId`
 * and `receivedAt` are carried through for logging/investigation purposes
 * only — see lib/intake/README.md for why they are NOT currently a
 * reliable idempotency key (no persistent place to store them yet).
 */
export type NormalizedIntakeLead = {
  externalContactId: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  receivedAt: Date;
};

export type NormalizeIntakeResult =
  | { ok: true; lead: NormalizedIntakeLead }
  | { ok: false; reason: "malformed"; detail: string };
