/**
 * Time-zone math for the calendar using only the built-in Intl API (no new
 * dependency). Events are stored as UTC instants plus an IANA `timeZone`;
 * these helpers convert between an instant and the wall-clock time in a
 * zone, which is what recurrence and the day/week grids need so a weekly
 * 10:00 meeting stays at 10:00 across a DST change.
 */

/** The firm's display zone for the calendar grid and default for new events. */
export const FIRM_TIME_ZONE = "America/New_York";

export type WallTime = { year: number; month: number; day: number; hour: number; minute: number };

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string) {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock time of `date` in `timeZone`. */
export function toWallTime(date: Date, timeZone: string): WallTime {
  const parts = Object.fromEntries(partsFormatter(timeZone).formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  };
}

/** Offset of `timeZone` from UTC at `date`, in minutes (e.g. -240 for EDT). */
export function zoneOffsetMinutes(date: Date, timeZone: string): number {
  const w = toWallTime(date, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
  return Math.round((asUtc - Math.floor(date.getTime() / 60000) * 60000) / 60000);
}

/**
 * The UTC instant at which `timeZone`'s clocks read `wall`. Two passes
 * handle the offset changing between the guess and the answer (DST). A
 * wall time inside a spring-forward gap resolves to a nearby real instant.
 */
export function wallTimeToUtc(wall: WallTime, timeZone: string): Date {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  let guess = naive - zoneOffsetMinutes(new Date(naive), timeZone) * 60000;
  guess = naive - zoneOffsetMinutes(new Date(guess), timeZone) * 60000;
  return new Date(guess);
}

/** "yyyy-MM-dd" for a wall date. */
export function dateKey(wall: Pick<WallTime, "year" | "month" | "day">): string {
  return `${wall.year}-${String(wall.month).padStart(2, "0")}-${String(wall.day).padStart(2, "0")}`;
}

export function parseDateKey(key: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { year, month, day };
}

/** Calendar-date arithmetic on wall dates (independent of any zone). */
export function addDaysToKey(key: string, days: number): string {
  const d = parseDateKey(key)!;
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + days));
  return dateKey({ year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() });
}

/** 0 = Sunday. */
export function weekdayOfKey(key: string): number {
  const d = parseDateKey(key)!;
  return new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
}

/** Midnight at the start of wall date `key` in `timeZone`, as a UTC instant. */
export function startOfDayUtc(key: string, timeZone: string): Date {
  const d = parseDateKey(key)!;
  return wallTimeToUtc({ ...d, hour: 0, minute: 0 }, timeZone);
}

export function dateKeyInZone(date: Date, timeZone: string): string {
  return dateKey(toWallTime(date, timeZone));
}

/** "yyyy-MM-ddTHH:mm" for a `datetime-local` input showing `date` in `timeZone`. */
export function toDateTimeLocalInZone(date: Date, timeZone: string): string {
  const w = toWallTime(date, timeZone);
  return `${dateKey(w)}T${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`;
}

/** Parses a `datetime-local` value as wall time in `timeZone`. */
export function fromDateTimeLocalInZone(value: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const date = parseDateKey(`${match[1]}-${match[2]}-${match[3]}`);
  if (!date) return null;
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (hour > 23 || minute > 59) return null;
  return wallTimeToUtc({ ...date, hour, minute }, timeZone);
}

export function formatInZone(date: Date, timeZone: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, ...options }).format(date);
}

export function formatTimeInZone(date: Date, timeZone: string): string {
  return formatInZone(date, timeZone, { hour: "numeric", minute: "2-digit" });
}

/** Short zone label such as "EDT" for display next to times. */
export function zoneAbbreviation(date: Date, timeZone: string): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
    .formatToParts(date)
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? timeZone;
}

/** Zones offered in the event form; any valid IANA zone is accepted server-side. */
export const COMMON_TIME_ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "UTC",
] as const;
