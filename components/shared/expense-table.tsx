import Link from "next/link";
import { format } from "date-fns";

import type { AuthorizableUser } from "@/lib/auth/authorization";
import { isAdmin } from "@/lib/auth/authorization";
import { EXPENSE_CATEGORY_LABELS, EXPENSE_CATEGORY_VALUES } from "@/lib/expenses/labels";
import { formatExpenseCents, formatQuantity } from "@/lib/expenses/money";
import type { ExpenseFilters, ExpenseTotals, ExpenseView } from "@/lib/expenses/queries";
import { asCalendarDate } from "@/lib/matters/format";
import { formatCsvCents } from "@/lib/csv";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ExpenseForm, VoidExpenseButton } from "@/components/shared/expense-form";

export function ExpenseFilterBar({
  filters,
  clearHref,
  matterOptions,
}: {
  filters: ExpenseFilters;
  clearHref: string;
  matterOptions?: { id: string; label: string }[];
}) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/30 p-3">
      <div className="space-y-1">
        <Label htmlFor="exf-from" className="text-xs">From</Label>
        <Input id="exf-from" name="from" type="date" className="w-40" defaultValue={filters.from} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="exf-to" className="text-xs">To</Label>
        <Input id="exf-to" name="to" type="date" className="w-40" defaultValue={filters.to} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="exf-cat" className="text-xs">Category</Label>
        <Select id="exf-cat" name="category" className="w-44" defaultValue={filters.category ?? ""}>
          <option value="">Any category</option>
          {EXPENSE_CATEGORY_VALUES.map((c) => (
            <option key={c} value={c}>{EXPENSE_CATEGORY_LABELS[c]}</option>
          ))}
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="exf-bill" className="text-xs">Billable</Label>
        <Select id="exf-bill" name="billable" className="w-36" defaultValue={filters.billable ?? ""}>
          <option value="">Any</option>
          <option value="billable">Billable</option>
          <option value="nonbillable">Nonbillable</option>
        </Select>
      </div>
      {matterOptions && (
        <div className="space-y-1">
          <Label htmlFor="exf-matter" className="text-xs">Matter</Label>
          <Select id="exf-matter" name="matterId" className="w-56" defaultValue={filters.matterId ?? ""}>
            <option value="">All your matters</option>
            {matterOptions.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </Select>
        </div>
      )}
      <label className="flex items-center gap-2 pb-2 text-sm">
        <input type="checkbox" name="voided" value="1" defaultChecked={filters.includeVoided} />
        Include voided
      </label>
      <Button type="submit" size="sm">Apply</Button>
      <Button variant="ghost" size="sm" asChild>
        <Link href={clearHref}>Clear</Link>
      </Button>
    </form>
  );
}

export function ExpenseTotalsPanel({ totals, partial }: { totals: ExpenseTotals; partial?: boolean }) {
  return (
    <div className="grid gap-3 sm:grid-cols-4">
      {[
        ["Total", totals.totalCents],
        ["Billable", totals.billableCents],
        ["Nonbillable", totals.nonbillableCents],
      ].map(([label, cents]) => (
        <div key={label as string} className="rounded-lg border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-semibold tabular-nums">{formatExpenseCents(cents as number)}</p>
        </div>
      ))}
      <div className="rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">
        {totals.byCategory.length === 0
          ? "No expenses in range."
          : totals.byCategory.map((c) => (
              <p key={c.category}>
                {EXPENSE_CATEGORY_LABELS[c.category]}: {formatExpenseCents(c.totalCents)} ({c.count})
              </p>
            ))}
        {partial && <p className="mt-1">Totals include only matters whose amounts you can see.</p>}
      </div>
    </div>
  );
}

/**
 * Expense rows. Amount columns render only when the server included
 * amounts (`view.amounts`); for everyone else the values were never sent.
 * Correct/void controls appear for the recorder, matter attorneys, and
 * ADMIN — the actions re-check this.
 */
