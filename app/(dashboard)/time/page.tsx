import Link from "next/link";
import { format } from "date-fns";

import { prisma } from "@/lib/db";
import { requireCurrentUser } from "@/lib/auth/session";
import { isAdmin } from "@/lib/auth/authorization";
import { getMyTimeData, getMyTimeSummary, listTimeMatterOptions } from "@/lib/time/queries";
import { timeCategoryLabel } from "@/lib/time/labels";
import { formatMinutes } from "@/lib/time/math";
import { matterTitle } from "@/lib/matters/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TimeEntryForm } from "@/components/shared/time-entry-form";
import { TimerControls } from "@/components/shared/timer-controls";
import { VoidTimeEntryButton } from "@/components/shared/void-time-entry-button";

/**
 * The signed-in user's own time: running timer, drafts to confirm (from a
 * stopped timer), quick manual entry, and recent entries — limited to
 * matters the user can still access.
 */
export default async function MyTimePage() {
  const user = await requireCurrentUser();
  const [{ timer, entries, drafts, overlappingIds }, summary, matters, staff] = await Promise.all([
    getMyTimeData(user),
    getMyTimeSummary(user),
    listTimeMatterOptions(user),
    isAdmin(user)
      ? prisma.user.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Time</h1>
        <p className="text-sm text-muted-foreground">
          Today {formatMinutes(summary.todayMinutes)} · This week {formatMinutes(summary.weekMinutes)} (recorded work time)
        </p>
      </div>

      {timer && (
        <Card>
          <CardHeader>
            <CardTitle>
              Running timer —{" "}
              <Link href={`/matters/${timer.matterId}/time`} className="hover:underline">
                {timer.matterLabel}
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {timer.longRunning && (
              <p className="mb-2 text-sm font-medium text-amber-700">
                This timer has been running for over 12 hours — it may have been left on. You&apos;ll be asked to confirm
                the time actually worked when you stop it.
              </p>
            )}
            <TimerControls
              matterId={timer.matterId}
              timer={{ matterId: timer.matterId, matterLabel: timer.matterLabel, elapsedSeconds: timer.elapsedSeconds, running: timer.running }}
            />
          </CardContent>
        </Card>
      )}

      {drafts.length > 0 && (
        <Card className="border-amber-300">
          <CardHeader>
            <CardTitle>Drafts to confirm</CardTitle>
            <p className="text-sm text-muted-foreground">
              Created when a timer was stopped. Review the duration and description — drafts don&apos;t count toward
              totals until confirmed.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {drafts.map((d) => (
              <div key={d.id} className="space-y-1">
                <p className="text-sm font-medium">
                  {d.matter.caseNumber} — {matterTitle(d.matter)}
                </p>
                <TimeEntryForm
                  isAdmin={isAdmin(user)}
                  submitLabel="Confirm entry"
                  initial={{
                    id: d.id,
                    workDate: format(d.workDate, "yyyy-MM-dd"),
                    durationMinutes: d.durationMinutes,
                    category: d.category,
                    description: d.description,
                    billable: d.billable,
                    hourlyRate: d.hourlyRateCents ? (d.hourlyRateCents / 100).toFixed(2) : "",
                  }}
                />
                <VoidTimeEntryButton entryId={d.id} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        <h2 className="text-sm font-semibold">Record time</h2>
        <TimeEntryForm matters={matters} isAdmin={isAdmin(user)} staff={staff.map((s) => ({ id: s.id, label: s.name }))} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>My recent entries</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Matter</TableHead>
                <TableHead>Activity</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Time</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => (
                <TableRow key={e.id} className={e.voidedAt ? "opacity-60" : undefined}>
                  <TableCell className="whitespace-nowrap text-sm">{format(e.workDate, "MMM d, yyyy")}</TableCell>
                  <TableCell className="text-sm">
                    <Link href={`/matters/${e.matter.id}/time`} className="hover:underline">
                      {e.matter.caseNumber}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">{timeCategoryLabel(e.category)}</TableCell>
                  <TableCell className="max-w-md text-sm">
                    <span className={e.voidedAt ? "line-through" : undefined}>{e.description || "—"}</span>
                    {overlappingIds.has(e.id) && <p className="text-xs text-amber-700">Overlaps another entry&apos;s times.</p>}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{formatMinutes(e.durationMinutes)}</TableCell>
                  <TableCell className="space-x-1">
                    {e.status === "DRAFT" && <Badge variant="warning">Draft</Badge>}
                    {e.voidedAt && <Badge variant="secondary">Void</Badge>}
                    {!e.voidedAt && e.status !== "DRAFT" && <Badge variant="outline">{e.billable ? "Billable" : "Nonbillable"}</Badge>}
                  </TableCell>
                  <TableCell>{!e.voidedAt && <VoidTimeEntryButton entryId={e.id} />}</TableCell>
                </TableRow>
              ))}
              {entries.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">
                    No time recorded yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
