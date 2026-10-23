/**
 * Exact expense arithmetic. No floating point touches money: quantities
 * are parsed from decimal strings into integer thousandths, unit costs into
 * integer cents, and the product is computed with BigInt and rounded
 * half-up to whole cents. Pure and unit-tested (tests/expenses/money.test.ts).
 */

/** Largest quantity accepted (1,000,000 units). */
export const MAX_QUANTITY_THOUSANDTHS = BigInt(1_000_000_000);
/** Largest unit cost accepted: $1,000,000.00. */
export const MAX_UNIT_COST_CENTS = 100_000_000;

const QUANTITY_PATTERN = /^\d{1,7}(\.\d{1,3})?$/;
const DOLLARS_PATTERN = /^\d{1,9}(\.\d{1,2})?$/;

/** "2.5" → 2500 thousandths (as a bigint). Null if invalid, zero, or above the cap. */
export function parseQuantity(input: string): bigint | null {
  const value = input.trim();
  if (!QUANTITY_PATTERN.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const thousandths = BigInt(whole!) * BigInt(1000) + BigInt(fraction.padEnd(3, "0"));
  if (thousandths <= BigInt(0) || thousandths > MAX_QUANTITY_THOUSANDTHS) return null;
  return thousandths;
}

/** "12.3" → 1230 cents. Null if invalid or above the cap. Zero is allowed (e.g. a waived fee recorded for completeness). */
export function parseDollarsToCents(input: string): number | null {
  const value = input.trim().replace(/^\$/, "");
  if (!DOLLARS_PATTERN.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const cents = Number(BigInt(whole!) * BigInt(100) + BigInt(fraction.padEnd(2, "0")));
  return cents > MAX_UNIT_COST_CENTS ? null : cents;
}

/** quantity × unit cost, rounded half-up to whole cents. */
export function computeTotalCents(quantityThousandths: bigint, unitCostCents: number): number {
  if (quantityThousandths < BigInt(0) || !Number.isInteger(unitCostCents) || unitCostCents < 0) {
    throw new Error("Expense quantity and unit cost must be non-negative.");
  }
  const product = quantityThousandths * BigInt(unitCostCents);
  return Number((product + BigInt(500)) / BigInt(1000));
}

/** Thousandths → canonical decimal string for the Decimal(12,3) column ("2.500"). */
export function quantityToDecimalString(thousandths: bigint): string {
  const whole = thousandths / BigInt(1000);
  const fraction = (thousandths % BigInt(1000)).toString().padStart(3, "0");
  return `${whole}.${fraction}`;
}

/** Display: "2.5" for 2.500, "3" for 3.000. */
export function formatQuantity(decimal: string): string {
  return decimal.includes(".") ? decimal.replace(/\.?0+$/, "") : decimal;
}

/** Integer cents → "$1,234.50". */
export function formatExpenseCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}$${whole}.${String(abs % 100).padStart(2, "0")}`;
}
