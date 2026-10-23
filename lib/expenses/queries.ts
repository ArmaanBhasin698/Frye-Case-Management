import type { ExpenseCategory, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { matterScopeFilterFor } from "@/lib/auth/access";
import type { AuthorizableUser } from "@/lib/auth/authorization";
import { amountVisibleMatterIds } from "@/lib/expenses/access";
import { EXPENSE_CATEGORY_VALUES } from "@/lib/expenses/labels";

/**
 * Expense reads. Every query is scoped to the viewer's matters first, and
 * every row goes through `toExpenseView`, which *omits* monetary fields
 * unless the viewer may see amounts for that row's matter (ADMIN, or an
 * ATTORNEY assigned to the matter). Totals are computed only from rows
 * whose amounts the viewer may see.
 */

export type ExpenseFilters = {
  from?: string;
  to?: string;
  category?: ExpenseCategory;
  billable?: "billable" | "nonbillable";
  includeVoided?: boolean;
  matterId?: string;
};

const expenseSelect = {
  id: true,
  matterId: true,
  incurredOn: true,
  category: true,
  description: true,
  quantity: true,
  unitCostCents: true,
  totalCents: true,
  billable: true,
  voidedAt: true,
  voidReason: true,
  createdAt: true,
  recordedById: true,
  recordedBy: { select: { name: true } },
  responsibleUserId: true,
  responsibleUser: { select: { name: true } },
  receiptDocumentId: true,
  receiptDocument: { select: { id: true, title: true, matterId: true } },
  matter: { select: { caseNumber: true, client: { select: { lastName: true } } } },
} satisfies Prisma.ExpenseSelect;

type ExpenseRow = Prisma.ExpenseGetPayload<{ select: typeof expenseSelect }>;

export type ExpenseView = {
  id: string;
  matterId: string;
  matterLabel: string;
  incurredOn: Date;
  category: ExpenseCategory;
  description: string;
  billable: boolean;
  voidedAt: Date | null;
  voidReason: string | null;
  recordedById: string | null;
  recordedByName: string | null;
  responsibleUserId: string | null;
  responsibleName: string | null;
  receipt: { id: string; title: string; matterId: string } | null;
  /** Present only when the viewer may see this matter's amounts. */
  amounts: { quantity: string; unitCostCents: number; totalCents: number } | null;
};

export function toExpenseView(row: ExpenseRow, showAmounts: boolean): ExpenseView {
  return {
    id: row.id,
    matterId: row.matterId,
    matterLabel: `${row.matter.caseNumber} — State v. ${row.matter.client.lastName}`,
    incurredOn: row.incurredOn,
    category: row.category,
    description: row.description,
    billable: row.billable,
    voidedAt: row.voidedAt,
    voidReason: row.voidReason,
    recordedById: row.recordedById,
    recordedByName: row.recordedBy?.name ?? null,
    responsibleUserId: row.responsibleUserId,
    responsibleName: row.responsibleUser?.name ?? null,
    // A receipt is always a document of the same matter (enforced on write).
    receipt: row.receiptDocument,
    amounts: showAmounts
      ? { quantity: row.quantity.toString(), unitCostCents: row.unitCostCents, totalCents: row.totalCents }
      : null,
  };
}

export type ExpenseTotals = {
  totalCents: number;
  billableCents: number;
  nonbillableCents: number;
  byCategory: { category: ExpenseCategory; totalCents: number; count: number }[];
  /** Number of non-voided rows that contributed (rows without visible amounts never do). */
  counted: number;
};

/** Totals over non-voided rows whose amounts are visible. Pure. */
export function summarizeExpenses(views: ExpenseView[]): ExpenseTotals {
  const byCategory = new Map<ExpenseCategory, { totalCents: number; count: number }>();
  let totalCents = 0;
  let billableCents = 0;
  let counted = 0;
  for (const v of views) {
    if (v.voidedAt || !v.amounts) continue;
    counted += 1;
    totalCents += v.amounts.totalCents;
    if (v.billable) billableCents += v.amounts.totalCents;
    const entry = byCategory.get(v.category) ?? { totalCents: 0, count: 0 };
    entry.totalCents += v.amounts.totalCents;
    entry.count += 1;
    byCategory.set(v.category, entry);
  }
  return {
    totalCents,
    billableCents,
    nonbillableCents: totalCents - billableCents,
    byCategory: [...byCategory.entries()].map(([category, v]) => ({ category, ...v })).sort((a, b) => b.totalCents - a.totalCents),
    counted,
  };
}

function isDateOnly(v: string | undefined): v is string {
  return Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)));
}

export function readExpenseFilters(params: Record<string, string | string[] | undefined>): ExpenseFilters {
  const one = (k: string) => {
    const v = params[k];
    return (Array.isArray(v) ? v[0] : v) || undefined;
  };
  const category = one("category");
  const billable = one("billable");
  return {
    from: one("from"),
    to: one("to"),
    category: EXPENSE_CATEGORY_VALUES.includes(category as never) ? (category as ExpenseFilters["category"]) : undefined,
    billable: billable === "billable" || billable === "nonbillable" ? billable : undefined,
    includeVoided: one("voided") === "1",
    matterId: one("matterId"),
  };
}

export function buildExpenseWhere(scope: Prisma.ExpenseWhereInput, filters: ExpenseFilters): Prisma.ExpenseWhereInput {
  const conditions: Prisma.ExpenseWhereInput[] = [scope];
  if (!filters.includeVoided) conditions.push({ voidedAt: null });
  if (filters.matterId) conditions.push({ matterId: filters.matterId });
  if (filters.category && EXPENSE_CATEGORY_VALUES.includes(filters.category)) conditions.push({ category: filters.category });
  if (filters.billable) conditions.push({ billable: filters.billable === "billable" });
  if (isDateOnly(filters.from)) conditions.push({ incurredOn: { gte: new Date(filters.from) } });
  if (isDateOnly(filters.to)) conditions.push({ incurredOn: { lte: new Date(filters.to) } });
  return { AND: conditions };
}

/**
 * Expenses on one matter, or firm-wide across every matter the viewer can
 * access. A `matterId` filter is ANDed with the viewer's scope, so a forged
 * or inaccessible matter id simply yields nothing.
 */
export async function listExpenses(user: AuthorizableUser, filters: ExpenseFilters = {}, take = 500) {
  const scope = await matterScopeFilterFor(user);
  const rows = await prisma.expense.findMany({
    where: buildExpenseWhere(scope, filters),
    select: expenseSelect,
    orderBy: [{ incurredOn: "desc" }, { createdAt: "desc" }],
    take,
  });
  const visible = await amountVisibleMatterIds(user);
  const views = rows.map((r) => toExpenseView(r, visible === null || visible.has(r.matterId)));
  return { views, totals: summarizeExpenses(views) };
}

/** Receipt options for a matter (that matter's documents only). Caller must have asserted matter access. */
export function listReceiptOptions(matterId: string) {
  return prisma.document.findMany({
    where: { matterId },
    select: { id: true, title: true },
    orderBy: { uploadedAt: "desc" },
    take: 200,
  });
}
