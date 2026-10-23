import type { TimeActivityCategory } from "@prisma/client";
import { format, startOfWeek } from "date-fns";

/**
 * Pure time-tracking math (no I/O). Durations are stored as whole minutes.
 *
 * Rounding rule: a timer's elapsed seconds round to the *nearest* minute,
 * with a floor of 1 minute for any timer that ran at all — so a 20-second
 * timer records 1 minute rather than 0, and 90 seconds records 2. No
 * billing increment (e.g. 6-minute units) is applied: that's a billing
 * policy decision, and billing is out of scope (CLAUDE.md).
 */

export const MAX_ENTRY_MINUTES = 24 * 60;
/** A timer running longer than this is treated as probably forgotten/interrupted. */
export const LONG_TIMER_SECONDS = 12 * 60 * 60;

export function minutesBetween(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 60_000);
}

export function secondsToRecordedMinutes(seconds: number): number {
  if (seconds <= 0) return 0;
  return Math.max(1, Math.round(seconds / 60));
}

export function timerElapsedSeconds(
  timer: { accumulatedSeconds: number; runningSince: Date | null },
  now: Date = new Date(),
): number {
  const running = timer.runningSince ? Math.max(0, Math.floor((now.getTime() - timer.runningSince.getTime()) / 1000)) : 0;
  return timer.accumulatedSeconds + running;
}

export function isLongRunningTimer(elapsedSeconds: number): boolean {
  return elapsedSeconds > LONG_TIMER_SECONDS;
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function formatHours(minutes: number): string {
  return (minutes / 60).toFixed(2);
}

type Interval = { id: string; startedAt: Date | null; endedAt: Date | null };

/**
 * Pairs of a user's entries whose explicit start/end times overlap. Only
 * entries with both times can overlap (a duration-only entry has no
 * position in the day). Overlap is surfaced as a warning — two genuinely
 * concurrent activities can both be legitimate (e.g. a call during travel).
 */
export function findOverlaps(entries: Interval[]): [string, string][] {
  const timed = entries
    .filter((e): e is { id: string; startedAt: Date; endedAt: Date } => Boolean(e.startedAt && e.endedAt))
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  const pairs: [string, string][] = [];
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      if (timed[j]!.startedAt.getTime() >= timed[i]!.endedAt.getTime()) break;
      pairs.push([timed[i]!.id, timed[j]!.id]);
    }
  }
  return pairs;
}

export type SummarizableEntry = {
  userId: string;
  userName: string;
  matterId?: string;
  matterLabel?: string;
  workDate: Date;
  durationMinutes: number;
  billable: boolean;
  category: TimeActivityCategory;
  hourlyRateCents: number | null;
  voidedAt: Date | null;
  status?: string;
};

type Bucket = { key: string; label: string; minutes: number; billableMinutes: number };

export type TimeSummary = {
  totalMinutes: number;
  billableMinutes: number;
  nonbillableMinutes: number;
  entryCount: number;
  byUser: Bucket[];
  byCategory: Bucket[];
  byMatter: Bucket[];
  byWeek: Bucket[];
  byMonth: Bucket[];
  /** Present only when `includeAmounts` (ADMIN) — billable minutes × rate, for entries that have a rate. */
  billableAmountCents?: number;
};

function add(map: Map<string, Bucket>, key: string, label: string, minutes: number, billable: boolean) {
  const bucket = map.get(key) ?? { key, label, minutes: 0, billableMinutes: 0 };
  bucket.minutes += minutes;
  if (billable) bucket.billableMinutes += minutes;
  map.set(key, bucket);
}

/**
 * Totals over recorded entries. Voided entries and unconfirmed DRAFTs are
 * excluded — they are not recorded work. Nothing here estimates or infers
 * time: only what someone actually entered is summed.
 */
export function summarizeEntries(
  entries: SummarizableEntry[],
  options: { includeAmounts?: boolean; categoryLabel?: (c: TimeActivityCategory) => string } = {},
): TimeSummary {
  const counted = entries.filter((e) => !e.voidedAt && e.status !== "DRAFT");
  const byUser = new Map<string, Bucket>();
  const byCategory = new Map<string, Bucket>();
  const byMatter = new Map<string, Bucket>();
  const byWeek = new Map<string, Bucket>();
  const byMonth = new Map<string, Bucket>();
  let total = 0;
  let billable = 0;
  let amount = 0;

  for (const e of counted) {
    total += e.durationMinutes;
    if (e.billable) {
      billable += e.durationMinutes;
      if (e.hourlyRateCents) amount += Math.round((e.durationMinutes / 60) * e.hourlyRateCents);
    }
    add(byUser, e.userId, e.userName, e.durationMinutes, e.billable);
    add(byCategory, e.category, options.categoryLabel?.(e.category) ?? e.category, e.durationMinutes, e.billable);
    if (e.matterId) add(byMatter, e.matterId, e.matterLabel ?? e.matterId, e.durationMinutes, e.billable);
    const week = startOfWeek(e.workDate, { weekStartsOn: 1 });
    add(byWeek, format(week, "yyyy-MM-dd"), `Week of ${format(week, "MMM d, yyyy")}`, e.durationMinutes, e.billable);
    add(byMonth, format(e.workDate, "yyyy-MM"), format(e.workDate, "MMMM yyyy"), e.durationMinutes, e.billable);
  }

  const desc = (m: Map<string, Bucket>) => [...m.values()].sort((a, b) => b.minutes - a.minutes);
  const chrono = (m: Map<string, Bucket>) => [...m.values()].sort((a, b) => a.key.localeCompare(b.key));

  return {
    totalMinutes: total,
    billableMinutes: billable,
    nonbillableMinutes: total - billable,
    entryCount: counted.length,
    byUser: desc(byUser),
    byCategory: desc(byCategory),
    byMatter: desc(byMatter),
    byWeek: chrono(byWeek),
    byMonth: chrono(byMonth),
    ...(options.includeAmounts ? { billableAmountCents: amount } : {}),
  };
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
