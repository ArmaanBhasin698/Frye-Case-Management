"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { hasMatterAccess } from "@/lib/auth/access";
import { requireCurrentUser } from "@/lib/auth/session";
import { canManageClientsAndMatters, isAdmin, type AuthorizableUser } from "@/lib/auth/authorization";
import { diffFields } from "@/lib/utils";
import type { ActionResult } from "@/lib/matters/actions";
import { readTimeEntryFields } from "@/lib/time/fields";
import { TIME_CATEGORY_VALUES } from "@/lib/time/labels";
import {
  findOverlaps,
  isLongRunningTimer,
  MAX_ENTRY_MINUTES,
  secondsToRecordedMinutes,
  timerElapsedSeconds,
} from "@/lib/time/math";

/**
 * Server Actions for matter time tracking. Every action re-checks the
 * session and matter access itself. Rules:
 *  - Anyone with matter access records their *own* time; only ADMIN may
 *    record or correct time on someone else's behalf.
 *  - A CLOSED matter keeps its entries; new time on it is limited to
 *    ADMIN/ATTORNEY (wrap-up work), so closure isn't silently undermined.
 *  - Rates are ADMIN-only: a rate submitted by anyone else is ignored.
 *  - Entries are never deleted — a mistaken entry is voided with a reason.
 *  - Audit metadata carries ids, enums, and numbers — never descriptions.
 */

const NOT_FOUND_ERROR = "Not found or access denied.";
const cuid = z.string().trim().min(1).max(100);

export type TimeFormState = { error: string | null; warning?: string | null };

function revalidateTime(matterId: string) {
  revalidatePath(`/matters/${matterId}/time`);
  revalidatePath("/time");
  revalidatePath("/");
}

/** Matter access plus the closed-matter rule. Returns false for a nonexistent matter. */
async function canRecordTimeOn(user: AuthorizableUser, matterId: string): Promise<boolean> {
  if (!(await hasMatterAccess(user, matterId))) return false;
  const matter = await prisma.matter.findUnique({ where: { id: matterId }, select: { status: true } });
  if (!matter) return false;
  return matter.status !== "CLOSED" || canManageClientsAndMatters(user);
}

