import Link from "next/link";
import { format } from "date-fns";
import { AlertTriangle, CalendarClock } from "lucide-react";
import type { CalendarEventType, DeadlineType } from "@prisma/client";

import {
  getMatterAuditEvents,
  getMatterCalendarEvents,
  getMatterCalls,
  getMatterDeadlines,
  getMatterDiscoveryProductions,
  getMatterHeader,
  getMatterTasks,
} from "@/lib/matters/queries";
import {
  assignmentRoleLabel,
  auditActionPastTense,
  calendarEventTypeLabel,
  daysUntil,
  deadlineTypeLabel,
  formatClientName,
  formatRelativeDays,
  humanizeEntityType,
} from "@/lib/matters/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { QuickActions } from "@/components/shared/quick-actions";

type KeyDate =
  | { kind: "deadline"; id: string; date: Date; title: string; deadlineType: DeadlineType }
  | { kind: "event"; id: string; date: Date; title: string; eventType: CalendarEventType; location: string | null };

export default async function MatterOverviewPage({
  params,
}: {
  params: Promise<{ matterId: string }>;
}) {
  const { matterId } = await params;

  const [matter, tasks, deadlines, events, productions, calls, recentActivity] = await Promise.all([
    getMatterHeader(matterId),
    getMatterTasks(matterId),
    getMatterDeadlines(matterId),
    getMatterCalendarEvents(matterId),
    getMatterDiscoveryProductions(matterId),
    getMatterCalls(matterId),
    getMatterAuditEvents(matterId),
  ]);

  if (!matter) return null;

  const openTasks = tasks.filter((t) => t.status === "OPEN" || t.status === "IN_PROGRESS");
  const discoveryFileCount = productions.reduce((sum, p) => sum + p.files.length, 0);
  const flaggedCalls = calls.filter((c) => c.flagged);

  const now = new Date();
  const keyDates: KeyDate[] = [
    ...deadlines
      .filter((d) => !d.satisfied && d.date >= now)
      .map((d) => ({ kind: "deadline" as const, id: d.id, date: d.date, title: d.description, deadlineType: d.type })),
    ...events
      .filter((e) => e.startTime >= now)
      .map((e) => ({
        kind: "event" as const,
        id: e.id,
        date: e.startTime,
        title: e.title,
        eventType: e.type,
        location: e.location,
      })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());

  const nextKeyDate = keyDates[0];

  return (
    <div className="space-y-6">
      {nextKeyDate && <NextKeyDateBanner item={nextKeyDate} />}

      <Card>
        <CardHeader>
          <CardTitle>Quick actions</CardTitle>
        </CardHeader>
        <CardContent>
          <QuickActions matterId={matterId} />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Case summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <SummaryStat label="Open tasks" value={openTasks.length} />
                <SummaryStat label="Key dates" value={keyDates.length} />
                <SummaryStat
                  label="Discovery files"
                  value={discoveryFileCount}
                  helper={`${productions.length} production${productions.length === 1 ? "" : "s"}`}
                />
                <SummaryStat label="Flagged calls" value={flaggedCalls.length} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Upcoming key dates</CardTitle>
            </CardHeader>
            <CardContent>
              {keyDates.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing scheduled.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {keyDates.map((item) => (
                    <li key={`${item.kind}-${item.id}`} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">{item.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {format(item.date, "MMM d, yyyy")}
                          {item.kind === "event" ? ` · ${format(item.date, "h:mm a")}` : ""}
                          {item.kind === "event" && item.location ? ` · ${item.location}` : ""}
                        </p>
                      </div>
                      <Badge variant={item.kind === "deadline" ? "warning" : "outline"} className="shrink-0">
                        {item.kind === "deadline"
                          ? deadlineTypeLabel(item.deadlineType)
                          : calendarEventTypeLabel(item.eventType)}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent activity</CardTitle>
            </CardHeader>
            <CardContent>
              {recentActivity.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recorded activity yet.</p>
              ) : (
                <ul className="space-y-3">
                  {recentActivity.slice(0, 5).map((event) => (
                    <li key={event.id} className="text-sm">
                      <span className="text-muted-foreground">
                        {format(event.occurredAt, "MMM d, yyyy")}
                      </span>{" "}
                      &mdash; {event.actor?.name ?? "System"} {auditActionPastTense(event.action)} a{" "}
                      {humanizeEntityType(event.entityType)}
                    </li>
                  ))}
                </ul>
              )}
              <Separator className="my-3" />
              <Link
                href={`/matters/${matterId}/timeline`}
                className="text-sm font-medium text-primary hover:underline"
              >
                View full timeline &rarr;
              </Link>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Client</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p className="font-medium text-foreground">{formatClientName(matter.client)}</p>
              {matter.client.email && (
                <p className="text-muted-foreground">{matter.client.email}</p>
              )}
              {matter.client.phone && (
                <p className="text-muted-foreground">{matter.client.phone}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Assigned staff</CardTitle>
            </CardHeader>
            <CardContent>
              {matter.assignments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No staff assigned yet.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {matter.assignments.map((assignment) => (
                    <li key={assignment.id} className="flex items-center justify-between">
                      <span className="font-medium text-foreground">{assignment.user.name}</span>
                      <span className="text-muted-foreground">
                        {assignmentRoleLabel(assignment.role)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function NextKeyDateBanner({ item }: { item: KeyDate }) {
  const relative = formatRelativeDays(item.date);
  const urgent = Math.abs(daysUntil(item.date)) <= 7;

  return (
    <Card
      className={
        urgent
          ? "border-amber-300 bg-amber-50"
          : "border-primary/30 bg-primary/5"
      }
    >
      <CardContent className="flex items-center gap-4 p-4">
        <div
          className={
            urgent
              ? "flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700"
              : "flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
          }
        >
          {urgent ? <AlertTriangle className="h-5 w-5" /> : <CalendarClock className="h-5 w-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Next up &middot; {relative}
          </p>
          <p className="truncate text-sm font-semibold text-foreground">{item.title}</p>
          <p className="text-xs text-muted-foreground">
            {format(item.date, "EEEE, MMM d, yyyy")}
            {item.kind === "event" ? ` at ${format(item.date, "h:mm a")}` : ""}
            {item.kind === "event" && item.location ? ` · ${item.location}` : ""}
          </p>
        </div>
        <Badge variant={item.kind === "deadline" ? "warning" : "outline"} className="shrink-0">
          {item.kind === "deadline"
            ? deadlineTypeLabel(item.deadlineType)
            : calendarEventTypeLabel(item.eventType)}
        </Badge>
      </CardContent>
    </Card>
  );
}

function SummaryStat({
  label,
  value,
  helper,
}: {
  label: string;
  value: number;
  helper?: string;
}) {
  return (
    <div>
      <p className="text-2xl font-semibold text-foreground">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
      {helper && <p className="text-xs text-muted-foreground">{helper}</p>}
    </div>
  );
}
