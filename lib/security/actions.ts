"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { requireCurrentUser } from "@/lib/auth/session";
import { isAdmin } from "@/lib/auth/authorization";

/**
 * ADMIN-only security-incident triage: the only way a SecurityIncident's
 * `status` ever changes. Independently re-checks `isAdmin()` rather than
 * trusting a page already did (see CLAUDE.md, section 4.4 — Server Actions
 * are directly invokable). Every transition is audited with non-sensitive
 * metadata only (old/new status, which incident) — never the account's
 * email or any attempted credential.
 */

const ACCESS_DENIED = "Not found or access denied.";

const STATUS_VALUES = ["OPEN", "INVESTIGATING", "RESOLVED", "FALSE_POSITIVE"] as const;
type IncidentStatus = (typeof STATUS_VALUES)[number];

/** Forward-only lifecycle: Open -> Investigating -> Resolved | False Positive. Terminal states don't reopen here. */
const ALLOWED_TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  OPEN: ["INVESTIGATING", "FALSE_POSITIVE"],
  INVESTIGATING: ["RESOLVED", "FALSE_POSITIVE"],
  RESOLVED: [],
  FALSE_POSITIVE: [],
};

const updateStatusSchema = z.object({
  incidentId: z.string().trim().min(1),
  nextStatus: z.enum(STATUS_VALUES),
});

export async function updateSecurityIncidentStatus(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const admin = await requireCurrentUser();
  if (!isAdmin(admin)) return ACCESS_DENIED;

  const parsed = updateStatusSchema.safeParse({
    incidentId: formData.get("incidentId"),
    nextStatus: formData.get("nextStatus"),
  });
  if (!parsed.success) return "Invalid request.";
  const { incidentId, nextStatus } = parsed.data;

  const incident = await prisma.securityIncident.findUnique({ where: { id: incidentId } });
  if (!incident) return ACCESS_DENIED;

  if (!ALLOWED_TRANSITIONS[incident.status].includes(nextStatus)) {
    return `Cannot move an incident from ${incident.status} to ${nextStatus}.`;
  }

  await prisma.securityIncident.update({ where: { id: incidentId }, data: { status: nextStatus } });
  await prisma.auditEvent.create({
    data: {
      actorId: admin.id,
      action: "UPDATE",
      entityType: "SecurityIncident",
      entityId: incidentId,
      metadata: { field: "status", from: incident.status, to: nextStatus },
    },
  });

  revalidatePath("/admin/security");
}