export function ExpenseTable({
  user,
  views,
  showAmountColumns,
  showMatter,
  staffByMatter,
  receiptsByMatter,
}: {
  user: AuthorizableUser;
  views: ExpenseView[];
  showAmountColumns: boolean;
  showMatter?: boolean;
  staffByMatter?: Map<string, { id: string; label: string }[]>;
  receiptsByMatter?: Map<string, { id: string; label: string }[]>;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          {showMatter && <TableHead>Matter</TableHead>}
          <TableHead>Category</TableHead>
          <TableHead>Description</TableHead>
          {showAmountColumns && <TableHead className="text-right">Qty × unit</TableHead>}
          {showAmountColumns && <TableHead className="text-right">Total</TableHead>}
          <TableHead>Recorded by</TableHead>
          <TableHead className="w-32" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {views.map((v) => {
          const mayEdit = !v.voidedAt && (isAdmin(user) || v.recordedById === user.id || v.amounts !== null);
          return (
            <TableRow key={v.id} className={v.voidedAt ? "opacity-60" : undefined}>
              <TableCell className="whitespace-nowrap text-sm">{format(asCalendarDate(v.incurredOn), "MMM d, yyyy")}</TableCell>
              {showMatter && (
                <TableCell className="text-sm">
                  <Link href={`/matters/${v.matterId}/expenses`} className="hover:underline">{v.matterLabel}</Link>
                </TableCell>
              )}
              <TableCell className="text-sm">
                {EXPENSE_CATEGORY_LABELS[v.category]}
                {!v.billable && <Badge variant="outline" className="ml-1">Nonbillable</Badge>}
              </TableCell>
              <TableCell className="text-sm">
                {v.description}
                {v.receipt && (
                  <p>
                    <Link href={`/matters/${v.receipt.matterId}/documents/files/${v.receipt.id}`} className="text-xs text-primary hover:underline">
                      Receipt: {v.receipt.title}
                    </Link>
                  </p>
                )}
                {v.voidedAt && <p className="text-xs text-muted-foreground">Voided: {v.voidReason}</p>}
              </TableCell>
              {showAmountColumns && (
                <TableCell className="text-right text-sm tabular-nums">
                  {v.amounts ? `${formatQuantity(v.amounts.quantity)} × ${formatExpenseCents(v.amounts.unitCostCents)}` : "—"}
                </TableCell>
              )}
              {showAmountColumns && (
                <TableCell className="text-right text-sm font-medium tabular-nums">
                  {v.amounts ? formatExpenseCents(v.amounts.totalCents) : "—"}
                </TableCell>
              )}
              <TableCell className="text-sm text-muted-foreground">
                {v.recordedByName ?? "—"}
                {v.responsibleName && <p className="text-xs">Responsible: {v.responsibleName}</p>}
              </TableCell>
              <TableCell>
                {mayEdit && (
                  <div className="flex flex-wrap gap-1">
                    <ExpenseForm
                      matterId={v.matterId}
                      staff={staffByMatter?.get(v.matterId) ?? []}
                      receipts={receiptsByMatter?.get(v.matterId) ?? []}
                      showAmounts={v.amounts !== null}
                      editing={{
                        id: v.id,
                        incurredOn: v.incurredOn.toISOString().slice(0, 10),
                        category: v.category,
                        description: v.description,
                        billable: v.billable,
                        responsibleUserId: v.responsibleUserId ?? "",
                        receiptDocumentId: v.receipt?.id ?? "",
                        ...(v.amounts
                          ? { quantity: formatQuantity(v.amounts.quantity), unitCost: formatCsvCents(v.amounts.unitCostCents) }
                          : {}),
                      }}
                    />
                    <VoidExpenseButton expenseId={v.id} />
                  </div>
                )}
              </TableCell>
            </TableRow>
          );
        })}
        {views.length === 0 && (
          <TableRow>
            <TableCell colSpan={8} className="py-6 text-center text-sm text-muted-foreground">
              No expenses match.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
