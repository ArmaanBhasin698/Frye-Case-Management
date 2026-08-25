"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { requireCurrentUser } from "@/lib/auth/session";
import { canManageClientsAndMatters } from "@/lib/auth/authorization";
import { createClientRecord, readClientFields } from "@/lib/clients/clientFields";
import { runHighLevelContactSync, type SyncRunResult } from "@/lib/intake/highlevelSync";
import { linkExternalContactToClient } from "@/lib/intake/linking";
import type { ActionResult } from "@/lib/matters/actions";

/**
 * Staff-facing review actions for `IntakeLead` (see prisma/schema.prisma and
 * lib/intake/README.md) — the deliberate, authenticated step between a
 * webhook creating a pending lead (lib/intake/ingest.ts) and a real Client
 * existing. Gated by the same `canManageClientsAndMatters` rule as
 * lib/clients/actions.ts#createClient — deciding "does this lead become a
 * client" is exactly that decision, just with intake data prefilled.
 *
 * Every action re-checks the lead is still `PENDING` before acting on it —
 * two staff members reviewing the same lead concurrently, or a page left
 * open after someone else already resolved it, must never double-link or
 * silently overwrite an already-settled outcome.
 */

const NOT_FOUND_ERROR = "Not found or access denied.";

async function requireReviewer() {
  const user = await requireCurrentUser();
  if (!canManageClientsAndMatters(user)) {
    return null;
  }
  return user;
}

async function requirePendingLead(intakeLeadId: string) {
  const lead = await prisma.intakeLead.findUnique({ where: { id: intakeLeadId } });
  if (!lead || lead.status !== "PENDING") {
    return null;
  }
  return lead;
}

export async function dismissIntakeLead(_prevState: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireReviewer();
  if (!user) {
    return { ok: false, error: NOT_FOUND_ERROR };
  }

  const intakeLeadId = String(formData.get("intakeLeadId") ?? "").trim();
  const lead = intakeLeadId ? await requirePendingLead(intakeLeadId) : null;
  if (!lead) {
    return { ok: false, error: NOT_FOUND_ERROR };
  }

  const dismissed = await prisma.intakeLead.updateMany({
    where: { id: lead.id, status: "PENDING" },
    data: { status: "DISMISSED", reviewedById: user.id, reviewedAt: new Date() },
  });
  if (dismissed.count === 0) {
    // Lost a race to another reviewer acting on the same lead between our
    // PENDING check above and this write — the conditional `status: "PENDING"`
    // in the where clause (not the earlier read) is the actual guarantee
    // that we never overwrite an outcome someone else just settled.
    return { ok: false, error: "This lead was already resolved by another reviewer." };
  }

  // Never the contact's name/email/phone — same restraint as
  // lib/intake/linking.ts and lib/intake/ingest.ts.
  await prisma.auditEvent.create({
    data: {
      actorId: user.id,
      action: "UPDATE",
      entityType: "IntakeLead",
      entityId: lead.id,
      metadata: { status: "DISMISSED" },
    },
  });

  revalidatePath("/intake");
  return { ok: true, data: undefined };
}

const linkExistingSchema = z.object({
  intakeLeadId: z.string().min(1, "Required."),
  clientId: z.string().min(1, "Required."),
});

