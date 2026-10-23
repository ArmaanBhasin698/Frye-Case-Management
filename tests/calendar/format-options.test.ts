import { describe, expect, it } from "vitest";

import { DATE_TIME_WITH_ZONE, formatInZone } from "@/lib/calendar/timezone";

// Uses the real Intl implementation (no mocks): the combination
// dateStyle/timeStyle + timeZoneName throws at runtime, which mocked page
// tests can't catch.
describe("zone-labelled date formatting", () => {
  it("formats with a zone abbreviation without throwing", () => {
    const text = formatInZone(new Date("2026-03-08T15:30:00Z"), "America/New_York", DATE_TIME_WITH_ZONE);
    expect(text).toMatch(/Mar 8, 2026/);
    expect(text).toMatch(/11:30/);
    expect(text).toMatch(/EDT/);
  });

  it("documents why: the style shorthand cannot be combined with timeZoneName", () => {
    expect(() =>
      new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZoneName: "short" }).format(new Date()),
    ).toThrow();
  });
});
