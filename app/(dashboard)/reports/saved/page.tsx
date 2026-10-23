import Link from "next/link";
import { format } from "date-fns";

import { prisma } from "@/lib/db";
import { requireCurrentUser } from "@/lib/auth/session";
import { REPORT_KINDS, REPORT_KIND_LABELS, canRunReportKind, type ReportKind } from "@/lib/reports/saved";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeleteReportForm } from "@/components/shared/saved-report-forms";

/** The current user's saved reports (owner-only) and shortcuts to start a new one. */
export default async function SavedReportsPage() {
  const user = await requireCurrentUser();
  const reports = await prisma.savedReport.findMany({
    where: { ownerId: user.id },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    select: { id: true, name: true, kind: true, updatedAt: true },
  });
  const kinds = REPORT_KINDS.filter((k) => canRunReportKind(user, k));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/reports" className="text-sm text-muted-foreground hover:text-foreground">
          &larr; Reports
        </Link>
        <h1 className="page-title mt-1">Saved reports</h1>
        <p className="text-sm text-muted-foreground">
          Saved reports keep filters only. Every run uses your access at that moment, so results change if your matter
          assignments change.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New report</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {kinds.map((k) => (
            <Button key={k} variant="outline" size="sm" asChild>
              <Link href={`/reports/saved/run?kind=${k}`}>{REPORT_KIND_LABELS[k]}</Link>
            </Button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>My saved reports</CardTitle>
        </CardHeader>
        <CardContent>
          {reports.length === 0 ? (
            <p className="text-sm text-muted-foreground">No saved reports yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {reports.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
                  <div>
                    <Link href={`/reports/saved/${r.id}`} className="font-medium hover:underline">{r.name}</Link>
                    <p className="text-xs text-muted-foreground">Updated {format(r.updatedAt, "MMM d, yyyy")}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{REPORT_KIND_LABELS[r.kind as ReportKind] ?? r.kind}</Badge>
                    <DeleteReportForm reportId={r.id} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
