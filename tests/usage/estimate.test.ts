import { describe, expect, it } from "vitest";

import {
  dailyActiveMinutes,
  easternDay,
  estimateActiveMinutes,
  estimateIdleMinutes,
  findIdleGaps,
  formatMinutes,
  matterFocusedMinutes,
  sessionDurationMinutes,
} from "@/lib/usage/estimate";

const at = (iso: string) => new Date(iso);

describe("estimateActiveMinutes", () => {
  it("counts each minute once even when several tabs/devices beat in it", () => {
    const beats = [
      at("2026-10-01T14:00:05Z"), // tab A
      at("2026-10-01T14:00:40Z"), // tab B, same minute
      at("2026-10-01T14:01:10Z"),
      at("2026-10-01T14:01:59Z"), // phone, same minute
      at("2026-10-01T14:03:00Z"),
    ];
    expect(estimateActiveMinutes(beats)).toBe(3);
  });

  it("is zero with no heartbeats", () => {
    expect(estimateActiveMinutes([])).toBe(0);
  });
});

describe("findIdleGaps", () => {
  it("reports only gaps longer than the idle threshold", () => {
    const minutes = ["14:00", "14:01", "14:04", "14:20", "14:21"].map((t) => at(`2026-10-01T${t}:00Z`));
    const gaps = findIdleGaps(minutes, 5);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ minutes: 15, from: at("2026-10-01T14:05:00Z"), to: at("2026-10-01T14:20:00Z") });
  });
});

describe("session duration and idle estimate", () => {
  it("uses the end time when known, otherwise the last seen time", () => {
    const startedAt = at("2026-10-01T13:00:00Z");
    expect(sessionDurationMinutes({ startedAt, lastSeenAt: at("2026-10-01T14:00:00Z"), endedAt: null })).toBe(60);
    expect(
      sessionDurationMinutes({ startedAt, lastSeenAt: at("2026-10-01T14:00:00Z"), endedAt: at("2026-10-01T15:30:00Z") }),
    ).toBe(150);
  });

  it("never reports negative idle time", () => {
    expect(estimateIdleMinutes(60, 45)).toBe(15);
    expect(estimateIdleMinutes(10, 12)).toBe(0);
  });
});

describe("matterFocusedMinutes / daily totals", () => {
  it("counts only minutes that came from a matter page", () => {
    const totals = matterFocusedMinutes([{ matterId: "m1" }, { matterId: "m1" }, { matterId: null }, { matterId: "m2" }]);
    expect(Object.fromEntries(totals)).toEqual({ m1: 2, m2: 1 });
  });

  it("buckets by Eastern calendar day, not UTC", () => {
    // 02:30 UTC on Oct 2 is still Oct 1 in New York (EDT, UTC-4).
    expect(easternDay(at("2026-10-02T02:30:00Z"))).toBe("2026-10-01");
    const daily = dailyActiveMinutes([{ minute: at("2026-10-02T02:30:00Z") }, { minute: at("2026-10-02T15:00:00Z") }]);
    expect(Object.fromEntries(daily)).toEqual({ "2026-10-01": 1, "2026-10-02": 1 });
  });

  it("formats minutes", () => {
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(135)).toBe("2h 15m");
  });
});
