import Link from "next/link";
import { format } from "date-fns";
import {
  CalendarClock,
  FolderSearch,
  Gavel,
  ListChecks,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
} from "lucide-react";

import {
  getActiveMatters,
  getDashboardStats,
  getOpenTasksAcrossMatters,
  getRecentCallsAcrossMatters,
  getRecentDiscoveryAcrossMatters,
  getUpcomingKeyDates,
} from "@/lib/dashboard/queries";
import {
  calendarEventTypeLabel,
  deadlineTypeLabel,
  discoveryReviewStatusLabel,
  discoveryReviewStatusVariant,
  formatCallDuration,
  formatClientName,
  matterStatusLabel,
  matterStatusVariant,
  matterTitle,
  taskPriorityLabel,
  taskStatusVariant,
} from "@/lib/matters/format";
import { requireCurrentUser } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function DashboardPage() {
  const user = await requireCurrentUser();
  const [stats, activeMatters, keyDates, openTasks, recentDiscovery, recentCalls] =
    await Promise.all([
      getDashboardStats(user),
      getActiveMatters(user, 5),
      getUpcomingKeyDates(user, 6),
      getOpenTasksAcrossMatters(user, 6),
      getRecentDiscoveryAcrossMatters(user, 4),
      getRecentCallsAcrossMatters(user, 6),
    ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Firm-wide overview across all active matters &mdash; fictional demo data.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          icon={Gavel}
          label="Active Matters"
          value={stats.activeMatters}
          href="/matters"
        />
        <StatCard icon={ListChecks} label="Open Tasks" value={stats.openTasks} />
        <StatCard
          icon={CalendarClock}
          label="Court Dates & Deadlines"
          value={stats.upcomingCourtDates + stats.upcomingDeadlines}
        />
        <StatCard icon={PhoneMissed} label="Unfiled Calls" value={stats.unfiledCalls} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Upcoming court dates &amp; deadlines</CardTitle>
            </CardHeader>
            <CardContent>
              {keyDates.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing on the horizon.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {keyDates.map((item) => (
                    <li key={`${item.kind}-${item.id}`} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                      <div className="w-24 shrink-0 text-xs text-muted-foreground">
                        {format(item.date, "MMM d, yyyy")}
                        {item.kind === "event" && (
                          <>
                            <br />
                            {format(item.date, "h:mm a")}
                          </>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/matters/${item.matter.id}`}
                            className="text-sm font-medium text-foreground hover:underline"
                          >
                            {item.title}
                          </Link>
                          <Badge variant={item.kind === "deadline" ? "warning" : "outline"}>
                            {item.kind === "deadline"
                              ? deadlineTypeLabel(item.deadlineType)
                              : calendarEventTypeLabel(item.eventType)}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {matterTitle(item.matter)} &middot; {item.matter.caseNumber}
                          {item.kind === "event" && item.location ? ` · ${item.location}` : ""}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Open tasks</CardTitle>
            </CardHeader>
            <CardContent>
              {openTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">No open tasks firm-wide.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {openTasks.map((task) => (
                    <li key={task.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <Link
                          href={`/matters/${task.matterId}/tasks`}
                          className="text-sm font-medium text-foreground hover:underline"
                        >
                          {task.title}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {matterTitle(task.matter)} &middot;{" "}
                          {task.assignedTo?.name ?? "Unassigned"}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant={taskStatusVariant(task.status)}>
                          {taskPriorityLabel(task.priority)}
                        </Badge>
                        {task.dueDate && (
                          <span className="text-xs text-muted-foreground">
                            {format(task.dueDate, "MMM d")}
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Active matters</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-border">
                {activeMatters.map((matter) => (
                  <li key={matter.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-2">
                      <Link
                        href={`/matters/${matter.id}`}
                        className="text-sm font-medium text-foreground hover:underline"
                      >
                        {matterTitle(matter)}
                      </Link>
                      <Badge variant={matterStatusVariant(matter.status)}>
                        {matterStatusLabel(matter.status)}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatClientName(matter.client)} &middot; {matter.caseNumber}
                    </p>
                  </li>
                ))}
              </ul>
              <Link
                href="/matters"
                className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
              >
                View all matters &rarr;
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FolderSearch className="h-4 w-4" /> Recent discovery
              </CardTitle>
            </CardHeader>
            <CardContent>
              {recentDiscovery.length === 0 ? (
                <p className="text-sm text-muted-foreground">No discovery logged yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {recentDiscovery.map((production) => (
                    <li key={production.id} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex items-center justify-between gap-2">
                        <Link
                          href={`/matters/${production.matterId}/discovery`}
                          className="text-sm font-medium text-foreground hover:underline"
                        >
                          {production.label}
                        </Link>
                        <Badge variant={discoveryReviewStatusVariant(production.reviewStatus)}>
                          {discoveryReviewStatusLabel(production.reviewStatus)}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {matterTitle(production.matter)} &middot; {production.files.length} files
                        &middot; received {format(production.receivedDate, "MMM d, yyyy")}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent calls</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-border">
                {recentCalls.map((call) => {
                  const DirectionIcon = call.direction === "INBOUND" ? PhoneIncoming : PhoneOutgoing;
                  return (
                    <li key={call.id} className="flex items-start gap-2 py-3 first:pt-0 last:pb-0">
                      <DirectionIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          {call.contactName ?? "Unknown"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {format(call.occurredAt, "MMM d, h:mm a")} &middot;{" "}
                          {formatCallDuration(call.durationSeconds)}
                        </p>
                      </div>
                      {call.matter ? (
                        <Link
                          href={`/matters/${call.matter.id}/calls`}
                          className="shrink-0 text-xs text-primary hover:underline"
                        >
                          {matterTitle(call.matter)}
                        </Link>
                      ) : (
                        <Badge variant="destructive" className="shrink-0">
                          Unfiled
                        </Badge>
                      )}
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  href?: string;
}) {
  const content = (
    <Card className={href ? "transition-colors hover:border-primary/40" : undefined}>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-2xl font-semibold text-foreground">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );

  return href ? <Link href={href}>{content}</Link> : content;
}
