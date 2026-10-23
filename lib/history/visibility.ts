import type { Prisma } from "@prisma/client";

import { isAdmin, type AuthorizableUser } from "@/lib/auth/authorization";

/**
 * Professional-history visibility (docs/SECURITY.md, "Professional
 * history"). Pure, so the rules are unit-testable without a database.
 *
 * - Rulings are matter records: visible only on matters the viewer can
 *   access (owner decision — no anonymized cross-matter summaries).
 * - Observations: MATTER_ONLY follow matter access; FIRM_ATTORNEYS
 *   reference notes (which never carry a matter) are visible to
 *   ADMIN/ATTORNEY. Callers must additionally have already authorized the
 *   subject contact itself (lib/contacts/visibility.ts).
 */

export function canAuthorProfessionalHistory(user: AuthorizableUser): boolean {
  return isAdmin(user) || user.role === "ATTORNEY";
}

export function buildRulingFilter(user: AuthorizableUser, assignedMatterIds: string[]): Prisma.JudicialRulingWhereInput {
  if (isAdmin(user)) return {};
  return { matterId: { in: assignedMatterIds } };
}

export function buildObservationFilter(
  user: AuthorizableUser,
  assignedMatterIds: string[],
): Prisma.ProfessionalObservationWhereInput {
  if (isAdmin(user)) return {};
  const matterScoped: Prisma.ProfessionalObservationWhereInput = {
    shareScope: "MATTER_ONLY",
    matterId: { in: assignedMatterIds },
  };
  if (user.role === "ATTORNEY") {
    return { OR: [matterScoped, { shareScope: "FIRM_ATTORNEYS", matterId: null }] };
  }
  return matterScoped;
}

export function buildClosureReportFilter(
  user: AuthorizableUser,
  assignedMatterIds: string[],
): Prisma.MatterClosureReportWhereInput {
  if (isAdmin(user)) return {};
  return { matterId: { in: assignedMatterIds } };
}
