import type { CustomFieldEntity } from "@prisma/client";

import { prisma } from "@/lib/db";
import { canEditMatter } from "@/lib/auth/access";
import { canManageClientsAndMatters, type AuthorizableUser } from "@/lib/auth/authorization";
import { canViewContact } from "@/lib/contacts/visibility";

/**
 * Whether `user` may edit custom-field values on a record — mirrors that
 * record's own edit rule: MATTER → canEditMatter (ADMIN, or an ATTORNEY on
 * the matter); CONTACT → canViewContact (same rule as updateContact);
 * CLIENT → canManageClientsAndMatters (ADMIN/ATTORNEY) and the client
 * exists. Kept out of the "use server" actions file so it is never
 * directly network-callable.
 */
export async function canEditCustomValues(user: AuthorizableUser, entity: CustomFieldEntity, ownerId: string): Promise<boolean> {
  if (entity === "MATTER") return canEditMatter(user, ownerId);
  if (entity === "CONTACT") return canViewContact(user, ownerId);
  if (!canManageClientsAndMatters(user)) return false;
  return (await prisma.client.count({ where: { id: ownerId } })) > 0;
}

