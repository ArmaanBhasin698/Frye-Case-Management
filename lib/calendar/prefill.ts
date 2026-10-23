import { prisma } from "@/lib/db";
import { matterIdFilterFor } from "@/lib/auth/access";
import type { AuthorizableUser } from "@/lib/auth/authorization";
import { canViewContact } from "@/lib/contacts/visibility";

/**
 * "Schedule with this contact" prefill for /calendar/events/new?contactId=…
 * A contact the user can't see is ignored silently (indistinguishable from
 * an unknown id). For a visible contact, returns the matters the user can
 * access that actively link it (MatterContact, or the contact's own client
 * matters); the form preselects one only when there's exactly one.
 */
export async function resolveContactPrefill(
  user: AuthorizableUser,
  contactId: string | undefined,
): Promise<{ contact: { id: string; displayName: string } | null; matterIds: string[] }> {
  if (!contactId || contactId.length > 100 || !(await canViewContact(user, contactId))) {
    return { contact: null, matterIds: [] };
  }
  const [contact, matterWhere] = await Promise.all([
    prisma.contact.findUnique({ where: { id: contactId }, select: { id: true, displayName: true, archived: true } }),
    matterIdFilterFor(user),
  ]);
  if (!contact || contact.archived) return { contact: null, matterIds: [] };
  const matters = await prisma.matter.findMany({
    where: {
      AND: [
        matterWhere,
        { archived: false },
        {
          OR: [
            { contactLinks: { some: { contactId, removedAt: null } } },
            { client: { contact: { id: contactId } } },
          ],
        },
      ],
    },
    select: { id: true },
  });
  return { contact: { id: contact.id, displayName: contact.displayName }, matterIds: matters.map((m) => m.id) };
}

/** Link target for a "Schedule meeting" button on a contact (optionally on a specific matter). */
export function scheduleWithContactHref(contactId: string, matterId?: string): string {
  const params = new URLSearchParams({ contactId });
  if (matterId) params.set("matterId", matterId);
  return `/calendar/events/new?${params.toString()}`;
}
