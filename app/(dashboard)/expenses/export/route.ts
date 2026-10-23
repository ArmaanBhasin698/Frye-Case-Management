import { NextResponse } from "next/server";
import { format } from "date-fns";

import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { hasMatterAccess } from "@/lib/auth/access";
import { csvResponseHeaders } from "@/lib/csv";
import { buildExpenseCsv } from "@/lib/expenses/csv";
import { listExpenses, readExpenseFilters } from "@/lib/expenses/queries";
import { recordActivity } from "@/lib/usage/record";

/**
 * CSV export of the viewer's expenses (same filters as /expenses or a
 * matter's Expenses tab). Scoped exactly like the pages: only matters the
 * viewer can access, amount cells only for matters whose amounts they may
 * see. A `matterId` the viewer can't access is a 404 rather than an empty
 * file. Every export is audited (filters' ids/enums and row count only).
 */
export async function GET(request: Request) {
  const notFound = () => new NextResponse("Not found.", { status: 404 });
  const user = await getCurrentUser();
  if (!user) return notFound();

  const search = new URL(request.url).searchParams;
  const filters = readExpenseFilters(Object.fromEntries(search.entries()));
  if (filters.matterId && !(await hasMatterAccess(user, filters.matterId))) return notFound();

  const { views } = await listExpenses(user, filters, 5_000);
  const csv = buildExpenseCsv(views);

  await prisma.auditEvent.create({
    data: {
      actorId: user.id,
      action: "EXPORT",
      entityType: "ExpenseExport",
      entityId: filters.matterId ?? "firm",
      matterId: filters.matterId ?? null,
      metadata: {
        rows: views.length,
        category: filters.category ?? null,
        billable: filters.billable ?? null,
        includeVoided: Boolean(filters.includeVoided),
        from: filters.from ?? null,
        to: filters.to ?? null,
      },
    },
  });
  await recordActivity({
    userId: user.id,
    sessionId: user.sessionId,
    type: "REPORT_EXPORT",
    module: "expenses",
    path: "/expenses/export",
    resourceType: "ExpenseCsv",
    resourceId: filters.matterId ?? null,
    matterId: filters.matterId ?? null,
  });

  return new NextResponse(csv, { headers: csvResponseHeaders(`expenses-${format(new Date(), "yyyyMMdd")}.csv`) });
}
