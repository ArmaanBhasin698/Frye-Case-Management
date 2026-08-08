import { notFound } from "next/navigation";

import { prisma } from "@/lib/db";
import { buildMatterIdFilter, buildMatterScopeFilter, canAccessMatter, isAdmin } from "@/lib/auth/authorization";
import type { AuthorizableUser } from "@/lib/auth/authorization";

/** Matter ids `user` is assigned to. Meaningless (and unused) for admins. */
export async function getAssignedMatterIds(userId: string): Promise<string[]> {
  const rows = await prisma.matterAssignment.findMany({
    where: { userId },
    select: { matterId: true },
  });
  return rows.map((row) => row.matterId);
}

/** `where` fragment for a Matter query, scoped to what `user` may see. */
export async function matterIdFilterFor(user: AuthorizableUser) {
  if (isAdmin(user)) return buildMatterIdFilter(user, []);
  const assignedMatterIds = await getAssignedMatterIds(user.id);
  return buildMatterIdFilter(user, assignedMatterIds);
}

/** `where` fragment for a `matterId`-column query, scoped to what `user` may see. */
export async function matterScopeFilterFor(user: AuthorizableUser) {
  if (isAdmin(user)) return buildMatterScopeFilter(user, []);
  const assignedMatterIds = await getAssignedMatterIds(user.id);
  return buildMatterScopeFilter(user, assignedMatterIds);
}

/**
 * Enforces matter-level authorization for a single matter (see CLAUDE.md,
 * section 4.4). Renders the standard Next.js not-found page rather than an
 * "access denied" message so an unauthorized user can't distinguish "this
 * matter doesn't exist" from "you can't see this matter."
 */
export async function assertMatterAccess(user: AuthorizableUser, matterId: string): Promise<void> {
  if (isAdmin(user)) return;
  const assignedMatterIds = await getAssignedMatterIds(user.id);
  if (!canAccessMatter(user, assignedMatterIds, matterId)) {
    notFound();
  }
}
