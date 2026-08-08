import type { CalendarEventType, DeadlineType } from "@prisma/client";

import { prisma } from "@/lib/db";

/**
 * Cross-matter aggregate reads for the firm-wide dashboard home page.
 *
 * Same caveat as lib/matters/queries.ts: no access control yet. Once
 * matter-level authorization exists (docs/ROADMAP.md, Phase 1/2), every
 * one of these needs to be scoped to the current user's assigned matters
 * unless they're an admin.
 */

export async function getDashboardStats() {
  const now = new Date();

  const [activeMatters, openTasks, upcomingDeadlines, upcomingCourtDates, unfiledCalls] =
    await Promise.all([
      prisma.matter.count({ where: { status: { in: ["OPEN", "PENDING"] } } }),
      prisma.task.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] } } }),
      prisma.deadline.count({ where: { satisfied: false, date: { gte: now } } }),
      prisma.calendarEvent.count({ where: { startTime: { gte: now } } }),
      prisma.call.count({ where: { matterId: null } }),
    ]);

  return { activeMatters, openTasks, upcomingDeadlines, upcomingCourtDates, unfiledCalls };
}

export function getActiveMatters(limit = 5) {
  return prisma.matter.findMany({
    where: { status: { in: ["OPEN", "PENDING"] } },
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
export async function getUpcomingKeyDates(limit = 6): Promise<UpcomingKeyDate[]> {
  const now = new Date();

  const [deadlines, events] = await Promise.all([
    prisma.deadline.findMany({
      where: { satisfied: false, date: { gte: now } },
      include: { matter: { include: { client: true } } },
      orderBy: { date: "asc" },
      take: limit,
    }),
    prisma.calendarEvent.findMany({
      where: { startTime: { gte: now } },
      include: { matter: { include: { client: true } } },
      orderBy: { startTime: "asc" },
      take: limit,
    }),
  ]);

  const merged: UpcomingKeyDate[] = [
    ...deadlines.map((d) => ({
      kind: "deadline" as const,
      id: d.id,
      date: d.date,
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

export function getOpenTasksAcrossMatters(limit = 6) {
  return prisma.task.findMany({
    where: { status: { in: ["OPEN", "IN_PROGRESS"] } },
    include: { matter: { include: { client: true } }, assignedTo: true },
    orderBy: [{ dueDate: "asc" }],
    take: limit,
  });
}

export function getRecentDiscoveryAcrossMatters(limit = 5) {
  return prisma.discoveryProduction.findMany({
    include: { matter: { include: { client: true } }, files: true },
    orderBy: { receivedDate: "desc" },
    take: limit,
  });
}

export function getRecentCallsAcrossMatters(limit = 6) {
  return prisma.call.findMany({
    include: { matter: { include: { client: true } } },
    orderBy: { occurredAt: "desc" },
    take: limit,
  });
}
