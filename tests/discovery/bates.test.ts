import { describe, expect, it } from "vitest";

import {
  computeBatesRange,
  formatBatesLabel,
  formatBatesRange,
  formatEvidenceIdentifier,
  nextBatesStart,
} from "@/lib/discovery/bates";

describe("formatBatesLabel", () => {
  it("pads to 6 digits", () => {
    expect(formatBatesLabel("ELLIS", 1)).toBe("ELLIS000001");
    expect(formatBatesLabel("ELLIS", 84)).toBe("ELLIS000084");
    expect(formatBatesLabel("ELLIS", 123456)).toBe("ELLIS123456");
  });
});

describe("formatBatesRange", () => {
  it("collapses to a single label when start equals end", () => {
    expect(formatBatesRange("ELLIS", 5, 5)).toBe("ELLIS000005");
  });

  it("shows a range when the file spans multiple pages", () => {
    expect(formatBatesRange("ELLIS", 1, 4)).toBe("ELLIS000001-ELLIS000004");
  });
});

describe("nextBatesStart", () => {
  it("starts at the production's configured start number when nothing is numbered yet", () => {
    expect(nextBatesStart([], 1)).toBe(1);
    expect(nextBatesStart([], 85)).toBe(85);
  });

  it("defaults to 1 when the production has no configured start either", () => {
    expect(nextBatesStart([], null)).toBe(1);
  });

  it("continues from one past the highest existing end, regardless of production start", () => {
    expect(nextBatesStart([12], 1)).toBe(13);
    expect(nextBatesStart([12, 4, 20], 1)).toBe(21);
  });

  it("sequences correctly across three files registered in order", () => {
    // File A: 12 pages starting at 1 -> ends at 12.
    const afterA = computeBatesRange(nextBatesStart([], 1), 12);
    expect(afterA).toEqual({ start: 1, end: 12 });

    // File B: 4 pages, continuing from A.
    const afterB = computeBatesRange(nextBatesStart([afterA.end], 1), 4);
    expect(afterB).toEqual({ start: 13, end: 16 });

    // File C: 1 page, continuing from B.
    const afterC = computeBatesRange(nextBatesStart([afterA.end, afterB.end], 1), 1);
    expect(afterC).toEqual({ start: 17, end: 17 });
  });
});

describe("computeBatesRange", () => {
  it("spans exactly pageCount numbers starting at start", () => {
    expect(computeBatesRange(1, 1)).toEqual({ start: 1, end: 1 });
    expect(computeBatesRange(85, 5)).toEqual({ start: 85, end: 89 });
  });

  it("rejects a non-positive page count", () => {
    expect(() => computeBatesRange(1, 0)).toThrow();
  });
});

describe("formatEvidenceIdentifier", () => {
  it("pads to 4 digits with a hyphen separator", () => {
    expect(formatEvidenceIdentifier("ELLIS", 1)).toBe("ELLIS-0001");
    expect(formatEvidenceIdentifier("EV", 42)).toBe("EV-0042");
  });
});
