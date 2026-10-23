import Link from "next/link";
import { notFound } from "next/navigation";

import { prisma } from "@/lib/db";
import { requireCurrentUser } from "@/lib/auth/session";
import { REPORT_KIND_LABELS, canRunReportKind, parseReportFilters, reportKindFromSlug } from "@/lib/reports/saved";
import { SavedReportRunner } from "@/components/shared/saved-report-runner";
import { DeleteReportForm, RenameReportForm } from "@/components/shared/saved-report-forms";

/**
 * A saved report, owner-only (anyone else's id is a 404). The stored
 * filters are re-validated and re-run under the current user's access;
 * query-string filters, if present, override them for this view.
 */
export default async function SavedReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ reportId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { reportId } = await params;
  const user = await requireCurrentUser();
  const report = await prisma.savedReport.findFirst({ where: { id: reportId, ownerId: user.id } });
  if (!report) notFound();
  const kind = reportKindFromSlug(report.kind);
  if (!kind || !canRunReportKind(user, kind)) notFound();

  const query = await searchParams;
  const hasOverrides = Object.keys(query).length > 0;
  const stored = report.filters && typeof report.filters === "object" ? (report.filters as Record<string, unknown>) : {};
  const parsed = parseReportFilters(kind, hasOverrides ? query : stored);
  const filters = parsed.ok ? parsed.filters : {};

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/reports/saved" className="text-sm text-muted-foreground hover:text-foreground">
            &larr; Saved reports
          </Link>
          <h1 className="page-title mt-1">{report.name}</h1>
          <p className="text-sm text-muted-foreground">{REPORT_KIND_LABELS[kind]} report</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RenameReportForm reportId={report.id} name={report.name} />
          <DeleteReportForm reportId={report.id} />
        </div>
      </div>
      {!parsed.ok && (
        <p className="text-sm text-destructive">This report&apos;s saved filters are no longer valid; adjust them and save a new report.</p>
      )}
      <SavedReportRunner user={user} kind={kind} filters={filters} formAction={`/reports/saved/${report.id}`} allowSave={hasOverrides} />
    </div>
  );
}
