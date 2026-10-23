import type { CalendarExceptionKind } from "@prisma/client";

import { expandOccurrences, type RecurringEvent } from "@/lib/calendar/recurrence";

/**
 * Per-occurrence exceptions for recurring CalendarEvents — pure, so the
 * identity and expansion rules are unit-testable.
 *
 * Identity scheme (also the anchor for any future calendar sync): an
 * occurrence is identified by its event id plus its ORIGINAL start — the
 * UTC instant the series rule generates for it, before any exception moves
 * it. This is the same concept as iCalendar's RECURRENCE-ID. A
 * CalendarEventException row is keyed `(eventId, originalStart)`; links use
 * `/calendar/events/<id>?occurrence=<originalStart ISO>`; calendar item
 * keys use `<id>@<originalStart ISO>`. A modified occurrence keeps its
 * original identity even when its displayed time moves.
 *
 * A modified occurrence may move at most MAX_OCCURRENCE_SHIFT_DAYS from its
 * original start, which bounds how far outside a view range we must expand
 * to find occurrences that were moved into it.
 */

export const MAX_OCCURRENCE_SHIFT_DAYS = 31;
const SHIFT_MS = MAX_OCCURRENCE_SHIFT_DAYS * 86_400_000;

export type OccurrenceException = {
  originalStart: Date;
  kind: CalendarExceptionKind;
  startTime: Date | null;
  endTime: Date | null;
  title: string | null;
  location: string | null;
  meetingUrl: string | null;
};

export type ResolvedOccurrence = {
  originalStart: Date;
  start: Date;
  end: Date | null;
  cancelled: boolean;
  modified: boolean;
  title: string | null;
  location: string | null;
  meetingUrl: string | null;
};

/** The generated occurrence starting exactly at `originalStart`, or null for a forged / non-occurrence instant. */
export function findOccurrence(event: RecurringEvent, originalStart: Date): { start: Date; end: Date | null } | null {
  if (Number.isNaN(originalStart.getTime())) return null;
  const match = expandOccurrences(event, originalStart, new Date(originalStart.getTime() + 1)).find(
    (o) => o.start.getTime() === originalStart.getTime(),
  );
  return match ? { start: match.start, end: match.end } : null;
}

/**
 * Occurrences overlapping [rangeStart, rangeEnd) after applying exceptions:
 * cancelled ones are dropped unless `includeCancelled`, modified ones use
 * their override time/title/location/link (and may move into or out of
 * the range). Exceptions that no longer match a generated occurrence are
 * ignored.
 */
function applyException(o: { start: Date; end: Date | null }, ex: OccurrenceException | undefined): ResolvedOccurrence {
  const modified = ex?.kind === "MODIFIED";
  const start = modified && ex.startTime ? ex.startTime : o.start;
  // A moved occurrence without an explicit end keeps the series duration.
  const end = modified
    ? (ex.endTime ?? (o.end ? new Date(o.end.getTime() + (start.getTime() - o.start.getTime())) : null))
    : o.end;
  return {
    originalStart: o.start,
    start,
    end,
    cancelled: ex?.kind === "CANCELLED",
    modified,
    title: modified ? ex.title : null,
    location: modified ? ex.location : null,
    meetingUrl: modified ? ex.meetingUrl : null,
  };
}

export function resolveOccurrences(
  event: RecurringEvent,
  exceptions: OccurrenceException[],
  rangeStart: Date,
  rangeEnd: Date,
  options: { includeCancelled?: boolean } = {},
): ResolvedOccurrence[] {
  const byStart = new Map(exceptions.map((e) => [e.originalStart.getTime(), e]));
  const recurring = event.recurrenceFrequency !== "NONE";
  const searchStart = recurring ? new Date(rangeStart.getTime() - SHIFT_MS) : rangeStart;
  const searchEnd = recurring ? new Date(rangeEnd.getTime() + SHIFT_MS) : rangeEnd;

  const result: ResolvedOccurrence[] = [];
  for (const o of expandOccurrences(event, searchStart, searchEnd)) {
    const resolved = applyException(o, recurring ? byStart.get(o.start.getTime()) : undefined);
    if (resolved.cancelled && !options.includeCancelled) continue;
    const spanEnd = resolved.end ?? resolved.start;
    if (!(resolved.start < rangeEnd && spanEnd >= rangeStart)) continue;
    result.push(resolved);
  }
  return result.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** One occurrence (by original start) with its exception applied, including a cancelled one; null if not a real occurrence. */
export function resolveSingleOccurrence(
  event: RecurringEvent,
  exceptions: OccurrenceException[],
  originalStart: Date,
): ResolvedOccurrence | null {
  if (event.recurrenceFrequency === "NONE") return null;
  const occurrence = findOccurrence(event, originalStart);
  if (!occurrence) return null;
  return applyException(
    occurrence,
    exceptions.find((e) => e.originalStart.getTime() === originalStart.getTime()),
  );
}

/**
 * After a whole-series edit, which existing exceptions still identify an
 * occurrence of the NEW series (kept) and which are orphaned (dropped).
 */
export function partitionExceptionsForSeries(
  nextSeries: RecurringEvent,
  exceptions: { id: string; originalStart: Date }[],
): { keep: string[]; drop: string[] } {
  const keep: string[] = [];
  const drop: string[] = [];
  for (const ex of exceptions) {
    if (nextSeries.recurrenceFrequency !== "NONE" && findOccurrence(nextSeries, ex.originalStart)) keep.push(ex.id);
    else drop.push(ex.id);
  }
  return { keep, drop };
}

export function occurrenceKey(eventId: string, originalStart: Date): string {
  return `${eventId}@${originalStart.toISOString()}`;
}

export function occurrenceHref(eventId: string, originalStart: Date | null): string {
  return originalStart
    ? `/calendar/events/${eventId}?occurrence=${encodeURIComponent(originalStart.toISOString())}`
    : `/calendar/events/${eventId}`;
}

/** Every distinct reminder offset (minutes) for an event: the primary `reminderMinutesBefore` plus extra offsets. */
export function allReminderOffsets(primary: number | null, extra: number[] | null | undefined): number[] {
  const set = new Set<number>(extra ?? []);
  if (primary !== null) set.add(primary);
  return [...set].filter((n) => Number.isInteger(n) && n >= 0).sort((a, b) => b - a);
}

/** True once the earliest reminder for an occurrence has opened and the occurrence hasn't started. */
export function reminderWindowOpen(start: Date, offsets: number[], now: Date): boolean {
  if (offsets.length === 0 || start < now) return false;
  return start.getTime() - Math.max(...offsets) * 60_000 <= now.getTime();
}