export async function linkIntakeLeadToExistingClient(
  _prevState: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireReviewer();
  if (!user) {
    return { ok: false, error: NOT_FOUND_ERROR };
  }

  const parsed = linkExistingSchema.safeParse({
    intakeLeadId: formData.get("intakeLeadId"),
    clientId: formData.get("clientId"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { intakeLeadId, clientId } = parsed.data;

  const lead = await requirePendingLead(intakeLeadId);
  if (!lead) {
    return { ok: false, error: NOT_FOUND_ERROR };
  }

  const result = await linkExternalContactToClient({
    provider: lead.provider,
    externalId: lead.externalContactId,
    clientId,
    actorId: user.id,
  });

  if (result.outcome === "client_not_found") {
    return { ok: false, error: "That client id does not exist." };
  }
  if (result.outcome === "conflict_linked_to_different_client") {
    return { ok: false, error: "This external contact is already linked to a different client." };
  }

  const updated = await prisma.intakeLead.updateMany({
    where: { id: lead.id, status: "PENDING" },
    data: { status: "LINKED", linkedClientId: clientId, reviewedById: user.id, reviewedAt: new Date() },
  });
  if (updated.count === 0) {
    // Lost a race to another reviewer between our PENDING check and this
    // write. The ExternalLeadLink above is already durable and idempotent
    // regardless — only this lead's own status update needs the guard.
    return { ok: false, error: "This lead was already resolved by another reviewer." };
  }

  revalidatePath("/intake");
  revalidatePath(`/clients/${clientId}`);
  redirect(`/clients/${clientId}`);
}

export async function createClientFromIntakeLead(
  _prevState: { error: string | null },
  formData: FormData,
): Promise<{ error: string | null }> {
  const user = await requireReviewer();
  if (!user) {
    return { error: NOT_FOUND_ERROR };
  }

  const intakeLeadId = String(formData.get("intakeLeadId") ?? "").trim();
  const lead = intakeLeadId ? await requirePendingLead(intakeLeadId) : null;
  if (!lead) {
    return { error: NOT_FOUND_ERROR };
  }

  const parsed = readClientFields(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const client = await createClientRecord(parsed.data, user.id);

  const linkResult = await linkExternalContactToClient({
    provider: lead.provider,
    externalId: lead.externalContactId,
    clientId: client.id,
    actorId: user.id,
  });
  if (linkResult.outcome === "conflict_linked_to_different_client") {
    // Vanishingly unlikely (this contact was linked by someone else in the
    // instant between our PENDING check above and this call), but the new
    // Client we just created must not be silently orphaned from its own
    // intake lead — surface it rather than pretend this succeeded.
    return { error: "This external contact was just linked to a different client by another reviewer. The new client was still created; link it manually if needed." };
  }

  const updated = await prisma.intakeLead.updateMany({
    where: { id: lead.id, status: "PENDING" },
    data: { status: "LINKED", linkedClientId: client.id, reviewedById: user.id, reviewedAt: new Date() },
  });
  if (updated.count === 0) {
    // Lost a race to another reviewer between our PENDING check and this
    // write. The new Client and its link both already exist and are
    // real — only this lead's own status update needs the guard.
    return { error: "This lead was already resolved by another reviewer, but the new client was still created." };
  }

  revalidatePath("/intake");
  revalidatePath("/clients");
  redirect(`/clients/${client.id}`);
}

export type TriggerHighLevelSyncResult = { ok: true; result: SyncRunResult } | { ok: false; error: string };

/**
 * Manual "Sync from Loop" — calls the exact same `runHighLevelContactSync`
 * the scheduled cron entry point uses (see
 * app/api/cron/highlevel-sync/route.ts and lib/intake/highlevelSync.ts),
 * never a separate manual-only ingestion path. That function's own
 * internal lock (`HighLevelSyncState.runningSince`) is what actually
 * prevents an overlapping run — this action only adds the authorization
 * check appropriate to a staff-initiated trigger.
 */
export async function triggerHighLevelSync(): Promise<TriggerHighLevelSyncResult> {
  const user = await requireCurrentUser();
  if (!canManageClientsAndMatters(user)) {
    return { ok: false, error: NOT_FOUND_ERROR };
  }

  try {
    const result = await runHighLevelContactSync("manual", user.id);
    revalidatePath("/intake");
    return { ok: true, result };
  } catch {
    // Never the raw HighLevel/API error — see docs/SECURITY.md.
    return { ok: false, error: "Sync failed. Check server logs for details." };
  }
}
