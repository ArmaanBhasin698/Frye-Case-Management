import { formatCsvCents, formatCsvDate, toCsv } from "@/lib/csv";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/expenses/labels";
import type { ExpenseView } from "@/lib/expenses/queries";

export const EXPENSE_CSV_HEADERS = [
  "Date",
  "Matter",
  "Category",
  "Description",
  "Billable",
  "Quantity",
  "Unit cost",
  "Total",
  "Recorded by",
  "Responsible",
  "Status",
  "Void reason",
];

/**
 * Expense rows as CSV (lib/csv handles formula-injection neutralization
 * and quoting). Amount cells are filled per row only when that row's
 * view carries amounts — i.e. the exporter may see that matter's amounts;
 * otherwise they're left blank. Money is written as plain two-decimal
 * amounts from integer cents.
 */
export function buildExpenseCsv(views: ExpenseView[]): string {
  return toCsv(
    EXPENSE_CSV_HEADERS,
    views.map((v) => [
      formatCsvDate(v.incurredOn),
      v.matterLabel,
      EXPENSE_CATEGORY_LABELS[v.category],
      v.description,
      v.billable ? "Billable" : "Nonbillable",
      v.amounts ? v.amounts.quantity : null,
      v.amounts ? formatCsvCents(v.amounts.unitCostCents) : null,
      v.amounts ? formatCsvCents(v.amounts.totalCents) : null,
      v.recordedByName,
      v.responsibleName,
      v.voidedAt ? "Voided" : "Active",
      v.voidReason,
    ]),
  );
}
