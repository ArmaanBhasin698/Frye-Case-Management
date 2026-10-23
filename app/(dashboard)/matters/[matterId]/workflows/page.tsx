import { randomUUID } from "crypto";
import Link from "next/link";
import { format } from "date-fns";

import { requireCurrentUser } from "@/lib/auth/session";
import { assertMatterAccess } from "@/lib/auth/access";
import { canApplyWorkflow, listApplicableTemplates, listMatterApplications } from "@/lib/workflows/queries";
import { WORKFLOW_TIME_ZONES } from "@/lib/workflows/fields";
import { dateKeyInZone, FIRM_TIME_ZONE, formatInZone, DATE_TIME_WITH_ZONE } from "@/lib/calendar/timezone";
import { asCalendarDate, taskStatusLabel, taskStatusVariant } from "@/lib/matters/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApplyWorkflowPanel } from "@/components/shared/workflows/apply-workflow-panel";
import { RecalculateWorkflowForm } from "@/components/shared/workflows/recalculate-form";

/**
 * Matter Workflows tab: apply a template (preview → confirm) and review
 * every past application with the exact template version used and the live
 * status of what it created. Applying is limited to ADMIN and the matter's
 * assigned ATTORNEY/PARALEGAL; everyone with matter access sees history.
 */
export default async function MatterWorkflowsPage({ params }: { params: Promise<{ matterId: string }> }) {
  const { matterId } = await params;
  const user = await requireCurrentUser();
  await assertMatterAccess(user, matterId);

  const [mayApply, templates, applications] = await Promise.all([
    canApplyWorkflow(user, matterId),
    listApplicableTemplates(),
    listMatterApplications(matterId),
  ]);
  // A fresh key per render: resubmitting this form can't duplicate, a new render is a deliberate new application.
  const requestKey = randomUUID();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Apply a workflow</CardTitle>
        </CardHeader>
        <CardContent>
          {mayApply ? (
            <ApplyWorkflowPanel
              matterId={matterId}
              requestKey={requestKey}
              templates={templates.map((t) => ({ versionId: t.version.id, label: `${t.name} (v${t.version.version}, ${t.version.steps.length} steps)` }))}
              timeZones={WORKFLOW_TIME_ZONES}
              defaultAnchor={dateKeyInZone(new Date(), FIRM_TIME_ZONE)}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Only admins and attorneys or paralegals assigned to this matter can apply workflows.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Applied workflows</CardTitle>
        </CardHeader>
        <CardContent>
          {applications.length === 0 ? (
            <p className="text-sm text-muted-foreground">No workflows applied to this matter yet.</p>
          ) : (
            <ul className="space-y-4">
              {applications.map((app) => {
                const anchor = app.anchorDate.toISOString().slice(0, 10);
                return (
                  <li key={app.id} className="space-y-2 rounded-md border border-border p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">
                          {app.templateVersion.template.name} <Badge variant="outline">v{app.templateVersion.version}</Badge>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Anchor {anchor} ({app.timeZone}) · applied {format(app.createdAt, "MMM d, yyyy h:mm a")}
                          {app.appliedBy ? ` by ${app.appliedBy.name}` : ""}
                          {app.recalculatedAt ? ` · recalculated ${format(app.recalculatedAt, "MMM d, yyyy")}` : ""}
                        </p>
                      </div>
                      {mayApply && <RecalculateWorkflowForm applicationId={app.id} currentAnchor={anchor} timeZone={app.timeZone} />}
                    </div>
                    <ul className="divide-y divide-border">
                      {app.tasks.map((t) => (
                        <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                          <span>
                            <Badge variant="outline">Task</Badge>{" "}
                            <Link href={`/matters/${matterId}/tasks`} className="hover:underline">
                              {t.title}
                            </Link>
                            <span className="text-xs text-muted-foreground">
                              {" "}
                              · due {t.dueDate ? format(asCalendarDate(t.dueDate), "MMM d, yyyy") : "—"} · {t.assignedTo?.name ?? "Unassigned"}
                            </span>
                          </span>
                          <Badge variant={taskStatusVariant(t.status)}>{taskStatusLabel(t.status)}</Badge>
                        </li>
                      ))}
                      {app.events.map((e) => (
                        <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                          <span>
                            <Badge variant="outline">Event</Badge>{" "}
                            <Link href={`/calendar/events/${e.id}`} className="hover:underline">
                              {e.title}
                            </Link>
                            <span className="text-xs text-muted-foreground">
                              {" "}
                              ·{" "}
                              {e.allDay
                                ? formatInZone(e.startTime, e.timeZone, { dateStyle: "medium" })
                                : formatInZone(e.startTime, e.timeZone, DATE_TIME_WITH_ZONE)}
                            </span>
                          </span>
                          <Badge variant={e.status === "CANCELLED" ? "secondary" : "outline"}>{e.status.toLowerCase()}</Badge>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
