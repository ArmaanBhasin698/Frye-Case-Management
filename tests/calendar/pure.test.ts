import { describe, expect, it } from "vitest";

import { expandOccurrences, describeRecurrence, MAX_OCCURRENCES, type RecurringEvent } from "@/lib/calendar/recurrence";
import { getViewRange, normalizeAnchor, normalizeView } from "@/lib/calendar/range";
import {
  addDaysToKey,
  dateKeyInZone,
  formatTimeInZone,
  fromDateTimeLocalInZone,
  parseDateKey,
  startOfDayUtc,
  toDateTimeLocalInZone,
  wallTimeToUtc,
  zoneAbbreviation,
} from "@/lib/calendar/timezone";
import { validateMeetingUrl } from "@/lib/calendar/meeting-url";
import { dayKeysFor, layoutTimedItems } from "@/lib/calendar/layout";
import { readEventForm } from "@/lib/calendar/fields";

const NY = "America/New_York";

describe("timezone helpers", () => {
  it("converts wall time to UTC on both sides of the 2026 DST change", () => {
    // EDT (UTC-4) before Nov 1 2026, EST (UTC-5) after.
    expect(wallTimeToUtc({ year: 2026, month: 10, day: 30, hour: 10, minute: 0 }, NY).toISOString()).toBe("2026-10-30T14:00:00.000Z");
    expect(wallTimeToUtc({ year: 2026, month: 11, day: 2, hour: 10, minute: 0 }, NY).toISOString()).toBe("2026-11-02T15:00:00.000Z");
  });

  it("round-trips datetime-local values in the event's zone", () => {
    const utc = fromDateTimeLocalInZone("2026-10-23T14:30", "America/Los_Angeles")!;
    expect(utc.toISOString()).toBe("2026-10-23T21:30:00.000Z");
    expect(toDateTimeLocalInZone(utc, "America/Los_Angeles")).toBe("2026-10-23T14:30");
    expect(formatTimeInZone(utc, NY)).toBe("5:30 PM");
    expect(zoneAbbreviation(utc, NY)).toBe("EDT");
  });

  it("rejects malformed or impossible dates", () => {
    expect(fromDateTimeLocalInZone("2026-02-30T10:00", NY)).toBeNull();
    expect(fromDateTimeLocalInZone("not a date", NY)).toBeNull();
    expect(parseDateKey("2026-13-01")).toBeNull();
  });

  it("gives the DST-change day its real length (25 hours on fall-back)", () => {
    const length = startOfDayUtc("2026-11-02", NY).getTime() - startOfDayUtc("2026-11-01", NY).getTime();
    expect(length / 3_600_000).toBe(25);
  });
});

