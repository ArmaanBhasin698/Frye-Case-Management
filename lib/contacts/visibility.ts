import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { getAssignedMatterIds } from "@/lib/auth/access";
import { isAdmin, type AuthorizableUser } from "@/lib/auth/authorization";

/**
 * Contact visibility — strictly matter-derived (decided in
 * docs/FIRM_OPERATIONS_EXPANSION.md, section 4.1). A Contact is visible to:
 *  - ADMIN (every contact, same as every matter);
 *  - the user who created it (so a contact entered before it's linked to
 *    any matter doesn't vanish from its own author);
 *  - anyone who can access a matter the contact is *actively* linked to —
 *    a non-removed MatterContact row, or, for a client's directory entry,
 *    one of that Client's own matters.
 * There is deliberately no firm-wide tier: even a judge's record is only
 * visible through a matter, because the fact that the firm has a contact
 * on file can itself reveal confidential representation.
 *
 * Every Contact read in lib/contacts/ composes this filter with `AND` —
 * there is no unscoped contact query reachable from a non-admin session.
 */
export function buildContactVisibilityFilter(
  user: AuthorizableUser,
  assignedMatterIds: string[],
): Prisma.ContactWhereInput {
  if (isAdmin(user)) return {};
  return {
    OR: [
      { createdById: user.id },
      { matterLinks: { some: { removedAt: null, matterId: { in: assignedMatterIds } } } },
      { client: { matters: { some: { id: { in: assignedMatterIds } } } } },
    ],
  };
}

export async function contactVisibilityFilterFor(user: AuthorizableUser): Promise<Prisma.ContactWhereInput> {
  if (isAdmin(user)) return {};
  return buildContactVisibilityFilter(user, await getAssignedMatterIds(user.id));
}

/**
 * Boolean form for Server Actions. Returns false for a nonexistent id as
 * well as an invisible one, so callers can give one generic "not found"
 * answer for both.
 */
export async function canViewContact(user: AuthorizableUser, contactId: string): Promise<boolean> {
  const visibility = await contactVisibilityFilterFor(user);
  const count = await prisma.contact.count({ where: { AND: [{ id: contactId }, visibility] } });
  return count > 0;
}
