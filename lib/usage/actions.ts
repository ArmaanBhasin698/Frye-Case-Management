"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { requireCurrentUser } from "@/lib/auth/session";
import { isAdmin } from "@/lib/auth/authorization";
import {
  isRetentionHoldActive,
  PURGE_CONFIRMATION_PHRASE,
  purgeExpiredUsage,
  USAGE_RETENTION_DAYS,
} from "@/lib/usage/retention";

export type PurgeState = { error: string | null; message: string | null };

/**
 * ADMIN-only, explicitly confirmed purge of usage analytics older than the
 * retention window. Refused while a preservation hold is active. Records an
 * AuditEvent with the row counts (never row contents).
 */
export async function purgeUsageData(_prev: PurgeState, formData: FormData): Promise<PurgeState> {
  const user = await requireCurrentUser();
  if (!isAdmin(user)) return { error: "Not found or access denied.", message: null };

  if (isRetentionHoldActive()) {
    return { error: "A preservation hold (USAGE_RETENTION_HOLD) is active — purging is disabled.", message: null };
  }
  if (String(formData.get("confirm") ?? "").trim() !== PURGE_CONFIRMATION_PHRASE) {
    return { error: `Type "${PURGE_CONFIRMATION_PHRASE}" to confirm.`, message: null };
  }

  const result = await purgeExpiredUsage();
  await prisma.auditEvent.create({
    data: {
      actorId: user.id,
      action: "DELETE",
      entityType: "UsageRetention",
      entityId: "usage-analytics",
      metadata: {
        retentionDays: USAGE_RETENTION_DAYS,
        cutoff: result.cutoff.toISOString(),
        events: result.events,
        minutes: result.minutes,
        sessions: result.sessions,
      },
    },
  });

  revalidatePath("/admin/usage");
  return {
    error: null,
    message: `Purged ${result.events} events, ${result.minutes} activity minutes, and ${result.sessions} ended sessions older than ${result.cutoff.toISOString().slice(0, 10)}.`,
  };
}