describe("expandOccurrences", () => {
  const weekly: RecurringEvent = {
    startTime: wallTimeToUtc({ year: 2026, month: 10, day: 19, hour: 10, minute: 0 }, NY),
    endTime: wallTimeToUtc({ year: 2026, month: 10, day: 19, hour: 11, minute: 0 }, NY),
    timeZone: NY,
    recurrenceFrequency: "WEEKLY",
    recurrenceInterval: 1,
    recurrenceUntil: null,
    recurrenceCount: null,
  };

  it("keeps a weekly meeting at 10:00 local across the DST change", () => {
    const occ = expandOccurrences(weekly, new Date("2026-10-18T00:00Z"), new Date("2026-11-15T00:00Z"));
    expect(occ.map((o) => formatTimeInZone(o.start, NY))).toEqual(["10:00 AM", "10:00 AM", "10:00 AM", "10:00 AM"]);
    expect(occ[2]!.start.toISOString()).toBe("2026-11-02T15:00:00.000Z");
    expect(occ.every((o) => o.end!.getTime() - o.start.getTime() === 3_600_000)).toBe(true);
  });

  it("honours interval, count, and until", () => {
    const range = [new Date("2026-01-01T00:00Z"), new Date("2027-12-31T00:00Z")] as const;
    expect(expandOccurrences({ ...weekly, recurrenceInterval: 2, recurrenceCount: 3 }, ...range).map((o) => dateKeyInZone(o.start, NY))).toEqual([
      "2026-10-19",
      "2026-11-02",
      "2026-11-16",
    ]);
    const until = expandOccurrences({ ...weekly, recurrenceFrequency: "DAILY", recurrenceUntil: new Date("2026-10-22T00:00Z") }, ...range);
    expect(until).toHaveLength(3);
  });

  it("clamps monthly recurrences on the 31st to shorter months", () => {
    const monthly = { ...weekly, startTime: wallTimeToUtc({ year: 2026, month: 1, day: 31, hour: 9, minute: 0 }, NY), endTime: null, recurrenceFrequency: "MONTHLY" as const, recurrenceCount: 3 };
    expect(expandOccurrences(monthly, new Date("2026-01-01Z"), new Date("2027-01-01Z")).map((o) => dateKeyInZone(o.start, NY))).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
    ]);
  });

  it("caps an endless series", () => {
    const daily = { ...weekly, recurrenceFrequency: "DAILY" as const };
    expect(expandOccurrences(daily, new Date("2026-01-01Z"), new Date("2030-01-01Z"))).toHaveLength(MAX_OCCURRENCES);
  });

  it("returns a non-recurring event only when it overlaps the range", () => {
    const single = { ...weekly, recurrenceFrequency: "NONE" as const };
    expect(expandOccurrences(single, new Date("2026-10-19T14:30Z"), new Date("2026-10-20Z"))).toHaveLength(1);
    expect(expandOccurrences(single, new Date("2026-10-20Z"), new Date("2026-10-21Z"))).toHaveLength(0);
  });

  it("describes the rule", () => {
    expect(describeRecurrence({ ...weekly, recurrenceInterval: 2, recurrenceCount: 4 })).toBe("Every 2 weeks, 4 times");
    expect(describeRecurrence({ ...weekly, recurrenceFrequency: "NONE" })).toBeNull();
  });
});

