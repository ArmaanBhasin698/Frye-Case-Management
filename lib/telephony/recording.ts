import { prisma } from "@/lib/db";
import { documentStore, DocumentAlreadyExistsError } from "@/lib/storage/DocumentStore";

/**
 * Second half of the recording flow, deliberately separate from
 * lib/telephony/ingest.ts: ingesting a call event only ever learns *that*
 * a recording exists and an opaque pointer to fetch it
 * (`NormalizedCallEvent.recordingRef`) — actually fetching the audio bytes
 * from Vonage is provider-specific and belongs to the future Vonage
 * adapter, not this codebase today (see the STARTUP instruction: never
 * call Vonage, never download a real recording). This function models
 * everything *after* that fetch: given bytes the adapter already
 * retrieved, store them through the provider-agnostic `DocumentStore` and
 * record where they landed.
 *
 * Storage key is call-scoped (`calls/<callId>/recording`), not
 * matter-scoped, because a `Call` can be (and often initially is) unfiled
 * — unlike a general `Document`, which is always created already attached
 * to a matter. Once the call is later filed to a matter
 * (`attachCallToMatter`), the recording becomes reachable "through" that
 * matter via `Call.matterId`, without needing to move or copy any bytes —
 * the same relationship a `Document` row has to its matter, just without
 * baking `matterId` into the storage key for a record that might not have
 * one yet.
 *
 * `Call.recordingDropboxPath` stores this function's own DocumentStore
 * key, not the provider's `recordingRef` — never a raw external URL,
 * regardless of which storage backend is active (the column name predates
 * the provider-agnostic `DocumentStore` and is not renamed here; a rename
 * would be a schema change out of scope for this pass).
 */

export type StoreCallRecordingResult =
  | { outcome: "stored"; storageKey: string }
  | { outcome: "already_stored"; storageKey: string }
  | { outcome: "call_not_found" };

export async function storeCallRecording(callId: string, audioBytes: Buffer): Promise<StoreCallRecordingResult> {
  const call = await prisma.call.findUnique({
    where: { id: callId },
    select: { recordingDropboxPath: true, matterId: true },
  });
  if (!call) {
    return { outcome: "call_not_found" };
  }
  if (call.recordingDropboxPath) {
    return { outcome: "already_stored", storageKey: call.recordingDropboxPath };
  }

  const storageKey = `calls/${callId}/recording`;
  try {
    await documentStore.save(storageKey, audioBytes);
  } catch (error) {
    if (error instanceof DocumentAlreadyExistsError) {
      // A concurrent delivery already stored it — not our own DB update's
      // job to fail over that; treat it as already-stored the same as the
      // `call.recordingDropboxPath` check above would have caught with
      // better timing.
      return { outcome: "already_stored", storageKey };
    }
    throw error;
  }

  await prisma.call.update({ where: { id: callId }, data: { recordingDropboxPath: storageKey } });

  // Never the audio bytes or the provider's recordingRef URL — just that a
  // recording now exists for this call (same restraint as every other
  // audit event touching Call, see lib/matters/actions.ts#createCall).
  await prisma.auditEvent.create({
    data: {
      actorId: null,
      action: "UPDATE",
      entityType: "Call",
      entityId: callId,
      matterId: call.matterId,
      metadata: { field: "recordingDropboxPath", event: "recording_stored" },
    },
  });

  return { outcome: "stored", storageKey };
}
