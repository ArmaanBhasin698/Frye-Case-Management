import { format, subYears } from "date-fns";

import { prisma } from "@/lib/db";
import { requireCurrentUser } from "@/lib/auth/session";
import { assertMatterAccess } from "@/lib/auth/access";
import { canManageClientsAndMatters, isAdmin } from "@/lib/auth/authorization";
import { getActiveTimer, getMatterTimeData } from "@/lib/time/queries";
import { timeCategoryLabel } from "@/lib/time/labels";
import { formatCents, formatHours, formatMinutes } from "@/lib/time/math";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TimeEntryForm } from "@/components/shared/time-entry-form";
import { TimerControls } from "@/components/shared/timer-controls";
import { VoidTimeEntryButton } from "@/components/shared/void-time-entry-button";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

/**
 * Matter "Time & Activity": recorded work time only (TimeEntry), never
 * inferred app usage. Totals exclude voided entries and unconfirmed
 * drafts; voided entries stay listed with their reason. Monetary values
 * render for ADMIN only.
 */
export default async function MatterTimePage({ params }: { params: Promise<{ matterId: string }> }) {
  const { matterId } = await params;
  const user = await requireCurrentUser();
  await assertMatterAccess(user, matterId);

  const [matter, { entries, summary, includeAmounts }, timer, staff] = await Promise.all([
    prisma.matter.findUnique({ where: { id: matterId }, select: { status: true } }),
    getMatterTimeData(user, matterId),
    getActiveTimer(user.id),
    isAdmin(user)
      ? prisma.user.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
  ]);
  const canRecord = matter?.status !== "CLOSED" || canManageClientsAndMatters(user);
  const today = format(new Date(), "yyyy-MM-dd");
  const yearAgo = format(subYears(new Date(), 1), "yyyy-MM-dd");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Time &amp; Activity</h2>
        <Button size="sm" variant="outline" asChild>
          <a href={`/reports/pdf/matter-time?matterId=${matterId}&from=${yearAgo}&to=${today}`}>
            Download time report (PDF, last 12 months)
          </a>
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total recorded" value={`${formatHours(summary.totalMinutes)} h`} />
        <Stat label="Billable" value={`${formatHours(summary.billableMinutes)} h`} />
        <Stat label="Nonbillable" value={`${formatHours(summary.nonbillableMinutes)} h`} />
        {includeAmounts && summary.billableAmountCents !== undefined ? (
          <Stat label="Billable value (rated entries, admin)" value={formatCents(summary.billableAmountCents)} />
        ) : (
          <Stat label="Entries" value={String(summary.entryCount)} />
        )}
      </div>

      {canRecord ? (
        <div className="space-y-3">
          <TimerControls
            matterId={matterId}
            timer={
              timer
                ? { matterId: timer.matterId, matterLabel: timer.matterLabel, elapsedSeconds: timer.elapsedSeconds, running: timer.running }
                : null
            }
          />
          <TimeEntryForm
            matterId={matterId}
            isAdmin={isAdmin(user)}
            staff={staff.map((s) => ({ id: s.id, label: s.name }))}
          />
        </div>
      ) : (
        <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
          This matter is closed. Its time history is preserved below; only attorneys and admins can record wrap-up time.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>By staff member</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {summary.byUser.length === 0 && <p className="text-muted-foreground">No recorded time.</p>}
            {summary.byUser.map((b) => (
              <p key={b.key} className="flex justify-between gap-2">
                <span>{b.label}</span>
                <span className="tabular-nums">
                  {formatHours(b.minutes)} h <span className="text-muted-foreground">({formatHours(b.billableMinutes)} billable)</span>
                </span>
              </p>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>By activity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {summary.byCategory.length === 0 && <p className="text-muted-foreground">No recorded time.</p>}
            {summary.byCategory.map((b) => (
              <p key={b.key} className="flex justify-between gap-2">
                <span>{b.label}</span>
                <span className="tabular-nums">{formatHours(b.minutes)} h</span>
              </p>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Over time (by month)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {summary.byMonth.length === 0 && <p className="text-muted-foreground">No recorded time.</p>}
            {summary.byMonth.map((b) => (
              <p key={b.key} className="flex justify-between gap-2">
                <span>{b.label}</span>
                <span className="tabular-nums">{formatHours(b.minutes)} h</span>
              </p>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Entry history</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Staff</TableHead>
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
                  <TableCell className="text-sm">{e.user.name}</TableCell>
                  <TableCell className="text-sm">{timeCategoryLabel(e.category)}</TableCell>
                  <TableCell className="max-w-md text-sm">
                    <span className={e.voidedAt ? "line-through" : undefined}>{e.description || "—"}</span>
                    {e.voidedAt && <p className="text-xs text-muted-foreground">Voided: {e.voidReason}</p>}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{formatMinutes(e.durationMinutes)}</TableCell>
                  <TableCell className="space-x-1">
                    <Badge variant={e.billable ? "outline" : "secondary"}>{e.billable ? "Billable" : "Nonbillable"}</Badge>
                    {e.status === "DRAFT" && <Badge variant="warning">Draft</Badge>}
                    {e.voidedAt && <Badge variant="secondary">Void</Badge>}
                  </TableCell>
                  <TableCell>
                    {!e.voidedAt && (e.userId === user.id || isAdmin(user)) && <VoidTimeEntryButton entryId={e.id} />}
                  </TableCell>
                </TableRow>
              ))}
              {entries.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">
                    No time recorded on this matter yet.
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
