import type { RecurrenceFrequency } from "@prisma/client";

import { toWallTime, wallTimeToUtc, type WallTime } from "@/lib/calendar/timezone";

/**
 * Expands a CalendarEvent's simple recurrence rule into concrete
 * occurrences inside a range. Rules are frequency (DAILY/WEEKLY/MONTHLY),
 * interval, and an optional end (`until` instant or `count`). Occurrences
 * are computed on *wall-clock* time in the event's own zone, so a weekly
 * 10:00 meeting stays at 10:00 local across DST. Monthly rules on the
 * 29th–31st clamp to the last day of shorter months. There are no
 * per-occurrence exceptions — editing or cancelling an event applies to the
 * whole series (documented limitation). Expansion is capped at
 * MAX_OCCURRENCES per series.
 */

export const MAX_OCCURRENCES = 500;

export type RecurringEvent = {
  startTime: Date;
  endTime: Date | null;
  timeZone: string;
  recurrenceFrequency: RecurrenceFrequency;
  recurrenceInterval: number;
  recurrenceUntil: Date | null;
  recurrenceCount: number | null;
};

export type Occurrence = { start: Date; end: Date | null; index: number };

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function nthWallStart(base: WallTime, frequency: RecurrenceFrequency, step: number): WallTime {
  if (frequency === "MONTHLY") {
    const monthIndex = base.month - 1 + step;
    const year = base.year + Math.floor(monthIndex / 12);
    const month = (((monthIndex % 12) + 12) % 12) + 1;
    return { ...base, year, month, day: Math.min(base.day, daysInMonth(year, month)) };
  }
  const days = frequency === "WEEKLY" ? step * 7 : step;
  const t = new Date(Date.UTC(base.year, base.month - 1, base.day + days));
  return { ...base, year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

/** Occurrences whose span overlaps [rangeStart, rangeEnd). */
export function expandOccurrences(event: RecurringEvent, rangeStart: Date, rangeEnd: Date): Occurrence[] {
  const durationMs = event.endTime ? Math.max(event.endTime.getTime() - event.startTime.getTime(), 0) : 0;
  const overlaps = (start: Date) => start < rangeEnd && start.getTime() + durationMs >= rangeStart.getTime();

  if (event.recurrenceFrequency === "NONE") {
    return overlaps(event.startTime) ? [{ start: event.startTime, end: event.endTime, index: 0 }] : [];
  }

  const interval = Math.max(1, Math.floor(event.recurrenceInterval || 1));
  const maxCount = Math.min(event.recurrenceCount ?? MAX_OCCURRENCES, MAX_OCCURRENCES);
  const base = toWallTime(event.startTime, event.timeZone);
  const result: Occurrence[] = [];

  for (let i = 0; i < maxCount; i++) {
    const start = wallTimeToUtc(nthWallStart(base, event.recurrenceFrequency, i * interval), event.timeZone);
    if (event.recurrenceUntil && start > event.recurrenceUntil) break;
    if (start >= rangeEnd) break;
    if (overlaps(start)) {
      result.push({ start, end: event.endTime ? new Date(start.getTime() + durationMs) : null, index: i });
    }
  }
  return result;
}

const UNIT: Record<Exclude<RecurrenceFrequency, "NONE">, string> = { DAILY: "day", WEEKLY: "week", MONTHLY: "month" };

export function describeRecurrence(
  event: Pick<RecurringEvent, "recurrenceFrequency" | "recurrenceInterval" | "recurrenceUntil" | "recurrenceCount">,
): string | null {
  if (event.recurrenceFrequency === "NONE") return null;
  const unit = UNIT[event.recurrenceFrequency];
  const every = event.recurrenceInterval > 1 ? `Every ${event.recurrenceInterval} ${unit}s` : `Every ${unit}`;
  if (event.recurrenceCount) return `${every}, ${event.recurrenceCount} times`;
  if (event.recurrenceUntil) return `${every} until ${event.recurrenceUntil.toISOString().slice(0, 10)}`;
  return every;
}
