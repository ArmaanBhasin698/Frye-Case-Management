import Link from "next/link";
import { format } from "date-fns";

import {
  getMatterAuditEvents,
  getMatterDeadlines,
  getMatterDiscoveryProductions,
  getMatterHeader,
  getMatterTasks,
} from "@/lib/matters/queries";
import { assignmentRoleLabel, formatClientName, humanizeEntityType } from "@/lib/matters/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export default async function MatterOverviewPage({
  params,
}: {
  params: Promise<{ matterId: string }>;
}) {
  const { matterId } = await params;

  const [matter, tasks, deadlines, productions, recentActivity] = await Promise.all([
    getMatterHeader(matterId),
    getMatterTasks(matterId),
    getMatterDeadlines(matterId),
    getMatterDiscoveryProductions(matterId),
    getMatterAuditEvents(matterId),
  ]);

  if (!matter) return null;

  const openTasks = tasks.filter((t) => t.status === "OPEN" || t.status === "IN_PROGRESS");
  const upcomingDeadlines = deadlines.filter((d) => !d.satisfied);
  const discoveryFileCount = productions.reduce((sum, p) => sum + p.files.length, 0);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle>Case summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <SummaryStat label="Open tasks" value={openTasks.length} />
              <SummaryStat label="Upcoming deadlines" value={upcomingDeadlines.length} />
              <SummaryStat
                label="Discovery files"
                value={discoveryFileCount}
                helper={`${productions.length} production${productions.length === 1 ? "" : "s"}`}
              />
            </div>
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
                    &mdash; {event.actor?.name ?? "System"} {event.action.toLowerCase()}d a{" "}
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
