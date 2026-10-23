import { describe, expect, it } from "vitest";

import {
  findOverlaps,
  formatMinutes,
  isLongRunningTimer,
  minutesBetween,
  secondsToRecordedMinutes,
  summarizeEntries,
  timerElapsedSeconds,
  type SummarizableEntry,
} from "@/lib/time/math";
import { readTimeEntryFields } from "@/lib/time/fields";

describe("duration math", () => {
  it("computes minutes between two times", () => {
    expect(minutesBetween(new Date("2026-10-01T09:00:00"), new Date("2026-10-01T10:45:00"))).toBe(105);
  });

  it("rounds timer seconds to the nearest minute with a 1-minute floor", () => {
    expect(secondsToRecordedMinutes(0)).toBe(0);
    expect(secondsToRecordedMinutes(20)).toBe(1);
    expect(secondsToRecordedMinutes(89)).toBe(1);
    expect(secondsToRecordedMinutes(90)).toBe(2);
    expect(secondsToRecordedMinutes(3600)).toBe(60);
  });

  it("adds the running segment to accumulated time, and ignores it when paused", () => {
    const now = new Date("2026-10-01T10:00:00Z");
    expect(timerElapsedSeconds({ accumulatedSeconds: 120, runningSince: new Date("2026-10-01T09:59:00Z") }, now)).toBe(180);
    expect(timerElapsedSeconds({ accumulatedSeconds: 120, runningSince: null }, now)).toBe(120);
  });

  it("flags timers over 12 hours as long-running", () => {
    expect(isLongRunningTimer(12 * 3600)).toBe(false);
    expect(isLongRunningTimer(12 * 3600 + 1)).toBe(true);
  });

  it("formats minutes", () => {
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(120)).toBe("2h");
    expect(formatMinutes(135)).toBe("2h 15m");
  });
});

describe("findOverlaps", () => {
  const t = (h: number, m = 0) => new Date(2026, 9, 1, h, m);
  it("finds overlapping timed entries and ignores duration-only and touching entries", () => {
    expect(
      findOverlaps([
        { id: "a", startedAt: t(9), endedAt: t(10) },
        { id: "b", startedAt: t(9, 30), endedAt: t(11) },
        { id: "c", startedAt: t(11), endedAt: t(12) },
        { id: "d", startedAt: null, endedAt: null },
      ]),
    ).toEqual([["a", "b"]]);
  });
});

describe("summarizeEntries", () => {
  const base: Omit<SummarizableEntry, "durationMinutes" | "billable" | "userId" | "userName"> = {
    workDate: new Date("2026-10-05T12:00:00"),
    category: "DRAFTING",
    hourlyRateCents: null,
    voidedAt: null,
    status: "SUBMITTED",
  };
  const entries: SummarizableEntry[] = [
    { ...base, userId: "u1", userName: "Jane Doe", durationMinutes: 90, billable: true, hourlyRateCents: 20_000 },
    { ...base, userId: "u2", userName: "John Roe", durationMinutes: 30, billable: false, category: "ADMINISTRATIVE" },
    { ...base, userId: "u1", userName: "Jane Doe", durationMinutes: 600, billable: true, voidedAt: new Date() },
    { ...base, userId: "u1", userName: "Jane Doe", durationMinutes: 45, billable: true, status: "DRAFT" },
  ];

  it("totals only recorded entries (excludes voided and unconfirmed drafts)", () => {
    const s = summarizeEntries(entries);
    expect([s.totalMinutes, s.billableMinutes, s.nonbillableMinutes, s.entryCount]).toEqual([120, 90, 30, 2]);
    expect(s.byUser.map((b) => [b.label, b.minutes, b.billableMinutes])).toEqual([
      ["Jane Doe", 90, 90],
      ["John Roe", 30, 0],
    ]);
    expect(s.byCategory.map((b) => b.key)).toEqual(["DRAFTING", "ADMINISTRATIVE"]);
    expect(s.byMonth.map((b) => [b.key, b.minutes])).toEqual([["2026-10", 120]]);
  });

  it("computes amounts only when asked (ADMIN), from billable rated entries", () => {
    expect(summarizeEntries(entries).billableAmountCents).toBeUndefined();
    expect(summarizeEntries(entries, { includeAmounts: true }).billableAmountCents).toBe(30_000);
  });
});

describe("readTimeEntryFields", () => {
  function fd(fields: Record<string, string>) {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  }
  const valid = { matterId: "m-1", workDate: "2026-10-05", category: "DRAFTING", description: "Drafted motion (fictional)" };

  it("accepts hours + minutes", () => {
    const r = readTimeEntryFields(fd({ ...valid, hours: "1", minutes: "30", billable: "on" }));
    expect(r.success && [r.data.durationMinutes, r.data.billable]).toEqual([90, true]);
  });

  it("prefers start/end times when both are given", () => {
    const r = readTimeEntryFields(fd({ ...valid, hours: "5", startTime: "09:00", endTime: "09:45" }));
    expect(r.success && r.data.durationMinutes).toBe(45);
  });

  it("rejects zero, over-24-hour, and backwards durations", () => {
    expect(readTimeEntryFields(fd({ ...valid })).success).toBe(false);
    expect(readTimeEntryFields(fd({ ...valid, hours: "25" })).success).toBe(false);
    expect(readTimeEntryFields(fd({ ...valid, startTime: "10:00", endTime: "09:00" })).success).toBe(false);
  });

  it("requires a description and a valid category", () => {
    expect(readTimeEntryFields(fd({ ...valid, description: " ", hours: "1" })).success).toBe(false);
    expect(readTimeEntryFields(fd({ ...valid, category: "NAPPING", hours: "1" })).success).toBe(false);
  });

  it("parses a dollar rate into cents", () => {
    const r = readTimeEntryFields(fd({ ...valid, hours: "1", hourlyRate: "250.50" }));
    expect(r.success && r.data.hourlyRateCents).toBe(25_050);
  });
});
