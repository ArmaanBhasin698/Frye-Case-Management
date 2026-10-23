import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { csvResponseHeaders, toCsv } from "@/lib/csv";
import { parseReportFilters, reportKindFromSlug, runReport } from "@/lib/reports/saved";
import { recordActivity } from "@/lib/usage/record";

/**
 * Authorized CSV export for matters, tasks, time, usage (ADMIN), and
 * search results. Filters come from the query string and are validated
 * per kind; the report is run under the *current* user's scope. Not
 * signed in, unknown kind, invalid filters, and a kind the user may not
 * run all return the same 404. Each export is audited with the kind and
 * row count only — never filter values or search text.
 */
export async function GET(request: Request, context: { params: Promise<{ kind: string }> }) {
  const notFound = () => new NextResponse("Not found.", { status: 404 });
  const user = await getCurrentUser();
  if (!user) return notFound();

  const { kind: slug } = await context.params;
  const kind = reportKindFromSlug(slug);
  if (!kind) return notFound();

  const url = new URL(request.url);
  const filters = parseReportFilters(kind, Object.fromEntries(url.searchParams.entries()));
  if (!filters.ok) return notFound();

  const table = await runReport(user, kind, filters.filters);
  if (!table) return notFound();

  await prisma.auditEvent.create({
    data: {
      actorId: user.id,
      action: "EXPORT",
      entityType: "CsvExport",
      entityId: kind,
      metadata: { kind, rows: table.rows.length, truncated: table.truncated },
    },
  });
  await recordActivity({
    userId: user.id,
    sessionId: user.sessionId,
    type: "REPORT_EXPORT",
    module: "reports",
    path: `/reports/export/${slug.toLowerCase()}`,
    resourceType: "CsvExport",
    resourceId: kind,
  });

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return new NextResponse(toCsv(table.columns, table.rows), {
    headers: csvResponseHeaders(`frye-${slug.toLowerCase()}-${stamp}.csv`),
  });
}
