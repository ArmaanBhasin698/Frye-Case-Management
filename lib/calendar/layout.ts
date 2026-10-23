import { dateKeyInZone, startOfDayUtc, addDaysToKey } from "@/lib/calendar/timezone";

/**
 * Pure placement of calendar items onto grid days and onto the hour grid of
 * the week/day views. Everything is computed in the display zone.
 */

type Spanning = { start: Date; end: Date | null; allDay: boolean };

/** Wall dates (in `timeZone`) an item covers; an item ending exactly at midnight doesn't spill into the next day. */
export function dayKeysFor(item: Spanning, timeZone: string): string[] {
  const first = dateKeyInZone(item.start, timeZone);
  if (!item.end || item.end <= item.start) return [first];
  const last = dateKeyInZone(new Date(item.end.getTime() - 1), timeZone);
  const keys = [first];
  let key = first;
  while (key < last && keys.length < 62) {
    key = addDaysToKey(key, 1);
    keys.push(key);
  }
  return keys;
}

export function itemsByDay<T extends Spanning>(items: T[], days: string[], timeZone: string): Map<string, T[]> {
  const byDay = new Map<string, T[]>(days.map((d) => [d, []]));
  for (const item of items) {
    for (const key of dayKeysFor(item, timeZone)) byDay.get(key)?.push(item);
  }
  return byDay;
}

/** True when the item should sit in the all-day strip rather than the hour grid. */
export function isAllDayLike(item: Spanning, timeZone: string): boolean {
  return item.allDay || dayKeysFor(item, timeZone).length > 1;
}

export type PlacedItem<T> = { item: T; topMinutes: number; durationMinutes: number; lane: number; lanes: number };

const MIN_DURATION_MINUTES = 30;

/**
 * Positions timed items within one wall day: minutes from local midnight,
 * clipped to the day, with overlapping items split into side-by-side lanes.
 */
export function layoutTimedItems<T extends Spanning>(items: T[], dayKey: string, timeZone: string): PlacedItem<T>[] {
  const dayStart = startOfDayUtc(dayKey, timeZone).getTime();
  const dayEnd = startOfDayUtc(addDaysToKey(dayKey, 1), timeZone).getTime();
  const dayMinutes = (dayEnd - dayStart) / 60_000;

  const placed = items
    .map((item) => {
      const start = Math.max(item.start.getTime(), dayStart);
      const rawEnd = item.end ? item.end.getTime() : item.start.getTime() + MIN_DURATION_MINUTES * 60_000;
      const end = Math.min(Math.max(rawEnd, start + MIN_DURATION_MINUTES * 60_000), dayEnd);
      const topMinutes = Math.min((start - dayStart) / 60_000, dayMinutes - MIN_DURATION_MINUTES);
      return { item, topMinutes, durationMinutes: Math.max((end - start) / 60_000, MIN_DURATION_MINUTES), lane: 0, lanes: 1 };
    })
    .sort((a, b) => a.topMinutes - b.topMinutes || b.durationMinutes - a.durationMinutes);

  // Greedy lane assignment within clusters of mutually overlapping items.
  let cluster: typeof placed = [];
  let clusterEnd = -1;
  const laneEnds: number[] = [];
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((p) => p.lane + 1));
    for (const p of cluster) p.lanes = lanes;
    cluster = [];
    laneEnds.length = 0;
  };
  for (const p of placed) {
    if (p.topMinutes >= clusterEnd && cluster.length > 0) flush();
    let lane = laneEnds.findIndex((end) => end <= p.topMinutes);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = p.topMinutes + p.durationMinutes;
    p.lane = lane;
    cluster.push(p);
    clusterEnd = Math.max(clusterEnd, p.topMinutes + p.durationMinutes);
  }
  if (cluster.length > 0) flush();
  return placed;
}