describe("view ranges", () => {
  it("builds a 6-week Sunday-first month grid and month navigation", () => {
    const r = getViewRange("month", "2026-10-23", NY);
    expect(r.days).toHaveLength(42);
    expect(r.days[0]).toBe("2026-09-27");
    expect(r.prev).toBe("2026-09-23");
    expect(r.next).toBe("2026-11-23");
    expect(r.start.toISOString()).toBe("2026-09-27T04:00:00.000Z");
  });

  it("spans the DST week correctly and steps by 7 days", () => {
    const r = getViewRange("week", "2026-11-04", NY);
    expect(r.days).toEqual(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"]);
    expect((r.end.getTime() - r.start.getTime()) / 3_600_000).toBe(7 * 24 + 1);
    expect(r.prev).toBe("2026-10-28");
  });

  it("day and agenda views", () => {
    expect(getViewRange("day", "2026-12-31", NY).next).toBe("2027-01-01");
    expect(getViewRange("agenda", "2026-10-23", NY).days).toHaveLength(30);
  });

  it("normalizes untrusted params", () => {
    expect(normalizeView("year")).toBe("month");
    expect(normalizeAnchor("2026-02-31", new Date("2026-10-23T12:00Z"), NY)).toBe("2026-10-23");
    expect(addDaysToKey("2026-02-28", 1)).toBe("2026-03-01");
  });
});

describe("validateMeetingUrl", () => {
  it.each([
    ["https://zoom.us/j/123456789", "ZOOM"],
    ["https://example.zoom.us/j/1", "ZOOM"],
    ["https://teams.microsoft.com/l/meetup-join/abc", "MICROSOFT_TEAMS"],
    ["https://teams.live.com/meet/1", "MICROSOFT_TEAMS"],
    ["https://meet.google.com/abc-defg-hij", "GOOGLE_MEET"],
    ["https://firm.webex.com/meet/x", "WEBEX"],
    ["https://video.example.org/room/1", "OTHER"],
  ])("accepts %s as %s", (url, provider) => {
    expect(validateMeetingUrl(url)).toMatchObject({ ok: true, provider });
  });

  it.each([
    "http://zoom.us/j/1",
    "javascript:alert(1)",
    "data:text/html,hi",
    "https://user:pass@zoom.us/j/1",
    "https://localhost/meet",
    "zoom.us/j/1",
    `https://zoom.us/${"a".repeat(2_100)}`,
  ])("rejects %s", (url) => {
    expect(validateMeetingUrl(url).ok).toBe(false);
  });

  it("doesn't recognize look-alike hosts as a provider", () => {
    expect(validateMeetingUrl("https://zoom.us.evil.example/j/1")).toMatchObject({ ok: true, provider: "OTHER" });
    expect(validateMeetingUrl("https://notzoom.us/j/1")).toMatchObject({ ok: true, provider: "OTHER" });
  });
});

describe("layout", () => {
  it("doesn't spill an all-day item ending at midnight into the next day", () => {
    const item = { start: startOfDayUtc("2026-10-23", NY), end: startOfDayUtc("2026-10-24", NY), allDay: true };
    expect(dayKeysFor(item, NY)).toEqual(["2026-10-23"]);
  });

  it("splits overlapping timed items into lanes", () => {
    const at = (h: number) => wallTimeToUtc({ year: 2026, month: 10, day: 23, hour: h, minute: 0 }, NY);
    const placed = layoutTimedItems(
      [
        { start: at(9), end: at(11), allDay: false },
        { start: at(10), end: at(12), allDay: false },
        { start: at(14), end: at(15), allDay: false },
      ],
      "2026-10-23",
      NY,
    );
    expect(placed.map((p) => [p.topMinutes, p.lane, p.lanes])).toEqual([
      [540, 0, 2],
      [600, 1, 2],
      [840, 0, 1],
    ]);
  });
});

describe("readEventForm", () => {
  function fd(fields: Record<string, string | string[]>) {
    const formData = new FormData();
    for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) formData.append(k, x);
    return formData;
  }
  const base = { title: "Plea conference", type: "VIRTUAL_MEETING", timeZone: NY, start: "2026-10-26T10:00", end: "2026-10-26T11:00" };

  it("converts wall times in the chosen zone and detects the meeting provider", () => {
    const r = readEventForm(fd({ ...base, meetingUrl: "https://meet.google.com/abc-defg-hij" }));
    expect(r.ok && r.data.startTime.toISOString()).toBe("2026-10-26T14:00:00.000Z");
    expect(r.ok && r.data.meetingProvider).toBe("GOOGLE_MEET");
  });

  it("rejects an unsafe meeting link, a bad zone, and an end before start", () => {
    expect(readEventForm(fd({ ...base, meetingUrl: "javascript:alert(1)" })).ok).toBe(false);
    expect(readEventForm(fd({ ...base, timeZone: "Mars/Olympus" })).ok).toBe(false);
    expect(readEventForm(fd({ ...base, end: "2026-10-26T09:00" })).ok).toBe(false);
  });

  it("stores all-day events as whole local days", () => {
    const r = readEventForm(fd({ ...base, allDay: "on", start: "2026-10-26", end: "2026-10-27" }));
    expect(r.ok && [r.data.startTime.toISOString(), r.data.endTime!.toISOString()]).toEqual([
      "2026-10-26T04:00:00.000Z",
      "2026-10-28T04:00:00.000Z",
    ]);
  });

  it("drops recurrence fields for a one-off event and validates the until date", () => {
    const one = readEventForm(fd({ ...base, recurrenceCount: "5" }));
    expect(one.ok && one.data.recurrenceCount).toBeNull();
    expect(readEventForm(fd({ ...base, recurrenceFrequency: "WEEKLY", recurrenceUntil: "2026-10-01" })).ok).toBe(false);
  });
});
