import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { format } from "date-fns";

import { asCalendarDate } from "@/lib/matters/format";

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
