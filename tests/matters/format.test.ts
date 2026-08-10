import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { format } from "date-fns";

import { asCalendarDate, todayAsStoredDate } from "@/lib/matters/format";

/**
 * Regression coverage for the off-by-one-day bug: Deadline.date, Task.dueDate,
 * Matter.openedDate/closedDate, Client.dateOfBirth, and
 * DiscoveryProduction.receivedDate are all written from a `<input
 * type="date">` value via `new Date("2026-08-10")`, which parses as UTC
 * midnight. Formatting that instant in a time zone behind UTC previously
 * rendered the previous day. These tests force the process into such a zone
 * so the bug would actually reproduce if the fix regressed.
 */
describe("asCalendarDate", () => {
  const originalTZ = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = "America/New_York";
  });

  afterAll(() => {
    process.env.TZ = originalTZ;
  });

  it.each(["2026-08-10", "2026-08-26"])(
    "renders %s as the same calendar date after the UTC-midnight round trip",
    (selected) => {
      const storedAsUtcMidnight = new Date(selected);
      expect(format(asCalendarDate(storedAsUtcMidnight), "yyyy-MM-dd")).toBe(selected);
    },
  );

  it("documents the bug this fixes: formatting the raw stored instant shifts a day back", () => {
    const storedAsUtcMidnight = new Date("2026-08-10");
    expect(format(storedAsUtcMidnight, "yyyy-MM-dd")).toBe("2026-08-09");
  });

  it("keeps a year-boundary date on the same calendar day", () => {
    const storedAsUtcMidnight = new Date("2025-12-31");
    expect(format(asCalendarDate(storedAsUtcMidnight), "yyyy-MM-dd")).toBe("2025-12-31");
  });
});

/**
 * Regression coverage for the second half of the same bug family: "upcoming"/
 * "overdue" queries that compared a date-only column directly against
 * `new Date()` treated an item due *today* as already past for most of the
 * local day in any time zone behind UTC, because the stored value is UTC
 * midnight while the current instant has already advanced hours into that
 * UTC day. `todayAsStoredDate` re-encodes "now" the same way the column was
 * written so `gte`/`lt` comparisons line up with the stored value.
 */
describe("todayAsStoredDate", () => {
  const originalTZ = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = "America/New_York";
  });

  afterAll(() => {
    process.env.TZ = originalTZ;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("anchors to today's UTC midnight even well into the local business day (the time-of-day that exposed the bug)", () => {
    // 9:00 AM Eastern on Aug 10 is 13:00 UTC on Aug 10 — long past the UTC
    // midnight instant a same-day deadline/task is stored as, which is
    // exactly the window the old `gte: new Date()` comparison got wrong.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T13:00:00.000Z"));

    expect(todayAsStoredDate()).toEqual(new Date("2026-08-10T00:00:00.000Z"));
  });

  it("matches a same-day deadline's stored value exactly, so it is neither before nor after 'today'", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T13:00:00.000Z"));

    const dueToday = new Date("2026-08-10");
    expect(dueToday >= todayAsStoredDate()).toBe(true);
    expect(dueToday < todayAsStoredDate()).toBe(false);
  });

  it("documents the bug this fixes: comparing the stored value against the raw instant wrongly excludes 'due today'", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T13:00:00.000Z"));

    const dueToday = new Date("2026-08-10");
    expect(dueToday >= new Date()).toBe(false);
  });
});
