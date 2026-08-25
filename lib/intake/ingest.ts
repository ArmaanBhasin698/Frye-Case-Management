import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { findClientIdByExternalContact } from "@/lib/intake/linking";
import { normalizeIntakeLead } from "@/lib/intake/normalize";

/**
 * Turns one raw HighLevel contact webhook payload into a durable
 * `IntakeLead` awaiting staff review, or explains why it didn't — the
 * webhook-side counterpart to lib/telephony/ingest.ts#ingestVonageCallEvent,
 * following the same shape: normalize first, never throw on a
 * malformed/incomplete payload (an expected, non-exceptional outcome), and
 * let the database's own unique constraint — not just this function's
 * pre-check — be the final word on "have we already seen this contact."
 *
 * If `ExternalLeadLink` already has a mapping for this external contact,
 * this is a no-op: the lead was already reviewed and linked, and a later
 * duplicate/updated delivery must never reopen a settled outcome or touch
 * `IntakeLead` at all. Otherwise, the (provider, externalContactId) pair is
 * the idempotency boundary for `IntakeLead` itself — a first-time delivery
 * creates one row; a repeated delivery for a still-`PENDING` lead refreshes
 * its contact fields (the person's info may have changed since); a repeated
 * delivery for an already-`LINKED`/`DISMISSED` lead is left untouched, since
 * staff already acted on it.
 */

const PROVIDER = "LOOP_HIGHLEVEL" as const;

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export type IngestIntakeResult =
  | { outcome: "already_linked"; clientId: string }
  | { outcome: "recorded"; intakeLeadId: string; created: boolean }
  | { outcome: "ignored"; reason: "malformed"; detail: string };

export async function ingestHighLevelContactEvent(rawEvent: unknown): Promise<IngestIntakeResult> {
  const normalized = normalizeIntakeLead(rawEvent);
  if (!normalized.ok) {
    return { outcome: "ignored", reason: normalized.reason, detail: normalized.detail };
  }
  const { lead } = normalized;

  const linkedClientId = await findClientIdByExternalContact(PROVIDER, lead.externalContactId);
  if (linkedClientId) {
    return { outcome: "already_linked", clientId: linkedClientId };
  }

  const existing = await prisma.intakeLead.findUnique({
    where: { provider_externalContactId: { provider: PROVIDER, externalContactId: lead.externalContactId } },
  });
  if (existing) {
    if (existing.status === "PENDING") {
      await prisma.intakeLead.update({
        where: { id: existing.id },
        data: {
          firstName: lead.firstName,
          lastName: lead.lastName,
          email: lead.email ?? null,
          phone: lead.phone ?? null,
          receivedAt: lead.receivedAt,
        },
      });
    }
    return { outcome: "recorded", intakeLeadId: existing.id, created: false };
  }

  let created;
  try {
    created = await prisma.intakeLead.create({
      data: {
        provider: PROVIDER,
        externalContactId: lead.externalContactId,
        firstName: lead.firstName,
        lastName: lead.lastName,
        email: lead.email ?? null,
        phone: lead.phone ?? null,
        receivedAt: lead.receivedAt,
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      // Lost a race: another delivery's create committed between our
      // fast-path read above and this write. Re-read rather than assume.
      const raced = await prisma.intakeLead.findUnique({
        where: { provider_externalContactId: { provider: PROVIDER, externalContactId: lead.externalContactId } },
      });
      if (raced) {
        return { outcome: "recorded", intakeLeadId: raced.id, created: false };
      }
      return { outcome: "ignored", reason: "malformed", detail: "Duplicate detected but the original row could not be re-read." };
    }
    throw error;
  }

  // Never the contact's name/email/phone in audit metadata — same
  // restraint as lib/intake/linking.ts and lib/telephony/ingest.ts.
  await prisma.auditEvent.create({
    data: {
      actorId: null,
      action: "CREATE",
      entityType: "IntakeLead",
      entityId: created.id,
      metadata: { provider: PROVIDER },
    },
  });

  return { outcome: "recorded", intakeLeadId: created.id, created: true };
}
