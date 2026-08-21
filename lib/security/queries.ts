import { prisma } from "@/lib/db";

/**
 * Read-only incident list for the admin security page
 * (app/(dashboard)/admin/security). Callers must have already enforced
 * `assertIsAdmin` on the current session (see CLAUDE.md, section 4.4) —
 * this mirrors lib/admin/users/queries.ts, which trusts the page-level
 * assert rather than re-checking here.
 */
export type AdminSecurityIncidentSummary = {
  id: string;
  category: "SUSPICIOUS_LOGIN";
  severity: "LOW" | "MEDIUM" | "HIGH";
  status: "OPEN" | "INVESTIGATING" | "RESOLVED" | "FALSE_POSITIVE";
  failedAttemptCount: number;
  windowStart: Date;
  windowEnd: Date;
  detectedAt: Date;
  updatedAt: Date;
  notes: string | null;
  account: { id: string; name: string; email: string } | null;
};

export async function listSecurityIncidentsForAdmin(): Promise<AdminSecurityIncidentSummary[]> {
  return prisma.securityIncident.findMany({
    select: {
      id: true,
      category: true,
      severity: true,
      status: true,
      failedAttemptCount: true,
      windowStart: true,
      windowEnd: true,
      detectedAt: true,
      updatedAt: true,
      notes: true,
      account: { select: { id: true, name: true, email: true } },
    },
    orderBy: { detectedAt: "desc" },
  });
}
