import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { normalizeVonageCallEvent } from "@/lib/telephony/normalize";

/**
 * Turns one raw provider webhook payload into a `Call` row, or explains
 * why it didn't. This function has no notion of an authenticated user —
 * a webhook delivery isn't a staff session — so every `Call` it creates
 * is always unfiled (`matterId: null`, `filedById: null`, `filedAt: null`),
 * exactly like a manually-logged call nobody has filed yet. Associating a
 * call with a matter stays a separate, authenticated step through the
 * existing `attachCallToMatter` (lib/matters/actions.ts) — this function
 * deliberately never accepts or infers a `matterId` from the event itself,
 * so a compromised/forged webhook payload can never claim membership in a
 * matter it has no business knowing exists.
 *
 * Idempotent by `Call.vonageCallId`, which now carries a `@unique`
 * constraint (prisma/schema.prisma) — the database, not this function's
 * own pre-check, is the final authority. The `findFirst` below is a fast
 * path that avoids an unnecessary insert attempt on the overwhelmingly
 * common case (no duplicate yet); if two deliveries of the same event
 * genuinely race past that check concurrently, the loser's `create` fails
 * the unique constraint (Postgres error `P2002`) instead of creating a
 * second row, and that failure is caught below and resolved by re-reading
 * the now-existing row — the exact same `{outcome: "duplicate", ...}`
 * result the fast path would have returned with better timing. Nothing
 * about this can surface as an unhandled 500.
 */

function isForeignKeyConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003";
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Shared by both the fast-path duplicate check and the post-race re-read, so the two can never drift on what "duplicate" means. */
function toDuplicateResult(
  existing: { id: string; recordingDropboxPath: string | null },
  recordingRef: string | undefined,
): IngestCallEventResult {
  const pendingRecordingRef = recordingRef && !existing.recordingDropboxPath ? recordingRef : undefined;
  return { outcome: "duplicate", callId: existing.id, recordingRef: pendingRecordingRef };
}

export type IngestCallEventResult =
  | { outcome: "created"; callId: string; recordingRef?: string }
  | { outcome: "duplicate"; callId: string; recordingRef?: string }
  | { outcome: "ignored"; reason: "unsupported_status" | "malformed"; detail: string };

export async function ingestVonageCallEvent(rawEvent: unknown): Promise<IngestCallEventResult> {
  const normalized = normalizeVonageCallEvent(rawEvent);
  if (!normalized.ok) {
    return { outcome: "ignored", reason: normalized.reason, detail: normalized.detail };
  }
  const { event } = normalized;

  const existing = await prisma.call.findFirst({
    where: { vonageCallId: event.externalCallId },
    select: { id: true, recordingDropboxPath: true },
  });

  if (existing) {
    // Never re-derives duration/contact/direction fields from a later
    // duplicate delivery, and never touches matterId/filedById/filedAt
    // (this function never sets those in the first place) — a replayed
    // event can't mutate an already-settled record.
    return toDuplicateResult(existing, event.recordingRef);
  }

  let call;
  try {
    call = await prisma.call.create({
      data: {
        matterId: null,
        contactName: event.contactName ?? null,
        vonageCallId: event.externalCallId,
        direction: event.direction,
        fromNumber: event.fromNumber,
        toNumber: event.toNumber,
        occurredAt: event.occurredAt,
        durationSeconds: event.durationSeconds,
        filedById: null,
        filedAt: null,
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      // Lost the race described in the module comment above: another
      // delivery's create committed between our fast-path read and this
      // write. Re-read rather than assume anything about what landed.
      const raced = await prisma.call.findFirst({
        where: { vonageCallId: event.externalCallId },
        select: { id: true, recordingDropboxPath: true },
      });
      if (raced) {
        return toDuplicateResult(raced, event.recordingRef);
      }
      // Vanishingly unlikely (the row that just violated our unique
      // constraint would have to be deleted before we re-read it — Calls
      // are never deleted anywhere in this app), but never surface a
      // 500 for it regardless.
      return { outcome: "ignored", reason: "malformed", detail: "Duplicate detected but the original row could not be re-read." };
    }
    if (isForeignKeyConstraintError(error)) {
      return { outcome: "ignored", reason: "malformed", detail: "Referenced a record that does not exist." };
    }
    throw error;
  }

  // Minimal, non-sensitive metadata — no actor (no authenticated session
  // originated this write; see the module comment above), same restraint
  // on phone numbers/notes that lib/matters/actions.ts#createCall already
  // applies (never the raw numbers in metadata).
  await prisma.auditEvent.create({
    data: {
      actorId: null,
      action: "CREATE",
      entityType: "Call",
      entityId: call.id,
      matterId: null,
      metadata: { source: "vonage_webhook", direction: event.direction, filed: false },
    },
  });

  return { outcome: "created", callId: call.id, recordingRef: event.recordingRef };
}
