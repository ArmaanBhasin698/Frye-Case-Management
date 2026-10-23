import Link from "next/link";

import { requireCurrentUser } from "@/lib/auth/session";
import { assertMatterAccess } from "@/lib/auth/access";
import { canSeeExpenseAmounts } from "@/lib/expenses/access";
import { listExpenses, listReceiptOptions, readExpenseFilters } from "@/lib/expenses/queries";
import { getMatterAssignableUsers } from "@/lib/matters/queries";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExpenseForm } from "@/components/shared/expense-form";
import { ExpenseFilterBar, ExpenseTable, ExpenseTotalsPanel } from "@/components/shared/expense-table";

/**
 * Matter Expenses: case costs recorded separately from time. Anyone on the
 * matter may record; amounts and totals are rendered only for ADMIN and
 * ATTORNEYs assigned to this matter — for everyone else the server never
 * sends them. No invoices, payments, trust accounting, or QuickBooks.
 */
export default async function MatterExpensesPage({
  params,
  searchParams,
}: {
  params: Promise<{ matterId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { matterId } = await params;
  const user = await requireCurrentUser();
  await assertMatterAccess(user, matterId);

  const filters = { ...readExpenseFilters(await searchParams), matterId };
  const [showAmounts, { views, totals }, staff, receipts] = await Promise.all([
    canSeeExpenseAmounts(user, matterId),
    listExpenses(user, filters),
    getMatterAssignableUsers(matterId),
    listReceiptOptions(matterId),
  ]);
  const staffOptions = staff.map((s) => ({ id: s.id, label: s.name }));
  const receiptOptions = receipts.map((r) => ({ id: r.id, label: r.title }));

  const exportQuery = new URLSearchParams({ matterId });
  if (filters.from) exportQuery.set("from", filters.from);
  if (filters.to) exportQuery.set("to", filters.to);
  if (filters.category) exportQuery.set("category", filters.category);
  if (filters.billable) exportQuery.set("billable", filters.billable);
  if (filters.includeVoided) exportQuery.set("voided", "1");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Expenses</h2>
          <p className="text-xs text-muted-foreground">
            Case costs only — this is not invoicing, payments, or trust accounting.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/expenses/export?${exportQuery.toString()}`}>Export CSV</Link>
          </Button>
          <ExpenseForm matterId={matterId} staff={staffOptions} receipts={receiptOptions} showAmounts={showAmounts} />
        </div>
      </div>

      <ExpenseFilterBar filters={filters} clearHref={`/matters/${matterId}/expenses`} />

      {showAmounts && <ExpenseTotalsPanel totals={totals} />}

      <Card>
        <CardHeader>
          <CardTitle>Recorded expenses</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ExpenseTable
            user={user}
            views={views}
            showAmountColumns={showAmounts}
            staffByMatter={new Map([[matterId, staffOptions]])}
            receiptsByMatter={new Map([[matterId, receiptOptions]])}
          />
        </CardContent>
      </Card>
    </div>
  );
}
