import Link from "next/link";
import { notFound } from "next/navigation";

import { requireCurrentUser } from "@/lib/auth/session";
import { REPORT_KIND_LABELS, canRunReportKind, parseReportFilters, reportKindFromSlug } from "@/lib/reports/saved";
import { SavedReportRunner } from "@/components/shared/saved-report-runner";

/** Ad-hoc report run (and the starting point for saving one). */
export default async function RunReportPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requireCurrentUser();
  const raw = await searchParams;
  const kind = reportKindFromSlug(String(Array.isArray(raw.kind) ? raw.kind[0] : raw.kind ?? ""));
  if (!kind || !canRunReportKind(user, kind)) notFound();

  const parsed = parseReportFilters(kind, Object.fromEntries(Object.entries(raw).filter(([k]) => k !== "kind")));
  // SEARCH needs a query before it can run; show the form with no results.
  const filters = parsed.ok ? parsed.filters : {};

  return (
    <div className="space-y-6">
      <div>
        <Link href="/reports/saved" className="text-sm text-muted-foreground hover:text-foreground">
          &larr; Saved reports
        </Link>
        <h1 className="page-title mt-1">{REPORT_KIND_LABELS[kind]} report</h1>
      </div>
      {parsed.ok ? (
        <SavedReportRunner user={user} kind={kind} filters={filters} formAction="/reports/saved/run" allowSave />
      ) : (
        <SavedReportRunner user={user} kind={kind} filters={{ q: "" }} formAction="/reports/saved/run" allowSave={false} />
      )}
    </div>
  );
}
