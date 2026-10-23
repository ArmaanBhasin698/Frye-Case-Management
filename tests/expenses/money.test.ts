import { describe, expect, it } from "vitest";

import {
  computeTotalCents,
  formatExpenseCents,
  formatQuantity,
  MAX_UNIT_COST_CENTS,
  parseDollarsToCents,
  parseQuantity,
  quantityToDecimalString,
} from "@/lib/expenses/money";

describe("parseQuantity", () => {
  it("parses up to three decimals exactly into thousandths", () => {
    expect(parseQuantity("1")).toBe(BigInt(1000));
    expect(parseQuantity("2.5")).toBe(BigInt(2500));
    expect(parseQuantity("0.001")).toBe(BigInt(1));
    expect(parseQuantity(" 12.345 ")).toBe(BigInt(12345));
  });

  it("rejects zero, negatives, too many decimals, junk, and values over the cap", () => {
    for (const bad of ["0", "0.000", "-1", "1.2345", "1e3", "abc", "", "1,000", "1000001"]) {
      expect(parseQuantity(bad)).toBeNull();
    }
    expect(parseQuantity("1000000")).toBe(BigInt(1_000_000_000));
  });
});

describe("parseDollarsToCents", () => {
  it("parses dollars into exact integer cents", () => {
    expect(parseDollarsToCents("12.3")).toBe(1230);
    expect(parseDollarsToCents("$0.07")).toBe(7);
    expect(parseDollarsToCents("0")).toBe(0);
    expect(parseDollarsToCents("1000000.00")).toBe(MAX_UNIT_COST_CENTS);
  });

  it("rejects fractions of a cent, negatives, junk, and values over the cap", () => {
    for (const bad of ["1.234", "-5", "abc", "", "1000000.01", "1,00"]) {
      expect(parseDollarsToCents(bad)).toBeNull();
    }
  });
});

describe("computeTotalCents", () => {
  it("multiplies exactly and rounds half-up to the cent", () => {
    expect(computeTotalCents(BigInt(1000), 4500)).toBe(4500); // 1 × $45.00
    expect(computeTotalCents(BigInt(2500), 333)).toBe(833); // 2.5 × $3.33 = 8.325 → 8.33
    expect(computeTotalCents(BigInt(1), 1)).toBe(0); // 0.001 × $0.01 = 0.00001 → 0.00
    expect(computeTotalCents(BigInt(500), 1)).toBe(1); // 0.5 × $0.01 = 0.005 → 0.01 (half-up)
    expect(computeTotalCents(BigInt(1), 49_999)).toBe(50); // 0.001 × $499.99 = 0.49999 → 0.50
    expect(computeTotalCents(BigInt(3000), 10)).toBe(30); // 3 × $0.10 — no 0.30000000000000004
  });

  it("stays exact at the maximum quantity and unit cost", () => {
    expect(computeTotalCents(BigInt(1_000_000_000), MAX_UNIT_COST_CENTS)).toBe(100_000_000_000_000);
    expect(Number.isSafeInteger(computeTotalCents(BigInt(1_000_000_000), MAX_UNIT_COST_CENTS))).toBe(true);
  });

  it("refuses negative or non-integer inputs", () => {
    expect(() => computeTotalCents(BigInt(-1), 100)).toThrow();
    expect(() => computeTotalCents(BigInt(1000), 1.5)).toThrow();
  });
});

describe("formatting", () => {
  it("formats quantities and cents for display", () => {
    expect(quantityToDecimalString(BigInt(2500))).toBe("2.500");
    expect(formatQuantity("2.500")).toBe("2.5");
    expect(formatQuantity("3.000")).toBe("3");
    expect(formatExpenseCents(123450)).toBe("$1,234.50");
    expect(formatExpenseCents(5)).toBe("$0.05");
  });
});
