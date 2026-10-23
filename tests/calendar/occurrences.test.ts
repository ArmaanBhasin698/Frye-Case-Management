import { describe, expect, it } from "vitest";

import {
  allReminderOffsets,
  findOccurrence,
  occurrenceHref,
  occurrenceKey,
  partitionExceptionsForSeries,
  reminderWindowOpen,
  resolveOccurrences,
  resolveSingleOccurrence,
  type OccurrenceException,
} from "@/lib/calendar/occurrences";
import { readEventForm, readOccurrenceForm } from "@/lib/calendar/fields";
import type { RecurringEvent } from "@/lib/calendar/recurrence";

// Weekly Monday 10:00 America/New_York, starting Oct 19 2026 (EDT). US DST
// ends Nov 1 2026, so Nov 2 10:00 local is 15:00Z instead of 14:00Z.
const weekly: RecurringEvent = {
  startTime: new Date("2026-10-19T14:00:00Z"),
  endTime: new Date("2026-10-19T15:00:00Z"),
  timeZone: "America/New_York",
  recurrenceFrequency: "WEEKLY",
  recurrenceInterval: 1,
  recurrenceUntil: null,
  recurrenceCount: 10,
};
const OCT26 = new Date("2026-10-26T14:00:00Z");
const NOV2 = new Date("2026-11-02T15:00:00Z");
const NOV9 = new Date("2026-11-09T15:00:00Z");

function ex(partial: Partial<OccurrenceException> & Pick<OccurrenceException, "originalStart" | "kind">): OccurrenceException {
  return { startTime: null, endTime: null, title: null, location: null, meetingUrl: null, ...partial };
}

function fd(fields: Record<string, string | string[]>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}

describe("occurrence identity", () => {
  it("accepts only instants the series actually generates (DST-aware)", () => {
    expect(findOccurrence(weekly, NOV2)).toEqual({ start: NOV2, end: new Date("2026-11-02T16:00:00Z") });
    // Same wall time but the pre-DST UTC offset — not a real occurrence.
    expect(findOccurrence(weekly, new Date("2026-11-02T14:00:00Z"))).toBeNull();
    expect(findOccurrence(weekly, new Date("2026-10-27T14:00:00Z"))).toBeNull();
    expect(findOccurrence(weekly, new Date("not a date"))).toBeNull();
    // Beyond recurrenceCount (10 occurrences → last is Dec 21).
    expect(findOccurrence(weekly, new Date("2026-12-28T15:00:00Z"))).toBeNull();
  });

  it("builds stable keys and links from the original start", () => {
    expect(occurrenceKey("ev-1", NOV2)).toBe("ev-1@2026-11-02T15:00:00.000Z");
    expect(occurrenceHref("ev-1", NOV2)).toBe("/calendar/events/ev-1?occurrence=2026-11-02T15%3A00%3A00.000Z");
    expect(occurrenceHref("ev-1", null)).toBe("/calendar/events/ev-1");
  });
});

describe("resolveOccurrences", () => {
  const range = { start: new Date("2026-10-25T00:00:00Z"), end: new Date("2026-11-15T00:00:00Z") };

  it("hides a cancelled occurrence unless cancelled items are requested", () => {
    const exceptions = [ex({ originalStart: OCT26, kind: "CANCELLED" })];
    expect(resolveOccurrences(weekly, exceptions, range.start, range.end).map((o) => o.start)).toEqual([NOV2, NOV9]);
    const withCancelled = resolveOccurrences(weekly, exceptions, range.start, range.end, { includeCancelled: true });
    expect(withCancelled[0]).toMatchObject({ originalStart: OCT26, cancelled: true });
  });

  it("moves a modified occurrence across the DST boundary, keeping duration and original identity", () => {
    const moved = new Date("2026-11-03T16:00:00Z"); // Tue 11:00 EST
    const exceptions = [ex({ originalStart: NOV2, kind: "MODIFIED", startTime: moved, title: "Moved prep" })];
    const result = resolveOccurrences(weekly, exceptions, range.start, range.end);
    const changed = result.find((o) => o.originalStart.getTime() === NOV2.getTime())!;
    expect(changed).toMatchObject({ start: moved, end: new Date("2026-11-03T17:00:00Z"), modified: true, title: "Moved prep" });
    expect(result.map((o) => o.start.toISOString())).toEqual([OCT26.toISOString(), moved.toISOString(), NOV9.toISOString()]);
  });

  it("finds an occurrence moved INTO the range from outside it, and drops one moved out", () => {
    const into = [ex({ originalStart: NOV9, kind: "MODIFIED", startTime: new Date("2026-11-04T15:00:00Z") })];
    const window = { start: new Date("2026-11-04T00:00:00Z"), end: new Date("2026-11-05T00:00:00Z") };
    expect(resolveOccurrences(weekly, into, window.start, window.end).map((o) => o.originalStart)).toEqual([NOV9]);

    const out = [ex({ originalStart: NOV2, kind: "MODIFIED", startTime: new Date("2026-11-20T15:00:00Z") })];
    expect(resolveOccurrences(weekly, out, range.start, range.end).map((o) => o.originalStart)).toEqual([OCT26, NOV9]);
  });

  it("ignores exceptions that don't match a generated occurrence", () => {
    const stray = [ex({ originalStart: new Date("2026-10-27T14:00:00Z"), kind: "CANCELLED" })];
    expect(resolveOccurrences(weekly, stray, range.start, range.end)).toHaveLength(3);
  });

  it("resolves a single occurrence, including a cancelled one, and rejects forged starts", () => {
    const exceptions = [ex({ originalStart: OCT26, kind: "CANCELLED" })];
    expect(resolveSingleOccurrence(weekly, exceptions, OCT26)).toMatchObject({ cancelled: true });
    expect(resolveSingleOccurrence(weekly, exceptions, new Date("2026-10-26T13:00:00Z"))).toBeNull();
    expect(resolveSingleOccurrence({ ...weekly, recurrenceFrequency: "NONE" }, [], weekly.startTime)).toBeNull();
  });
});

