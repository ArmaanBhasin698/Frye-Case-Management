import type { ActivityEventType, Prisma } from "@prisma/client";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { dailyActiveMinutes, easternDay, sessionDurationMinutes } from "@/lib/usage/estimate";
import { USAGE_MODULES } from "@/lib/usage/sanitize";

/**
 * Read models for the ADMIN-only usage page (/admin/usage) and the
 * security-center activity panel. Callers MUST have already asserted
 * ADMIN — nothing here is matter-scoped, by design, because employee
 * monitoring data is restricted to administrators as a whole.
 *
 * "Data changes" are read from AuditEvent (already written for every
 * case-data write) rather than duplicated into UserActivityEvent; only
 * action/entity/ids are selected, never `metadata`.
 */

export const ACTIVITY_EVENT_TYPES = [
  "LOGIN_SUCCESS",
  "LOGOUT",
  "SESSION_START",
  "SESSION_EXPIRED",
  "PAGE_VIEW",
  "MATTER_VIEW",
  "DOCUMENT_DOWNLOAD",
  "REPORT_EXPORT",
  "DATA_CHANGE",
  "ADMIN_ACTION",
  "ACCESS_DENIED",
] as const satisfies readonly ActivityEventType[];

const DEFAULT_RANGE_DAYS = 30;
const MAX_RANGE_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .catch(undefined);

const filterSchema = z.object({
  from: isoDate,
  to: isoDate,
  userId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).optional().catch(undefined),
  matterId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).optional().catch(undefined),
  type: z.enum(ACTIVITY_EVENT_TYPES).optional().catch(undefined),
  module: z.enum([...USAGE_MODULES, "other"]).optional().catch(undefined),
});

export type UsageFilters = {
  from: Date;
  /** Exclusive upper bound (start of the day after `toDay`). */
  to: Date;
  fromDay: string;
  toDay: string;
  userId?: string;
  matterId?: string;
  type?: ActivityEventType;
  module?: string;
};

/**
 * Pure: query-string → validated filters. Invalid values are dropped, not
 * errors. Dates are calendar days (UTC midnight bounds); the range is
 * clamped to MAX_RANGE_DAYS and defaults to the last 30 days.
 */
export function parseUsageFilters(
  params: Record<string, string | string[] | undefined>,
  now = new Date(),
): UsageFilters {
  const flat = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v || undefined]));
  const parsed = filterSchema.parse(flat);

  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let to = parsed.to ? new Date(`${parsed.to}T00:00:00Z`) : todayStart;
  to = new Date(to.getTime() + DAY_MS);
  let from = parsed.from ? new Date(`${parsed.from}T00:00:00Z`) : new Date(to.getTime() - DEFAULT_RANGE_DAYS * DAY_MS);
  if (from >= to) from = new Date(to.getTime() - DAY_MS);
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS) from = new Date(to.getTime() - MAX_RANGE_DAYS * DAY_MS);

  return {
    from,
    to,
    fromDay: from.toISOString().slice(0, 10),
    toDay: new Date(to.getTime() - DAY_MS).toISOString().slice(0, 10),
    userId: parsed.userId,
    matterId: parsed.matterId,
    type: parsed.type,
    module: parsed.module,
  };
}

