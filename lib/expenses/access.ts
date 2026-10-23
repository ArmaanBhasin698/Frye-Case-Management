import { prisma } from "@/lib/db";
import { isAdmin, type AuthorizableUser } from "@/lib/auth/authorization";

/**
 * Expense amount visibility (owner decision, docs/MYCASE_PARITY_SCHEMA_PROPOSAL.md):
 * ADMIN, or an ATTORNEY assigned to that matter. Everyone else with matter
 * access may record expenses and see non-monetary fields only — amounts
 * are omitted from server output for them, not hidden with CSS.
 */
export function canSeeAmountsFrom(user: AuthorizableUser, isAssignedToMatter: boolean): boolean {
  return isAdmin(user) || (user.role === "ATTORNEY" && isAssignedToMatter);
}

export async function canSeeExpenseAmounts(user: AuthorizableUser, matterId: string): Promise<boolean> {
  if (isAdmin(user)) return true;
  if (user.role !== "ATTORNEY") return false;
  const assignment = await prisma.matterAssignment.count({ where: { matterId, userId: user.id } });
  return canSeeAmountsFrom(user, assignment > 0);
}

/** Matter ids whose amounts `user` may see; `null` means all (ADMIN). */
export async function amountVisibleMatterIds(user: AuthorizableUser): Promise<Set<string> | null> {
  if (isAdmin(user)) return null;
  if (user.role !== "ATTORNEY") return new Set();
  const rows = await prisma.matterAssignment.findMany({ where: { userId: user.id }, select: { matterId: true } });
  return new Set(rows.map((r) => r.matterId));
}