describe("whole-series edits", () => {
  const exceptions = [
    { id: "x-oct26", originalStart: OCT26 },
    { id: "x-nov2", originalStart: NOV2 },
  ];

  it("keeps exceptions whose original start is still in the new series and drops orphans", () => {
    expect(partitionExceptionsForSeries({ ...weekly, title: "renamed" } as RecurringEvent, exceptions)).toEqual({
      keep: ["x-oct26", "x-nov2"],
      drop: [],
    });
    // Every other week from Oct 19 → Oct 26 is no longer an occurrence, Nov 2 still is.
    expect(partitionExceptionsForSeries({ ...weekly, recurrenceInterval: 2 }, exceptions)).toEqual({
      keep: ["x-nov2"],
      drop: ["x-oct26"],
    });
    // Moving the series' time orphans everything.
    expect(
      partitionExceptionsForSeries(
        { ...weekly, startTime: new Date("2026-10-19T15:00:00Z"), endTime: new Date("2026-10-19T16:00:00Z") },
        exceptions,
      ).drop,
    ).toEqual(["x-oct26", "x-nov2"]);
    // No longer recurring → no occurrences to except.
    expect(partitionExceptionsForSeries({ ...weekly, recurrenceFrequency: "NONE" }, exceptions).drop).toHaveLength(2);
  });
});

describe("reminder offsets", () => {
  it("merges the primary reminder with additional offsets, de-duplicated, largest first", () => {
    expect(allReminderOffsets(60, [1440, 60, 15])).toEqual([1440, 60, 15]);
    expect(allReminderOffsets(null, [])).toEqual([]);
    expect(allReminderOffsets(null, null)).toEqual([]);
  });

  it("opens the reminder window at the largest offset and closes once the occurrence starts", () => {
    const start = new Date("2026-11-02T15:00:00Z");
    expect(reminderWindowOpen(start, [15], new Date("2026-11-02T14:30:00Z"))).toBe(false);
    expect(reminderWindowOpen(start, [15, 1440], new Date("2026-11-02T14:30:00Z"))).toBe(true);
    expect(reminderWindowOpen(start, [1440], new Date("2026-11-02T15:01:00Z"))).toBe(false);
    expect(reminderWindowOpen(start, [], new Date("2026-11-02T14:59:00Z"))).toBe(false);
  });

  it("parses additional offsets from the event form, excluding the primary and rejecting unknown values", () => {
    const base = { title: "Prep", type: "CLIENT_MEETING", timeZone: "America/New_York", start: "2026-10-26T10:00" };
    const parsed = readEventForm(fd({ ...base, reminderMinutesBefore: "60", reminderOffsetsMinutes: ["1440", "60", "15", "1440"] }));
    expect(parsed.ok && parsed.data.reminderOffsetsMinutes).toEqual([15, 1440]);
    expect(parsed.ok && parsed.data.reminderMinutesBefore).toBe(60);
    expect(readEventForm(fd({ ...base, reminderOffsetsMinutes: ["7"] })).ok).toBe(false);
  });
});

describe("occurrence form", () => {
  const series = { allDay: false, timeZone: "America/New_York" };

  it("parses an edit in the series' zone and validates the meeting link", () => {
    const ok = readOccurrenceForm(fd({ start: "2026-11-03T11:00", end: "2026-11-03T12:00", title: "Moved" }), series, NOV2, 31);
    expect(ok.ok && ok.data).toMatchObject({
      startTime: new Date("2026-11-03T16:00:00Z"),
      endTime: new Date("2026-11-03T17:00:00Z"),
      title: "Moved",
      location: null,
    });
    expect(readOccurrenceForm(fd({ start: "2026-11-03T11:00", meetingUrl: "javascript:alert(1)" }), series, NOV2, 31).ok).toBe(false);
    expect(readOccurrenceForm(fd({ start: "2026-11-03T11:00", end: "2026-11-03T10:00" }), series, NOV2, 31).ok).toBe(false);
  });

  it("refuses moving an occurrence beyond the maximum shift", () => {
    const result = readOccurrenceForm(fd({ start: "2026-12-20T10:00" }), series, NOV2, 31);
    expect(result).toEqual({ ok: false, error: "An occurrence can move at most 31 days — edit the series instead." });
  });
});