async function overlapWarning(userId: string, entryId: string, workDate: Date): Promise<string | null> {
  const dayStart = new Date(workDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const sameDay = await prisma.timeEntry.findMany({
    where: { userId, voidedAt: null, workDate: { gte: dayStart, lt: dayEnd } },
    select: { id: true, startedAt: true, endedAt: true },
  });
  const overlaps = findOverlaps(sameDay).filter(([a, b]) => a === entryId || b === entryId);
  return overlaps.length > 0 ? "Saved. Note: this entry's times overlap another entry you recorded that day." : null;
}

// --- Manual entries ------------------------------------------------------------

export async function createTimeEntry(_prev: TimeFormState, formData: FormData): Promise<TimeFormState> {
  const user = await requireCurrentUser();
  const parsed = readTimeEntryFields(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const fields = parsed.data;

  let userId = user.id;
  const onBehalfOf = String(formData.get("userId") ?? "").trim();
  if (onBehalfOf && onBehalfOf !== user.id) {
    if (!isAdmin(user)) return { error: NOT_FOUND_ERROR };
    const target = await prisma.user.count({ where: { id: onBehalfOf, status: "ACTIVE" } });
    if (target === 0) return { error: "Choose an active staff member." };
    userId = onBehalfOf;
  }

  if (!(await canRecordTimeOn(user, fields.matterId))) return { error: NOT_FOUND_ERROR };

  let entryId: string;
  try {
    entryId = await prisma.$transaction(async (tx) => {
      const entry = await tx.timeEntry.create({
        data: {
          ...fields,
          hourlyRateCents: isAdmin(user) ? fields.hourlyRateCents : null,
          userId,
          status: "SUBMITTED",
          source: "MANUAL",
        },
      });
      await tx.auditEvent.create({
        data: {
          actorId: user.id,
          action: "CREATE",
          entityType: "TimeEntry",
          entityId: entry.id,
          matterId: fields.matterId,
          metadata: {
            userId,
            durationMinutes: entry.durationMinutes,
            category: entry.category,
            billable: entry.billable,
            source: "MANUAL",
          },
        },
      });
      return entry.id;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") return { error: NOT_FOUND_ERROR };
    throw error;
  }

  revalidateTime(fields.matterId);
  return { error: null, warning: await overlapWarning(userId, entryId, fields.workDate) };
}

/** Loads an entry the caller may correct: their own, or any for ADMIN — and only on a matter they can still access. */
async function loadOwnEntry(user: AuthorizableUser, entryId: string) {
  const entry = await prisma.timeEntry.findUnique({ where: { id: entryId } });
  if (!entry) return null;
  if (entry.userId !== user.id && !isAdmin(user)) return null;
  if (!(await hasMatterAccess(user, entry.matterId))) return null;
  return entry;
}

export async function updateTimeEntry(_prev: TimeFormState, formData: FormData): Promise<TimeFormState> {
  const user = await requireCurrentUser();
  const entryId = cuid.safeParse(formData.get("entryId"));
  if (!entryId.success) return { error: NOT_FOUND_ERROR };
  const before = await loadOwnEntry(user, entryId.data);
  if (!before || before.voidedAt) return { error: NOT_FOUND_ERROR };

  // The matter of an existing entry can't be changed by editing — void and re-enter instead.
  formData.set("matterId", before.matterId);
  const parsed = readTimeEntryFields(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const { matterId: _matterId, description, hourlyRateCents, ...rest } = parsed.data;
  void _matterId;
  const nextRate = isAdmin(user) ? hourlyRateCents : before.hourlyRateCents;

  const changed = diffFields(
    {
      workDate: before.workDate,
      startedAt: before.startedAt,
      endedAt: before.endedAt,
      durationMinutes: before.durationMinutes,
      category: before.category,
      billable: before.billable,
      hourlyRateCents: before.hourlyRateCents,
    },
    { ...rest, hourlyRateCents: nextRate },
  );
  const descriptionChanged = before.description !== description;

  await prisma.$transaction([
    prisma.timeEntry.update({
      where: { id: before.id },
      data: { ...rest, description, hourlyRateCents: nextRate, status: "SUBMITTED" },
    }),
    prisma.auditEvent.create({
      data: {
        actorId: user.id,
        action: "UPDATE",
        entityType: "TimeEntry",
        entityId: before.id,
        matterId: before.matterId,
        metadata: {
          changed,
          ...(descriptionChanged ? { descriptionChanged: true } : {}),
          ...(before.status === "DRAFT" ? { confirmedDraft: true } : {}),
        },
      },
    }),
  ]);

  revalidateTime(before.matterId);
  return { error: null, warning: await overlapWarning(before.userId, before.id, rest.workDate) };
}

const voidSchema = z.object({
  entryId: cuid,
  reason: z.string().trim().min(3, "Give a reason for voiding this entry.").max(500),
});

/** Voids (never deletes) an entry. It stays visible in history, excluded from totals. */
export async function voidTimeEntry(input: { entryId: string; reason: string }): Promise<ActionResult> {
  const user = await requireCurrentUser();
  const parsed = voidSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const entry = await loadOwnEntry(user, parsed.data.entryId);
  if (!entry) return { ok: false, error: NOT_FOUND_ERROR };
  if (entry.voidedAt) return { ok: false, error: "This entry is already void." };

  await prisma.$transaction([
    prisma.timeEntry.update({
      where: { id: entry.id },
      data: { voidedAt: new Date(), voidReason: parsed.data.reason },
    }),
    prisma.auditEvent.create({
      data: {
        actorId: user.id,
        action: "UPDATE",
        entityType: "TimeEntry",
        entityId: entry.id,
        matterId: entry.matterId,
        metadata: { voided: true, durationMinutes: entry.durationMinutes },
      },
    }),
  ]);
  revalidateTime(entry.matterId);
  return { ok: true, data: undefined };
}

// --- Timer -----------------------------------------------------------------------

export type TimerResult =
  | { ok: true }
  | { ok: false; error: string; code?: "TIMER_RUNNING" | "NEEDS_CONFIRMATION"; elapsedMinutes?: number };

/**
 * Converts the user's current timer into a DRAFT entry (inside `tx`) and
 * removes the timer. The draft must be confirmed before it counts.
 */
async function stopTimerInto(
  tx: Prisma.TransactionClient,
  actorId: string,
  timer: { id: string; userId: string; matterId: string; startedAt: Date; runningSince: Date | null; accumulatedSeconds: number; category: string | null; description: string | null },
  durationMinutes: number,
  now: Date,
) {
  const entry = await tx.timeEntry.create({
    data: {
      matterId: timer.matterId,
      userId: timer.userId,
      workDate: timer.startedAt,
      startedAt: timer.startedAt,
      endedAt: now,
      durationMinutes,
      category: (timer.category as (typeof TIME_CATEGORY_VALUES)[number] | null) ?? "OTHER",
      description: timer.description ?? "",
      billable: true,
      status: "DRAFT",
      source: "TIMER",
    },
  });
  await tx.activeTimer.delete({ where: { id: timer.id } });
  await tx.auditEvent.create({
    data: {
      actorId,
      action: "CREATE",
      entityType: "TimeEntry",
      entityId: entry.id,
      matterId: timer.matterId,
      metadata: { source: "TIMER", status: "DRAFT", durationMinutes },
    },
  });
  return entry;
}

const startSchema = z.object({
  matterId: cuid,
  category: z.enum(TIME_CATEGORY_VALUES).optional(),
  description: z.string().trim().max(2_000).optional(),
  switchFromExisting: z.boolean().optional(),
});

/**
 * Starts the caller's one timer. If a timer is already running the call
 * is refused with TIMER_RUNNING unless `switchFromExisting` is set, in
 * which case the old timer becomes a DRAFT entry first — never discarded.
 */
export async function startTimer(input: z.input<typeof startSchema>): Promise<TimerResult> {
  const user = await requireCurrentUser();
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: NOT_FOUND_ERROR };
  const { matterId, category, description, switchFromExisting } = parsed.data;
  if (!(await canRecordTimeOn(user, matterId))) return { ok: false, error: NOT_FOUND_ERROR };

  const existing = await prisma.activeTimer.findUnique({ where: { userId: user.id } });
  if (existing && !switchFromExisting) {
    return { ok: false, code: "TIMER_RUNNING", error: "You already have a timer running. Stop it or switch to this matter." };
  }

  const now = new Date();
  try {
    await prisma.$transaction(async (tx) => {
      if (existing) {
        await stopTimerInto(tx, user.id, existing, secondsToRecordedMinutes(timerElapsedSeconds(existing, now)), now);
      }
      await tx.activeTimer.create({
        data: { userId: user.id, matterId, category: category ?? null, description: description ?? null, startedAt: now, runningSince: now },
      });
    });
  } catch (error) {
    // A concurrent start from another tab hit the one-timer-per-user unique key.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, code: "TIMER_RUNNING", error: "You already have a timer running." };
    }
    throw error;
  }

  revalidateTime(matterId);
  if (existing) revalidateTime(existing.matterId);
  return { ok: true };
}

export async function pauseTimer(): Promise<TimerResult> {
  const user = await requireCurrentUser();
  const timer = await prisma.activeTimer.findUnique({ where: { userId: user.id } });
  if (!timer || !timer.runningSince) return { ok: false, error: "No running timer." };
  await prisma.activeTimer.update({
    where: { id: timer.id },
    data: { accumulatedSeconds: timerElapsedSeconds(timer), runningSince: null },
  });
  revalidateTime(timer.matterId);
  return { ok: true };
}

export async function resumeTimer(): Promise<TimerResult> {
  const user = await requireCurrentUser();
  const timer = await prisma.activeTimer.findUnique({ where: { userId: user.id } });
  if (!timer || timer.runningSince) return { ok: false, error: "No paused timer." };
  if (!(await hasMatterAccess(user, timer.matterId))) return { ok: false, error: NOT_FOUND_ERROR };
  await prisma.activeTimer.update({ where: { id: timer.id }, data: { runningSince: new Date() } });
  revalidateTime(timer.matterId);
  return { ok: true };
}

const stopSchema = z.object({
  confirmLongRunning: z.boolean().optional(),
  adjustedMinutes: z.number().int().min(1).max(MAX_ENTRY_MINUTES).optional(),
});

/**
 * Stops the timer into a DRAFT entry. A timer that ran more than 12 hours
 * was probably left running (closed laptop, forgotten tab): the caller
 * must confirm, and may supply an adjusted duration, before it's recorded.
 */
export async function stopTimer(input: z.input<typeof stopSchema> = {}): Promise<TimerResult> {
  const user = await requireCurrentUser();
  const parsed = stopSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Enter a duration between 1 minute and 24 hours." };
  const timer = await prisma.activeTimer.findUnique({ where: { userId: user.id } });
  if (!timer) return { ok: false, error: "No timer is running." };

  const now = new Date();
  const elapsed = timerElapsedSeconds(timer, now);
  const elapsedMinutes = secondsToRecordedMinutes(elapsed);
  if (isLongRunningTimer(elapsed) && !parsed.data.confirmLongRunning) {
    return {
      ok: false,
      code: "NEEDS_CONFIRMATION",
      elapsedMinutes,
      error: "This timer has been running for over 12 hours. Confirm or adjust the time actually worked.",
    };
  }
  const durationMinutes = Math.min(parsed.data.adjustedMinutes ?? elapsedMinutes, MAX_ENTRY_MINUTES);
  if (durationMinutes < 1) {
    await prisma.activeTimer.delete({ where: { id: timer.id } });
    revalidateTime(timer.matterId);
    return { ok: false, error: "The timer ran for less than a second; nothing was recorded." };
  }

  await prisma.$transaction(async (tx) => {
    await stopTimerInto(tx, user.id, timer, durationMinutes, now);
  });
  revalidateTime(timer.matterId);
  return { ok: true };
}

/** Discards the running timer without recording anything (explicit user choice). */
export async function discardTimer(): Promise<TimerResult> {
  const user = await requireCurrentUser();
  const timer = await prisma.activeTimer.findUnique({ where: { userId: user.id } });
  if (!timer) return { ok: false, error: "No timer is running." };
  await prisma.$transaction([
    prisma.activeTimer.delete({ where: { id: timer.id } }),
    prisma.auditEvent.create({
      data: {
        actorId: user.id,
        action: "DELETE",
        entityType: "ActiveTimer",
        entityId: timer.id,
        matterId: timer.matterId,
        metadata: { discardedSeconds: timerElapsedSeconds(timer) },
      },
    }),
  ]);
  revalidateTime(timer.matterId);
  return { ok: true };
}

/** For the header indicator: the caller's own timer state, no matter details beyond the label. */
export async function getMyTimerState(): Promise<{
  matterId: string;
  matterLabel: string;
  elapsedSeconds: number;
  running: boolean;
} | null> {
  const user = await requireCurrentUser();
  const timer = await prisma.activeTimer.findUnique({
    where: { userId: user.id },
    include: { matter: { select: { caseNumber: true } } },
  });
  if (!timer) return null;
  return {
    matterId: timer.matterId,
    matterLabel: timer.matter.caseNumber,
    elapsedSeconds: timerElapsedSeconds(timer),
    running: timer.runningSince !== null,
  };
}
