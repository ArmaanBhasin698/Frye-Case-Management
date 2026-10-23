import type { NotificationKind, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { getAssignedMatterIds, matterScopeFilterFor } from "@/lib/auth/access";
import { eventVisibilityFilterFor } from "@/lib/calendar/access";
import { isAdmin, type AuthorizableUser } from "@/lib/auth/authorization";
import { readableConversationIds } from "@/lib/chat/access";
import { NOTIFICATION_KIND_VALUES } from "@/lib/notifications/labels";

/**
 * Read side of the inbox. A notification is only listed, counted, or
 * linked if the recipient can *still* reach what it points at — matter
 * access for matter records, creator/attendee for internal events, active
 * membership for conversations. The scope is applied in the database query
 * (before counting and pagination), so revoked access silently drops the
 * notification from both the list and the unread badge.
 */

export type NotificationView = "unread" | "read" | "dismissed";

export function buildAccessibleNotificationFilter(input: {
  userId: string;
  admin: boolean;
  assignedMatterIds: string[];
  visibleInternalEventIds: string[];
  readableConversationIds: string[];
}): Prisma.NotificationWhereInput {
  return {
    userId: input.userId,
    OR: [
      input.admin ? { matterId: { not: null } } : { matterId: { in: input.assignedMatterIds } },
      { matterId: null, entityType: "CalendarEvent", entityId: { in: input.visibleInternalEventIds } },
      { matterId: null, entityType: "ChatConversation", entityId: { in: input.readableConversationIds } },
    ],
  };
}

export function viewFilter(view: NotificationView): Prisma.NotificationWhereInput {
  if (view === "dismissed") return { dismissedAt: { not: null } };
  if (view === "read") return { dismissedAt: null, readAt: { not: null } };
  return { dismissedAt: null, readAt: null };
}

export async function accessibleNotificationFilterFor(user: AuthorizableUser): Promise<Prisma.NotificationWhereInput> {
  const admin = isAdmin(user);
  const [assignedMatterIds, internalEvents, conversations] = await Promise.all([
    admin ? Promise.resolve([]) : getAssignedMatterIds(user.id),
    prisma.calendarEvent.findMany({
      where: admin ? { matterId: null } : { matterId: null, OR: [{ createdById: user.id }, { attendees: { some: { userId: user.id } } }] },
      select: { id: true },
    }),
    readableConversationIds(user),
  ]);
  return buildAccessibleNotificationFilter({
    userId: user.id,
    admin,
    assignedMatterIds,
    visibleInternalEventIds: internalEvents.map((e) => e.id),
    readableConversationIds: conversations,
  });
}

export async function countUnreadNotifications(user: AuthorizableUser): Promise<number> {
  const scope = await accessibleNotificationFilterFor(user);
  return prisma.notification.count({ where: { AND: [scope, viewFilter("unread")] } });
}

export function hrefFor(n: { entityType: string; entityId: string; matterId: string | null }): string {
  switch (n.entityType) {
    case "Task":
      return `/matters/${n.matterId}/tasks`;
    case "Deadline":
      return `/matters/${n.matterId}/deadlines`;
    case "CalendarEvent":
      return `/calendar/events/${n.entityId}`;
    case "ChatConversation":
      return `/chat/${n.entityId}`;
    default:
      return "/notifications";
  }
}

/**
 * Lists the user's notifications for one view. Display detail (the task or
 * event title, the matter case number) is resolved *now* from records the
 * user can still see — it is never stored in the notification itself.
 */
export async function listNotifications(user: AuthorizableUser, view: NotificationView, take = 100) {
  const scope = await accessibleNotificationFilterFor(user);
  const rows = await prisma.notification.findMany({
    where: { AND: [scope, viewFilter(view)] },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, kind: true, title: true, entityType: true, entityId: true, matterId: true, createdAt: true, readAt: true, dismissedAt: true },
  });

  // Details are fetched under the viewer's *current* scope (a record can
  // move matters after its notification was created).
  const idsOf = (type: string) => rows.filter((r) => r.entityType === type).map((r) => r.entityId);
  const [matterScope, eventScope] = await Promise.all([matterScopeFilterFor(user), eventVisibilityFilterFor(user)]);
  const [tasks, deadlines, events, matters] = await Promise.all([
    prisma.task.findMany({ where: { AND: [{ id: { in: idsOf("Task") } }, matterScope] }, select: { id: true, title: true } }),
    prisma.deadline.findMany({ where: { AND: [{ id: { in: idsOf("Deadline") } }, matterScope] }, select: { id: true, description: true } }),
    prisma.calendarEvent.findMany({ where: { AND: [{ id: { in: idsOf("CalendarEvent") } }, eventScope] }, select: { id: true, title: true } }),
    prisma.matter.findMany({
      where: { id: { in: [...new Set(rows.flatMap((r) => (r.matterId ? [r.matterId] : [])))] } },
      select: { id: true, caseNumber: true },
    }),
  ]);
  const detail = new Map<string, string>([
    ...tasks.map((t) => [t.id, t.title] as [string, string]),
    ...deadlines.map((d) => [d.id, d.description] as [string, string]),
    ...events.map((e) => [e.id, e.title] as [string, string]),
  ]);
  const caseNumbers = new Map(matters.map((m) => [m.id, m.caseNumber]));

  return rows.map((r) => ({
    ...r,
    detail: detail.get(r.entityId) ?? null,
    caseNumber: r.matterId ? (caseNumbers.get(r.matterId) ?? null) : null,
    href: hrefFor(r),
  }));
}

export async function getPreferences(userId: string): Promise<Record<NotificationKind, boolean>> {
  const rows = await prisma.notificationPreference.findMany({ where: { userId }, select: { kind: true, inApp: true } });
  const disabled = new Set(rows.filter((r) => !r.inApp).map((r) => r.kind));
  return Object.fromEntries(NOTIFICATION_KIND_VALUES.map((k) => [k, !disabled.has(k)])) as Record<NotificationKind, boolean>;
}
