/**
 * CSV export helpers shared by every authorized export. Values that a
 * spreadsheet would interpret as a formula (leading =, +, -, @, tab, CR)
 * are prefixed with a single quote so an exported field can never execute
 * — the standard OWASP "CSV injection" mitigation. Dates are written as
 * ISO yyyy-mm-dd (or full ISO instants) and money as fixed two-decimal
 * amounts without currency symbols, so spreadsheets parse them reliably.
 */

export type CsvValue = string | number | boolean | Date | null | undefined;

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function neutralizeFormula(value: string): string {
  return FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

export function formatCsvDate(date: Date, withTime = false): string {
  return withTime ? date.toISOString() : date.toISOString().slice(0, 10);
}

/** Integer cents → "1234.50" (no symbol, no thousands separators). */
export function formatCsvCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

function cell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  let text: string;
  if (value instanceof Date) text = formatCsvDate(value, true);
  else if (typeof value === "number") text = Number.isFinite(value) ? String(value) : "";
  else if (typeof value === "boolean") text = value ? "true" : "false";
  else text = neutralizeFormula(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: CsvValue[][]): string {
  const lines = [headers.map((h) => cell(h)).join(","), ...rows.map((r) => r.map(cell).join(","))];
  // Leading BOM so Excel opens UTF-8 (non-ASCII fictional names) correctly.
  return `﻿${lines.join("\r\n")}\r\n`;
}

export function csvResponseHeaders(filename: string): HeadersInit {
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, "_");
  return {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${safe}"`,
    "Cache-Control": "no-store",
  };
}
