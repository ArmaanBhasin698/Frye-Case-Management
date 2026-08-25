import { prisma } from "@/lib/db";
import { SYNC_STATE_ID } from "@/lib/intake/highlevelSync";

/**
 * Data-access functions for the intake-review vertical slice. Every caller
 * here is a page or Server Action already gated by
 * `canManageClientsAndMatters`/`assertCanManageClientsAndMatters` — deciding
 * whether an intake lead becomes a Client is the same authority as creating
 * one directly (see lib/clients/queries.ts's identical framing).
 */

export function listPendingIntakeLeads() {
  return prisma.intakeLead.findMany({
    where: { status: "PENDING" },
    orderBy: { receivedAt: "asc" },
  });
}

export function getIntakeLeadById(intakeLeadId: string) {
  return prisma.intakeLead.findUnique({ where: { id: intakeLeadId } });
}

/** Persisted, shared-across-users HighLevel sync state for the "Last synced" display — see lib/intake/highlevelSync.ts. Never null-checked away: no row yet means "never synced." */
export function getHighLevelSyncState() {
  return prisma.highLevelSyncState.findUnique({ where: { id: SYNC_STATE_ID } });
}
