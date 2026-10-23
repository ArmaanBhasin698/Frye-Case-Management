import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { getAssignedMatterIds } from "@/lib/auth/access";
import { isAdmin, type AuthorizableUser } from "@/lib/auth/authorization";

/**
 * CalendarEvent visibility. A matter-linked event follows the matter's
 * existing access rule (ADMIN, or assigned to the matter) — being an
 * attendee does NOT bypass matter access. A matterless (internal) event is
 * visible to ADMIN, its creator, and its staff attendees only. Every
 * calendar read ANDs this filter; every calendar write re-checks it.
 */
export function buildEventVisibilityFilter(
  user: AuthorizableUser,
  assignedMatterIds: string[],
): Prisma.CalendarEventWhereInput {
  if (isAdmin(user)) return {};
  return {
    OR: [
      { matterId: { in: assignedMatterIds } },
      {
        matterId: null,
        OR: [{ createdById: user.id }, { attendees: { some: { userId: user.id } } }],
      },
    ],
  };
}

export async function eventVisibilityFilterFor(user: AuthorizableUser): Promise<Prisma.CalendarEventWhereInput> {
  if (isAdmin(user)) return {};
  return buildEventVisibilityFilter(user, await getAssignedMatterIds(user.id));
}

/** Whether `user` may see (and therefore edit or cancel) the event. False for nonexistent ids too. */
export async function canAccessEvent(user: AuthorizableUser, eventId: string): Promise<boolean> {
  const visibility = await eventVisibilityFilterFor(user);
  const count = await prisma.calendarEvent.count({ where: { AND: [{ id: eventId }, visibility] } });
  return count > 0;
}
