import { addDaysToKey, dateKeyInZone, parseDateKey, startOfDayUtc, weekdayOfKey } from "@/lib/calendar/timezone";

/**
 * Pure view-range math for the calendar grid. Everything is expressed as
 * wall dates ("yyyy-MM-dd") in the display zone and then converted to the
 * UTC instants a query needs, so a day in a DST-change week still spans
 * exactly that local day (23 or 25 hours).
 */

export const CALENDAR_VIEWS = ["month", "week", "day", "agenda"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

export const AGENDA_DAYS = 30;

export type ViewRange = {
  view: CalendarView;
  anchor: string;
  /** Wall dates displayed, in order (month: 6 full Sunday-first weeks). */
  days: string[];
  start: Date;
  end: Date;
  prev: string;
  next: string;
};

export function normalizeView(value: string | undefined): CalendarView {
  return (CALENDAR_VIEWS as readonly string[]).includes(value ?? "") ? (value as CalendarView) : "month";
}

export function normalizeAnchor(value: string | undefined, now: Date, timeZone: string): string {
  return value && parseDateKey(value) ? value : dateKeyInZone(now, timeZone);
}

function shiftMonth(key: string, months: number): string {
  const d = parseDateKey(key)!;
  const index = d.month - 1 + months;
  const year = d.year + Math.floor(index / 12);
  const month = (((index % 12) + 12) % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(d.day, last)).padStart(2, "0")}`;
}

function daysFrom(first: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDaysToKey(first, i));
}

export function getViewRange(view: CalendarView, anchor: string, timeZone: string): ViewRange {
  let days: string[];
  let prev: string;
  let next: string;
  if (view === "month") {
    const firstOfMonth = `${anchor.slice(0, 8)}01`;
    days = daysFrom(addDaysToKey(firstOfMonth, -weekdayOfKey(firstOfMonth)), 42);
    prev = shiftMonth(anchor, -1);
    next = shiftMonth(anchor, 1);
  } else if (view === "week") {
    days = daysFrom(addDaysToKey(anchor, -weekdayOfKey(anchor)), 7);
    prev = addDaysToKey(anchor, -7);
    next = addDaysToKey(anchor, 7);
  } else if (view === "day") {
    days = [anchor];
    prev = addDaysToKey(anchor, -1);
    next = addDaysToKey(anchor, 1);
  } else {
    days = daysFrom(anchor, AGENDA_DAYS);
    prev = addDaysToKey(anchor, -AGENDA_DAYS);
    next = addDaysToKey(anchor, AGENDA_DAYS);
  }
  return {
    view,
    anchor,
    days,
    start: startOfDayUtc(days[0]!, timeZone),
    end: startOfDayUtc(addDaysToKey(days[days.length - 1]!, 1), timeZone),
    prev,
    next,
  };
}
