import { endOfDay, startOfDay, startOfWeek } from "date-fns";

import { prisma } from "@/lib/db";
import { matterIdFilterFor } from "@/lib/auth/access";
import { isAdmin, type AuthorizableUser } from "@/lib/auth/authorization";
import { findOverlaps, summarizeEntries, timerElapsedSeconds, isLongRunningTimer } from "@/lib/time/math";
import { timeCategoryLabel } from "@/lib/time/labels";
import { matterTitle } from "@/lib/matters/format";

/**
 * Time-tracking reads. Matter-scoped reads must only be called after the
 * caller has asserted matter access (pages do via the matter layout +
 * assertMatterAccess); user-scoped reads are restricted to matters the
 * user can still access, so revoked access also hides old matter labels.
 */

const entryInclude = {
  user: { select: { id: true, name: true } },
  matter: { select: { id: true, caseNumber: true, client: { select: { firstName: true, lastName: true } } } },
} as const;

export async function getMatterTimeData(user: AuthorizableUser, matterId: string) {
  const entries = await prisma.timeEntry.findMany({
    where: { matterId },
    include: entryInclude,
    orderBy: [{ workDate: "desc" }, { createdAt: "desc" }],
  });
  const includeAmounts = isAdmin(user);
  const summary = summarizeEntries(
    entries.map((e) => ({
      userId: e.userId,
      userName: e.user.name,
      workDate: e.workDate,
      durationMinutes: e.durationMinutes,
      billable: e.billable,
      category: e.category,
      hourlyRateCents: e.hourlyRateCents,
      voidedAt: e.voidedAt,
      status: e.status,
    })),
    { includeAmounts, categoryLabel: timeCategoryLabel },
  );
  return { entries, summary, includeAmounts };
}

export async function getActiveTimer(userId: string) {
  const timer = await prisma.activeTimer.findUnique({
    where: { userId },
    include: { matter: { select: { id: true, caseNumber: true, client: { select: { firstName: true, lastName: true } } } } },
  });
  if (!timer) return null;
  const elapsedSeconds = timerElapsedSeconds(timer);
  return {
    ...timer,
    matterLabel: `${matterTitle(timer.matter)} (${timer.matter.caseNumber})`,
    elapsedSeconds,
    running: timer.runningSince !== null,
    longRunning: isLongRunningTimer(elapsedSeconds),
  };
}

export async function getMyTimeData(user: AuthorizableUser) {
  const matterWhere = await matterIdFilterFor(user);
  const [timer, entries] = await Promise.all([
    getActiveTimer(user.id),
    prisma.timeEntry.findMany({
      where: { userId: user.id, matter: matterWhere },
      include: entryInclude,
      orderBy: [{ workDate: "desc" }, { createdAt: "desc" }],
      take: 100,
    }),
  ]);
  const drafts = entries.filter((e) => e.status === "DRAFT" && !e.voidedAt);
  const overlaps = findOverlaps(entries.filter((e) => !e.voidedAt));
  return { timer, entries, drafts, overlappingIds: new Set(overlaps.flat()) };
}

/** Dashboard summary for the current user: today / this week (recorded, submitted, unvoided) + timer + drafts. */
export async function getMyTimeSummary(user: AuthorizableUser) {
  const now = new Date();
  const [today, week, draftCount, timer] = await Promise.all([
    prisma.timeEntry.aggregate({
      where: { userId: user.id, voidedAt: null, status: "SUBMITTED", workDate: { gte: startOfDay(now), lte: endOfDay(now) } },
      _sum: { durationMinutes: true },
    }),
    prisma.timeEntry.aggregate({
      where: {
        userId: user.id,
        voidedAt: null,
        status: "SUBMITTED",
        workDate: { gte: startOfWeek(now, { weekStartsOn: 1 }), lte: endOfDay(now) },
      },
      _sum: { durationMinutes: true },
    }),
    prisma.timeEntry.count({ where: { userId: user.id, status: "DRAFT", voidedAt: null } }),
    getActiveTimer(user.id),
  ]);
  return {
    todayMinutes: today._sum.durationMinutes ?? 0,
    weekMinutes: week._sum.durationMinutes ?? 0,
    draftCount,
    timer,
  };
}

export async function listTimeMatterOptions(user: AuthorizableUser) {
  const where = await matterIdFilterFor(user);
  const matters = await prisma.matter.findMany({
    where: { ...where, archived: false },
    select: { id: true, caseNumber: true, status: true, client: { select: { firstName: true, lastName: true } } },
    orderBy: { openedDate: "desc" },
  });
  return matters.map((m) => ({ id: m.id, label: `${m.caseNumber} — ${matterTitle(m)}`, status: m.status }));
}
