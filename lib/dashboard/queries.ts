import type { CalendarEventType, DeadlineType } from "@prisma/client";

import { prisma } from "@/lib/db";
import { matterIdFilterFor, matterScopeFilterFor } from "@/lib/auth/access";
import type { AuthorizableUser } from "@/lib/auth/authorization";
import { getCallVisibilityFilter } from "@/lib/communications/queries";
import { asCalendarDate, todayAsStoredDate } from "@/lib/matters/format";

/**
 * Cross-matter aggregate reads for the firm-wide dashboard home page.
 *
 * Every function here takes the current user and scopes its results to
 * matters they're allowed to see (see CLAUDE.md, section 4.4): admins get
 * everything, everyone else only what they're assigned to. Unfiled calls
 * (`matterId: null`) are the one exception — matter-level authorization
 * doesn't apply to them since they aren't attached to any matter, but
 * they're still not firm-wide-visible: only ADMIN/ATTORNEY may see them
 * (same rule as the Communications page and `attachCallToMatter` — see
 * lib/communications/queries.ts#getCallVisibilityFilter, reused here rather
 * than re-derived so this can't drift from that rule again).
 */

export async function getDashboardStats(user: AuthorizableUser) {
  const now = new Date();
  const [matterWhere, scopeWhere, callVisibility] = await Promise.all([
    matterIdFilterFor(user),
    matterScopeFilterFor(user),
    getCallVisibilityFilter(user),
  ]);

  const [activeMatters, openTasks, upcomingDeadlines, upcomingCourtDates, unfiledCalls] =
    await Promise.all([
      prisma.matter.count({ where: { ...matterWhere, status: { in: ["OPEN", "PENDING"] } } }),
      prisma.task.count({ where: { ...scopeWhere, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
      prisma.deadline.count({ where: { ...scopeWhere, satisfied: false, date: { gte: todayAsStoredDate() } } }),
      prisma.calendarEvent.count({ where: { ...scopeWhere, startTime: { gte: now } } }),
      callVisibility.mayViewUnfiled ? prisma.call.count({ where: { matterId: null } }) : 0,
    ]);

  return { activeMatters, openTasks, upcomingDeadlines, upcomingCourtDates, unfiledCalls };
}

export async function getActiveMatters(user: AuthorizableUser, limit = 5) {
  const where = await matterIdFilterFor(user);
  return prisma.matter.findMany({
    where: { ...where, status: { in: ["OPEN", "PENDING"] } },
    include: { client: true, assignments: { include: { user: true } } },
    orderBy: { openedDate: "desc" },
    take: limit,
  });
}

export type UpcomingKeyDate =
  | {
      kind: "deadline";
      id: string;
      date: Date;
      title: string;
      deadlineType: DeadlineType;
      matter: { id: string; caseNumber: string; client: { firstName: string; lastName: string } };
    }
  | {
      kind: "event";
      id: string;
      date: Date;
      title: string;
      eventType: CalendarEventType;
      location: string | null;
      matter: { id: string; caseNumber: string; client: { firstName: string; lastName: string } };
    };

/** Merges Deadlines and CalendarEvents into one chronological "what's next" list. */
export async function getUpcomingKeyDates(user: AuthorizableUser, limit = 6): Promise<UpcomingKeyDate[]> {
  const now = new Date();
  const scopeWhere = await matterScopeFilterFor(user);

  const [deadlines, events] = await Promise.all([
    prisma.deadline.findMany({
      where: { ...scopeWhere, satisfied: false, date: { gte: todayAsStoredDate() } },
      include: { matter: { include: { client: true } } },
      orderBy: { date: "asc" },
      take: limit,
    }),
    prisma.calendarEvent.findMany({
      where: { ...scopeWhere, startTime: { gte: now } },
      include: { matter: { include: { client: true } } },
      orderBy: { startTime: "asc" },
      take: limit,
    }),
  ]);

  const merged: UpcomingKeyDate[] = [
    ...deadlines.map((d) => ({
      kind: "deadline" as const,
      id: d.id,
      date: asCalendarDate(d.date),
      title: d.description,
      deadlineType: d.type,
      matter: d.matter,
    })),
    ...events.map((e) => ({
      kind: "event" as const,
      id: e.id,
      date: e.startTime,
      title: e.title,
      eventType: e.type,
      location: e.location,
      matter: e.matter,
    })),
  ];

  merged.sort((a, b) => a.date.getTime() - b.date.getTime());
  return merged.slice(0, limit);
}

export async function getOpenTasksAcrossMatters(user: AuthorizableUser, limit = 6) {
  const where = await matterScopeFilterFor(user);
  return prisma.task.findMany({
    where: { ...where, status: { in: ["OPEN", "IN_PROGRESS"] } },
    include: { matter: { include: { client: true } }, assignedTo: true },
    orderBy: [{ dueDate: "asc" }],
    take: limit,
  });
}

export async function getRecentDiscoveryAcrossMatters(user: AuthorizableUser, limit = 5) {
  const where = await matterScopeFilterFor(user);
  return prisma.discoveryProduction.findMany({
    where,
    include: { matter: { include: { client: true } }, files: true },
    orderBy: { receivedDate: "desc" },
    take: limit,
  });
}

export async function getRecentCallsAcrossMatters(user: AuthorizableUser, limit = 6) {
  const { where } = await getCallVisibilityFilter(user);

  return prisma.call.findMany({
    where,
    include: { matter: { include: { client: true } } },
    orderBy: { occurredAt: "desc" },
    take: limit,
  });
}