export async function getUsageReport(filters: UsageFilters) {
  const range = { gte: filters.from, lt: filters.to };

  const eventWhere: Prisma.UserActivityEventWhereInput = {
    occurredAt: range,
    ...(filters.userId ? { userId: filters.userId } : {}),
    ...(filters.matterId ? { matterId: filters.matterId } : {}),
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.module ? { module: filters.module } : {}),
  };
  const minuteWhere: Prisma.UserActivityMinuteWhereInput = {
    minute: range,
    ...(filters.userId ? { userId: filters.userId } : {}),
    ...(filters.matterId ? { matterId: filters.matterId } : {}),
    ...(filters.module ? { module: filters.module } : {}),
  };
  const timeWhere: Prisma.TimeEntryWhereInput = {
    voidedAt: null,
    workDate: range,
    ...(filters.userId ? { userId: filters.userId } : {}),
    ...(filters.matterId ? { matterId: filters.matterId } : {}),
  };

  const [
    users,
    logins,
    failedLogins,
    sessions,
    actions,
    dataChanges,
    minutesByUser,
    minutesByModule,
    minutesByMatter,
    eventsByModule,
    matterViews,
    timeByUser,
    minuteRows,
  ] = await Promise.all([
    prisma.user.findMany({ select: { id: true, name: true, role: true, status: true }, orderBy: { name: "asc" } }),
    prisma.userActivityEvent.findMany({
      where: { occurredAt: range, type: "LOGIN_SUCCESS", ...(filters.userId ? { userId: filters.userId } : {}) },
      select: { id: true, occurredAt: true, userId: true, sessionId: true },
      orderBy: { occurredAt: "desc" },
      take: 100,
    }),
    prisma.failedLoginAttempt.findMany({
      where: { occurredAt: range, ...(filters.userId ? { accountId: filters.userId } : {}) },
      select: { id: true, occurredAt: true, accountId: true, emailAttempted: true },
      orderBy: { occurredAt: "desc" },
      take: 100,
    }),
    prisma.userSession.findMany({
      where: { startedAt: range, ...(filters.userId ? { userId: filters.userId } : {}) },
      select: { id: true, userId: true, startedAt: true, lastSeenAt: true, endedAt: true, endReason: true },
      orderBy: { startedAt: "desc" },
      take: 100,
    }),
    prisma.userActivityEvent.findMany({
      where: { AND: [eventWhere, filters.type ? {} : { type: { notIn: ["PAGE_VIEW", "LOGIN_SUCCESS", "SESSION_START"] } }] },
      select: {
        id: true,
        occurredAt: true,
        userId: true,
        type: true,
        module: true,
        path: true,
        matterId: true,
        resourceType: true,
        result: true,
      },
      orderBy: { occurredAt: "desc" },
      take: 100,
    }),
    filters.type && filters.type !== "DATA_CHANGE"
      ? Promise.resolve([])
      : prisma.auditEvent.findMany({
          where: {
            occurredAt: range,
            ...(filters.userId ? { actorId: filters.userId } : {}),
            ...(filters.matterId ? { matterId: filters.matterId } : {}),
          },
          select: { id: true, occurredAt: true, actorId: true, action: true, entityType: true, matterId: true },
          orderBy: { occurredAt: "desc" },
          take: 100,
        }),
    prisma.userActivityMinute.groupBy({ by: ["userId"], where: minuteWhere, _count: { _all: true } }),
    prisma.userActivityMinute.groupBy({ by: ["module"], where: minuteWhere, _count: { _all: true } }),
    prisma.userActivityMinute.groupBy({
      by: ["matterId"],
      where: { AND: [minuteWhere, { matterId: { not: null } }] },
      _count: { _all: true },
    }),
    prisma.userActivityEvent.groupBy({ by: ["module"], where: eventWhere, _count: { _all: true } }),
    prisma.userActivityEvent.groupBy({
      by: ["matterId"],
      where: { AND: [eventWhere, { type: "MATTER_VIEW", matterId: { not: null } }] },
      _count: { _all: true },
    }),
    prisma.timeEntry.groupBy({ by: ["userId"], where: timeWhere, _sum: { durationMinutes: true } }),
    prisma.userActivityMinute.findMany({ where: minuteWhere, select: { minute: true }, take: 200_000 }),
  ]);

  const sessionMinuteCounts = sessions.length
    ? await prisma.userActivityMinute.groupBy({
        by: ["sessionId"],
        where: { sessionId: { in: sessions.map((s) => s.id) } },
        _count: { _all: true },
      })
    : [];

  const matterIds = [
    ...new Set([
      ...minutesByMatter.map((m) => m.matterId),
      ...matterViews.map((m) => m.matterId),
      ...actions.map((a) => a.matterId),
      ...dataChanges.map((d) => d.matterId),
    ]),
  ].filter((id): id is string => Boolean(id));
  const matters = matterIds.length
    ? await prisma.matter.findMany({ where: { id: { in: matterIds } }, select: { id: true, caseNumber: true } })
    : [];

  const userName = new Map(users.map((u) => [u.id, u.name]));
  const caseNumber = new Map(matters.map((m) => [m.id, m.caseNumber]));
  const sessionActive = new Map(sessionMinuteCounts.map((s) => [s.sessionId, s._count._all]));

  const loginHistory = [
    ...logins.map((l) => ({
      id: l.id,
      at: l.occurredAt,
      user: l.userId ? (userName.get(l.userId) ?? "Unknown user") : "Unknown user",
      outcome: "Success" as const,
    })),
    ...failedLogins.map((f) => ({
      id: f.id,
      at: f.occurredAt,
      user: f.accountId ? (userName.get(f.accountId) ?? f.emailAttempted) : `${f.emailAttempted} (no account)`,
      outcome: "Failed" as const,
    })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 100);

  const minutesUser = new Map(minutesByUser.map((m) => [m.userId, m._count._all]));
  const hoursUser = new Map(timeByUser.map((t) => [t.userId, t._sum.durationMinutes ?? 0]));
  const loginsUser = new Map<string, number>();
  for (const l of logins) if (l.userId) loginsUser.set(l.userId, (loginsUser.get(l.userId) ?? 0) + 1);

  const perUser = users
    .filter((u) => !filters.userId || u.id === filters.userId)
    .map((u) => ({
      id: u.id,
      name: u.name,
      role: u.role,
      logins: loginsUser.get(u.id) ?? 0,
      estimatedActiveMinutes: minutesUser.get(u.id) ?? 0,
      recordedWorkMinutes: hoursUser.get(u.id) ?? 0,
    }))
    .filter((u) => u.logins + u.estimatedActiveMinutes + u.recordedWorkMinutes > 0 || filters.userId);

  const daily = dailyActiveMinutes(minuteRows);
  const loginsDaily = new Map<string, number>();
  for (const l of logins) {
    const day = easternDay(l.occurredAt);
    loginsDaily.set(day, (loginsDaily.get(day) ?? 0) + 1);
  }
  const days = [...new Set([...daily.keys(), ...loginsDaily.keys()])].sort();

  const moduleTotals = new Map<string, { minutes: number; events: number }>();
  for (const m of minutesByModule) {
    const key = m.module ?? "other";
    moduleTotals.set(key, { minutes: m._count._all, events: moduleTotals.get(key)?.events ?? 0 });
  }
  for (const e of eventsByModule) {
    const key = e.module ?? "other";
    moduleTotals.set(key, { minutes: moduleTotals.get(key)?.minutes ?? 0, events: e._count._all });
  }

  const matterTotals = new Map<string, { views: number; minutes: number }>();
  for (const m of minutesByMatter) if (m.matterId) matterTotals.set(m.matterId, { views: 0, minutes: m._count._all });
  for (const v of matterViews) {
    if (!v.matterId) continue;
    matterTotals.set(v.matterId, { views: v._count._all, minutes: matterTotals.get(v.matterId)?.minutes ?? 0 });
  }

  return {
    users,
    loginHistory,
    sessions: sessions.map((s) => ({
      ...s,
      user: userName.get(s.userId) ?? "Unknown user",
      durationMinutes: sessionDurationMinutes(s),
      estimatedActiveMinutes: sessionActive.get(s.id) ?? 0,
    })),
    actions: actions.map((a) => ({
      ...a,
      user: a.userId ? (userName.get(a.userId) ?? "Unknown user") : "—",
      caseNumber: a.matterId ? (caseNumber.get(a.matterId) ?? null) : null,
    })),
    dataChanges: dataChanges.map((d) => ({
      ...d,
      user: d.actorId ? (userName.get(d.actorId) ?? "Unknown user") : "System",
      caseNumber: d.matterId ? (caseNumber.get(d.matterId) ?? null) : null,
    })),
    modules: [...moduleTotals.entries()]
      .map(([module, totals]) => ({ module, ...totals }))
      .sort((a, b) => b.minutes + b.events - (a.minutes + a.events)),
    matters: [...matterTotals.entries()]
      .map(([matterId, totals]) => ({ matterId, caseNumber: caseNumber.get(matterId) ?? "Unknown matter", ...totals }))
      .sort((a, b) => b.minutes + b.views - (a.minutes + a.views)),
    perUser,
    daily: days.map((day) => ({ day, activeMinutes: daily.get(day) ?? 0, logins: loginsDaily.get(day) ?? 0 })),
  };
}

/** Security-center panel: recent access denials and failed-login patterns (last 7 days). */
export async function getSecurityActivitySummary(now = new Date()) {
  const since = new Date(now.getTime() - 7 * DAY_MS);
  const [denials, failedByEmail] = await Promise.all([
    prisma.userActivityEvent.findMany({
      where: { type: "ACCESS_DENIED", occurredAt: { gte: since } },
      select: { id: true, occurredAt: true, module: true, resourceType: true, path: true, user: { select: { name: true } } },
      orderBy: { occurredAt: "desc" },
      take: 20,
    }),
    prisma.failedLoginAttempt.groupBy({
      by: ["emailAttempted"],
      where: { occurredAt: { gte: since } },
      _count: { _all: true },
      _max: { occurredAt: true },
      orderBy: { _count: { emailAttempted: "desc" } },
      take: 10,
    }),
  ]);
  return {
    since,
    denials,
    failedByEmail: failedByEmail.map((f) => ({
      email: f.emailAttempted,
      attempts: f._count._all,
      lastAttempt: f._max.occurredAt,
    })),
  };
}
