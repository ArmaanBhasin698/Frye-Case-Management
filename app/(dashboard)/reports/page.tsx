import Link from "next/link";
import { format } from "date-fns";
import {
  AlertTriangle,
  CalendarClock,
  FileSearch,
  FileText,
  Gavel,
  ListChecks,
  Phone,
  Users,
} from "lucide-react";

import { getFirmReportSummary, type ReportFilters, type ReportWindow } from "@/lib/reports/queries";
import { listMatters } from "@/lib/matters/queries";
import {
  callDirectionLabel,
  deadlineTypeLabel,
  discoveryFileTypeLabel,
  discoveryReviewStatusLabel,
  matterTitle,
  taskPriorityLabel,
  taskStatusLabel,
} from "@/lib/matters/format";
import { requireCurrentUser } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatBar } from "@/components/shared/stat-bar";
import { ReportsFilterBar, type ReportsFilterValues } from "@/components/shared/reports-filter-bar";

const WINDOW_VALUES = new Set<ReportWindow>(["7d", "30d", "90d", "all"]);
const WINDOW_LABEL: Record<ReportWindow, string> = {
  "7d": "the last 7 days",
  "30d": "the last 30 days",
  "90d": "the last 90 days",
  all: "all time",
};

function readParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/** Appends `matterId` (when set) to a link back to another firm-wide page, so a filtered Reports view still points at the matching filtered workflow. */
function withMatter(path: string, matterId: string, extra: Record<string, string> = {}) {
  const params = new URLSearchParams(extra);
  if (matterId) params.set("matterId", matterId);
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * Firm-wide Reports (app/(dashboard)/reports) — a real, authorized
 * operational-reporting aggregate over the exact rows the other firm-wide
 * pages already read (Task/Deadline/Document/DiscoveryFile/
 * DiscoveryProduction/Call/Note via `lib/reports/queries.ts`), not a new
 * record, a BI platform, or an export/integration project. Every count is
 * scoped server-side the same way Tasks/Calendar/Communications/Discovery
 * already are: an ADMIN sees firm-wide totals, everyone else only totals
 * over matters they're assigned to — see lib/reports/queries.ts for the
 * full authorization write-up.
 *
 * This intentionally reports only what the current schema actually proves:
 * operational counts and status breakdowns. It does not show financial,
 * billing, settlement, win-rate, case-outcome, or time-entry metrics —
 * none of that exists in the schema yet (see docs/DATA_MODEL.md).
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requireCurrentUser();
  const params = await searchParams;

  const matterId = readParam(params.matterId) || "";
  const windowParam = readParam(params.window);
  const window: ReportWindow = windowParam && WINDOW_VALUES.has(windowParam as ReportWindow)
    ? (windowParam as ReportWindow)
    : "30d";

  const filters: ReportFilters = { matterId: matterId || undefined, window };

  const [summary, matters] = await Promise.all([getFirmReportSummary(user, filters), listMatters(user)]);

  const currentFilters: ReportsFilterValues = { matterId, window };
  const matterOptions = matters.map((m) => ({ id: m.id, label: `${matterTitle(m)} · ${m.caseNumber}` }));

  const openTasks = summary.tasks.byStatus.OPEN + summary.tasks.byStatus.IN_PROGRESS;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Reports</h1>
        <p className="text-sm text-muted-foreground">
          Firm-wide operational reporting across every matter you have access to — an aggregate view over
          existing Task/Deadline/Document/Discovery/Call records, not a separate billing or case-outcome
          report.
        </p>
      </div>

      <div className="rounded-md border border-dashed border-border bg-muted/40 p-3 text-sm text-muted-foreground">
        These figures reflect only what&apos;s recorded in this system today — no billing, settlement,
        win/loss, or time-entry data exists yet (see docs/DATA_MODEL.md). Dates use the server&apos;s local
        time zone; no separate time zone handling is applied.
      </div>

      <ReportsFilterBar basePath="/reports" current={currentFilters} matters={matterOptions} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={Gavel} label="Active Matters" value={summary.matters.active} href="/matters" />
        <StatCard
          icon={ListChecks}
          label="Open Tasks"
          value={openTasks}
          href={withMatter("/tasks", matterId)}
        />
        <StatCard
          icon={AlertTriangle}
          label="Overdue Tasks"
          value={summary.tasks.overdue}
          href={withMatter("/tasks", matterId, { overdue: "1" })}
          tone={summary.tasks.overdue > 0 ? "destructive" : undefined}
        />
        <StatCard
          icon={CalendarClock}
          label="Upcoming Deadlines"
          value={summary.deadlines.upcoming}
          href={withMatter("/calendar", matterId, { kind: "deadline" })}
        />
        <StatCard
          icon={AlertTriangle}
          label="Overdue Deadlines"
          value={summary.deadlines.overdue}
          href={withMatter("/calendar", matterId, { kind: "deadline", includePast: "1" })}
          tone={summary.deadlines.overdue > 0 ? "destructive" : undefined}
        />
        <StatCard icon={FileText} label="Documents" value={summary.documents.total} />
        <StatCard
          icon={FileSearch}
          label="Discovery Files"
          value={summary.discovery.files}
          href={withMatter("/discovery", matterId)}
        />
        <StatCard
          icon={Phone}
          label="Calls"
          value={summary.calls.total}
          href={withMatter("/communications", matterId)}
        />
      </div>

      {summary.calls.unfiled !== null && (
        <p className="text-sm text-muted-foreground">
          Includes {summary.calls.unfiled} unfiled {summary.calls.unfiled === 1 ? "call" : "calls"} firm-wide
          (visible to Admin/Attorney only — see the Communications page).
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Tasks by status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {summary.tasks.total === 0 ? (
              <p className="text-sm text-muted-foreground">No tasks in scope.</p>
            ) : (
              (["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"] as const).map((status) => (
                <StatBar
                  key={status}
                  label={taskStatusLabel(status)}
                  value={summary.tasks.byStatus[status]}
                  total={summary.tasks.total}
                  variant={status === "DONE" ? "success" : status === "CANCELLED" ? "warning" : "default"}
                />
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Tasks by priority</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {summary.tasks.total === 0 ? (
              <p className="text-sm text-muted-foreground">No tasks in scope.</p>
            ) : (
              (["HIGH", "NORMAL", "LOW"] as const).map((priority) => (
                <StatBar
                  key={priority}
                  label={taskPriorityLabel(priority)}
                  value={summary.tasks.byPriority[priority]}
                  total={summary.tasks.total}
                  variant={priority === "HIGH" ? "destructive" : "default"}
                />
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Deadlines</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {summary.deadlines.total === 0 ? (
              <p className="text-sm text-muted-foreground">No deadlines in scope.</p>
            ) : (
              <>
                <StatBar
                  label="Overdue"
                  value={summary.deadlines.overdue}
                  total={summary.deadlines.total}
                  variant="destructive"
                />
                <StatBar
                  label="Upcoming"
                  value={summary.deadlines.upcoming}
                  total={summary.deadlines.total}
                  variant="warning"
                />
                <StatBar
                  label="Satisfied"
                  value={summary.deadlines.satisfied}
                  total={summary.deadlines.total}
                  variant="success"
                />
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Deadlines by type</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {summary.deadlines.total === 0 ? (
              <p className="text-sm text-muted-foreground">No deadlines in scope.</p>
            ) : (
              (["STATUTE_OF_LIMITATIONS", "SPEEDY_TRIAL", "FILING", "OTHER"] as const).map((type) => (
                <StatBar
                  key={type}
                  label={deadlineTypeLabel(type)}
                  value={summary.deadlines.byType[type]}
                  total={summary.deadlines.total}
                />
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Discovery review status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {summary.discovery.productions === 0 ? (
              <p className="text-sm text-muted-foreground">No discovery productions in scope.</p>
            ) : (
              (["COMPLETE", "IN_REVIEW", "NOT_STARTED"] as const).map((status) => (
                <StatBar
                  key={status}
                  label={discoveryReviewStatusLabel(status)}
                  value={summary.discovery.byReviewStatus[status]}
                  total={summary.discovery.productions}
                  variant={status === "COMPLETE" ? "success" : status === "IN_REVIEW" ? "warning" : "default"}
                />
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Discovery files by type</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {summary.discovery.files === 0 ? (
              <p className="text-sm text-muted-foreground">No discovery files in scope.</p>
            ) : (
              (["PDF", "VIDEO", "AUDIO", "PHOTO", "OTHER"] as const).map((type) => (
                <StatBar
                  key={type}
                  label={discoveryFileTypeLabel(type)}
                  value={summary.discovery.byFileType[type]}
                  total={summary.discovery.files}
                />
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Calls by direction</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {summary.calls.total === 0 ? (
              <p className="text-sm text-muted-foreground">No calls in scope.</p>
            ) : (
              (["INBOUND", "OUTBOUND"] as const).map((direction) => (
                <StatBar
                  key={direction}
                  label={callDirectionLabel(direction)}
                  value={summary.calls.byDirection[direction]}
                  total={summary.calls.total}
                />
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Activity in {WINDOW_LABEL[window]}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-muted-foreground">
              {summary.activity.since
                ? `Since ${format(summary.activity.since, "MMM d, yyyy")}, server-local time.`
                : "Across every record in scope, all time."}
            </p>
            <ul className="divide-y divide-border text-sm">
              <ActivityRow label="Tasks created" value={summary.activity.tasksCreated} />
              <ActivityRow label="Notes added" value={summary.activity.notesAdded} />
              <ActivityRow label="Documents uploaded" value={summary.activity.documentsUploaded} />
              <ActivityRow label="Calls logged" value={summary.activity.callsLogged} />
              <ActivityRow label="Discovery files registered" value={summary.activity.discoveryFilesRegistered} />
            </ul>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gavel className="h-4 w-4" /> Tasks by matter
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {summary.tasks.byMatter.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No tasks match these filters.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Matter</TableHead>
                    <TableHead className="text-right">Tasks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.tasks.byMatter.map((row) => (
                    <TableRow key={row.matterId}>
                      <TableCell>
                        <Link href={`/matters/${row.matterId}`} className="font-medium hover:underline">
                          {row.label}
                        </Link>
                        <div className="text-xs text-muted-foreground">{row.caseNumber}</div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="outline">{row.count}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-4 w-4" /> Tasks by assignee
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {summary.tasks.byAssignee.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No tasks match these filters.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Assignee</TableHead>
                    <TableHead className="text-right">Tasks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.tasks.byAssignee.map((row) => (
                    <TableRow key={row.userId ?? "unassigned"}>
                      <TableCell>
                        {row.userId ? (
                          <Link
                            href={withMatter("/tasks", matterId, { assignedToId: row.userId })}
                            className="font-medium hover:underline"
                          >
                            {row.name}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">{row.name}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="outline">{row.count}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ActivityRow({ label, value }: { label: string; value: number }) {
  return (
    <li className="flex items-center justify-between py-2 first:pt-0 last:pb-0">
      <span className="text-foreground">{label}</span>
      <span className="font-medium text-muted-foreground">{value}</span>
    </li>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  href,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  href?: string;
  tone?: "destructive";
}) {
  const content = (
    <Card className={href ? "transition-colors hover:border-primary/40" : undefined}>
      <CardContent className="flex items-center gap-3 p-4">
        <div
          className={
            tone === "destructive"
              ? "flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-destructive/10 text-destructive"
              : "flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
          }
        >
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className={tone === "destructive" ? "text-2xl font-semibold text-destructive" : "text-2xl font-semibold text-foreground"}>
            {value}
          </p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );

  return href ? <Link href={href}>{content}</Link> : content;
}
