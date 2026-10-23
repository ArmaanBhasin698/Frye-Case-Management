import Link from "next/link";

import { prisma } from "@/lib/db";
import { requireCurrentUser } from "@/lib/auth/session";
import { matterIdFilterFor } from "@/lib/auth/access";
import { isAdmin } from "@/lib/auth/authorization";
import { amountVisibleMatterIds } from "@/lib/expenses/access";
import { listExpenses, readExpenseFilters } from "@/lib/expenses/queries";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ExpenseFilterBar, ExpenseTable, ExpenseTotalsPanel } from "@/components/shared/expense-table";

/**
 * Firm-wide expenses across every matter the viewer can access. Amounts
 * appear per row only for matters where the viewer may see them (ADMIN:
 * all; ATTORNEY: matters they're assigned to); totals use only those rows.
 * Recording happens on each matter's Expenses tab.
 */
export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requireCurrentUser();
  const filters = readExpenseFilters(await searchParams);
  const matterWhere = await matterIdFilterFor(user);
  const [{ views, totals }, matters, visible] = await Promise.all([
    listExpenses(user, filters),
    prisma.matter.findMany({
      where: matterWhere,
      select: { id: true, caseNumber: true, client: { select: { lastName: true } } },
      orderBy: { openedDate: "desc" },
    }),
    amountVisibleMatterIds(user),
  ]);
  const anyAmounts = visible === null || visible.size > 0;

  const exportQuery = new URLSearchParams();
  for (const [k, v] of Object.entries({
    from: filters.from,
    to: filters.to,
    category: filters.category,
    billable: filters.billable,
    matterId: filters.matterId,
    voided: filters.includeVoided ? "1" : undefined,
  })) {
    if (v) exportQuery.set(k, v);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Expenses</h1>
          <p className="text-sm text-muted-foreground">
            Case costs across your matters. Record new expenses from a matter&apos;s Expenses tab. No invoicing,
            payments, trust accounting, or QuickBooks sync.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href={`/expenses/export${exportQuery.size ? `?${exportQuery.toString()}` : ""}`}>Export CSV</Link>
        </Button>
      </div>

      <ExpenseFilterBar
        filters={filters}
        clearHref="/expenses"
        matterOptions={matters.map((m) => ({ id: m.id, label: `${m.caseNumber} — State v. ${m.client.lastName}` }))}
      />

      {anyAmounts && <ExpenseTotalsPanel totals={totals} partial={!isAdmin(user)} />}

      <Card>
        <CardContent className="p-0">
          <ExpenseTable user={user} views={views} showAmountColumns={anyAmounts} showMatter />
        </CardContent>
      </Card>
    </div>
  );
}
