import type { PrismaClient } from "@prisma/client";

import { prisma as defaultPrisma } from "@/lib/db";
import {
  OVERDUE_WINDOW_MS,
  RECENT_ACTIVITY_WINDOW_MS,
  planNotifications,
  type PlannerSnapshot,
  type PlannerUser,
} from "@/lib/notifications/planner";

/**
 * Bounded, idempotent notification scheduler. Runs from the protected cron
 * route (app/api/cron/notifications) or the dev CLI
 * (scripts/run-notifications.ts) — never from a user's browser. Which host
 * scheduler calls the cron route in production is not decided yet (see
 * docs/ARCHITECTURE.md's deployment section).
 *
 * Safety properties:
 * - A `SchedulerLock` row named "notifications" is claimed with an atomic
 *   conditional update; a second concurrent run sees count 0 and exits.
 *   A crashed run's lock goes stale after LOCK_TTL_MS and can be reclaimed.
 * - Inserts use `createMany({ skipDuplicates })` against the
 *   (userId, dedupeKey) unique index, so overlapping or retried runs can
 *   never create the same notification twice.
 * - The recorded outcome is counts only — no names, titles, or ids.
 */

export const SCHEDULER_LOCK_NAME = "notifications";
export const LOCK_TTL_MS = 5 * 60_000;
const DAY = 24 * 60 * 60_000;
/** Look-ahead for task due reminders and event occurrences (largest supported offset is one week). */
const LOOKAHEAD_MS = 31 * DAY;
const SNAPSHOT_ROW_CAP = 5_000;

type Db = Pick<
  PrismaClient,
  | "schedulerLock"
  | "notification"
  | "notificationPreference"
  | "user"
  | "matterAssignment"
  | "task"
  | "deadline"
  | "calendarEvent"
  | "auditEvent"
  | "chatConversation"
>;

export type SchedulerResult =
  | { status: "skipped"; reason: "locked" }
  | { status: "completed"; planned: number; created: number; batches: number };

