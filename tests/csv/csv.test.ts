import { describe, expect, it } from "vitest";

import { formatCsvCents, neutralizeFormula, toCsv } from "@/lib/csv";

describe("CSV export safety", () => {
  it("neutralizes spreadsheet formula injection", () => {
    for (const evil of ["=HYPERLINK(\"http://x\")", "+1+1", "-2+3", "@SUM(A1)", "\tcmd", "\rcmd"]) {
      expect(neutralizeFormula(evil).startsWith("'")).toBe(true);
    }
    expect(neutralizeFormula("Jane Doe")).toBe("Jane Doe");
  });

  it("quotes commas, quotes and newlines, and keeps numbers numeric", () => {
    const csv = toCsv(["a", "b", "c"], [["x, y", 'say "hi"', 3], ["=1+1", null, true]]);
    expect(csv).toBe('﻿a,b,c\r\n"x, y","say ""hi""",3\r\n\'=1+1,,true\r\n');
  });

  it("formats integer cents exactly", () => {
    expect(formatCsvCents(123450)).toBe("1234.50");
    expect(formatCsvCents(5)).toBe("0.05");
    expect(formatCsvCents(-199)).toBe("-1.99");
  });
});