export async function claimSchedulerLock(db: Db, now: Date): Promise<boolean> {
  await db.schedulerLock.upsert({ where: { name: SCHEDULER_LOCK_NAME }, create: { name: SCHEDULER_LOCK_NAME }, update: {} });
  const claimed = await db.schedulerLock.updateMany({
    where: { name: SCHEDULER_LOCK_NAME, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
    data: { lockedUntil: new Date(now.getTime() + LOCK_TTL_MS) },
  });
  return claimed.count === 1;
}

export async function loadSnapshot(db: Db, now: Date): Promise<PlannerSnapshot> {
  const recentSince = new Date(now.getTime() - RECENT_ACTIVITY_WINDOW_MS);
  const overdueSince = new Date(now.getTime() - OVERDUE_WINDOW_MS - DAY);
  const lookahead = new Date(now.getTime() + LOOKAHEAD_MS);

  const [users, assignments, preferences, tasks, deadlines, events, conversations] = await Promise.all([
    db.user.findMany({ where: { status: "ACTIVE" }, select: { id: true, role: true } }),
    db.matterAssignment.findMany({ select: { userId: true, matterId: true } }),
    db.notificationPreference.findMany({ where: { inApp: false }, select: { userId: true, kind: true } }),
    db.task.findMany({
      where: {
        status: { notIn: ["DONE", "CANCELLED"] },
        assignedToId: { not: null },
        OR: [{ updatedAt: { gte: recentSince } }, { dueDate: { gte: overdueSince, lte: lookahead } }],
      },
      select: { id: true, matterId: true, assignedToId: true, dueDate: true, status: true, reminderOffsetsMinutes: true, updatedAt: true },
      take: SNAPSHOT_ROW_CAP,
    }),
    db.deadline.findMany({
      where: { satisfied: false, date: { gte: overdueSince, lte: lookahead } },
      select: { id: true, matterId: true, date: true, reminderDaysBefore: true, satisfied: true },
      take: SNAPSHOT_ROW_CAP,
    }),
    db.calendarEvent.findMany({
      where: {
        OR: [
          { updatedAt: { gte: recentSince } },
          { startTime: { gte: new Date(now.getTime() - DAY), lte: lookahead } },
          { recurrenceFrequency: { not: "NONE" }, startTime: { lte: lookahead } },
        ],
      },
      select: {
        id: true,
        matterId: true,
        type: true,
        status: true,
        createdById: true,
        startTime: true,
        endTime: true,
        timeZone: true,
        recurrenceFrequency: true,
        recurrenceInterval: true,
        recurrenceUntil: true,
        recurrenceCount: true,
        reminderMinutesBefore: true,
        reminderOffsetsMinutes: true,
        createdAt: true,
        updatedAt: true,
        attendees: { select: { userId: true } },
        exceptions: { select: { originalStart: true, kind: true, startTime: true } },
      },
      take: SNAPSHOT_ROW_CAP,
    }),
    db.chatConversation.findMany({
      where: { type: { in: ["DIRECT", "GROUP"] }, archivedAt: null, lastMessageAt: { gte: recentSince } },
      select: {
        id: true,
        memberships: { where: { leftAt: null }, select: { userId: true, lastReadAt: true } },
        messages: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true, authorId: true, createdAt: true } },
      },
      take: SNAPSHOT_ROW_CAP,
    }),
  ]);

  const editors = events.length
    ? await db.auditEvent.findMany({
        where: { entityType: "CalendarEvent", entityId: { in: events.map((e) => e.id) } },
        orderBy: { occurredAt: "desc" },
        select: { entityId: true, actorId: true },
      })
    : [];
  const lastEditor = new Map<string, string | null>();
  for (const e of editors) if (!lastEditor.has(e.entityId)) lastEditor.set(e.entityId, e.actorId);

  const assignedByUser = new Map<string, Set<string>>();
  const assigneesByMatter = new Map<string, string[]>();
  for (const a of assignments) {
    if (!assignedByUser.has(a.userId)) assignedByUser.set(a.userId, new Set());
    assignedByUser.get(a.userId)!.add(a.matterId);
    assigneesByMatter.set(a.matterId, [...(assigneesByMatter.get(a.matterId) ?? []), a.userId]);
  }
  const userMap = new Map<string, PlannerUser>(
    users.map((u) => [u.id, { id: u.id, isAdmin: u.role === "ADMIN", assignedMatterIds: assignedByUser.get(u.id) ?? new Set() }]),
  );

  return {
    users: userMap,
    tasks,
    deadlines: deadlines.map((d) => ({ ...d, recipientIds: assigneesByMatter.get(d.matterId) ?? [] })),
    events: events.map((e) => ({
      ...e,
      attendeeIds: e.attendees.map((a) => a.userId),
      lastEditorId: lastEditor.get(e.id) ?? null,
      exceptions: e.exceptions,
    })),
    conversations: conversations.flatMap((c) =>
      c.messages[0]
        ? [
            {
              id: c.id,
              lastMessageId: c.messages[0].id,
              lastMessageAt: c.messages[0].createdAt,
              lastMessageAuthorId: c.messages[0].authorId,
              members: c.memberships,
            },
          ]
        : [],
    ),
    disabled: new Set(preferences.map((p) => `${p.userId}:${p.kind}`)),
  };
}

export async function runNotificationScheduler(
  options: { now?: Date; batchSize?: number; db?: Db } = {},
): Promise<SchedulerResult> {
  const now = options.now ?? new Date();
  const batchSize = Math.max(1, Math.min(options.batchSize ?? 500, 1_000));
  const db = options.db ?? defaultPrisma;

  if (!(await claimSchedulerLock(db, now))) return { status: "skipped", reason: "locked" };

  let outcome = "failed";
  try {
    const planned = planNotifications(now, await loadSnapshot(db, now));
    let created = 0;
    let batches = 0;
    for (let i = 0; i < planned.length; i += batchSize) {
      const result = await db.notification.createMany({ data: planned.slice(i, i + batchSize), skipDuplicates: true });
      created += result.count;
      batches += 1;
    }
    outcome = `completed: planned=${planned.length} created=${created}`;
    return { status: "completed", planned: planned.length, created, batches };
  } finally {
    await db.schedulerLock.update({
      where: { name: SCHEDULER_LOCK_NAME },
      data: { lockedUntil: null, lastRunAt: now, lastOutcome: outcome },
    });
  }
}
