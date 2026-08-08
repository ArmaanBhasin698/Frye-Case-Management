import { format } from "date-fns";

import { getMatterAuditEvents } from "@/lib/matters/queries";
import { humanizeEntityType } from "@/lib/matters/format";
import { Card, CardContent } from "@/components/ui/card";

export default async function MatterTimelinePage({
  params,
}: {
  params: Promise<{ matterId: string }>;
}) {
  const { matterId } = await params;
  const events = await getMatterAuditEvents(matterId);

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-dashed border-border bg-muted/40 p-3 text-sm text-muted-foreground">
        This timeline is built from audit log records. No create/edit forms exist yet in this
        milestone, so these entries are seeded for demonstration rather than produced by live
        actions (see CLAUDE.md, section 4.5).
      </div>

      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">No activity recorded for this matter yet.</p>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ol className="divide-y divide-border">
              {events.map((event) => (
                <li key={event.id} className="flex items-start gap-4 p-4">
                  <div className="w-32 shrink-0 text-xs text-muted-foreground">
                    {format(event.occurredAt, "MMM d, yyyy")}
                    <br />
                    {format(event.occurredAt, "h:mm a")}
                  </div>
                  <div className="text-sm">
                    <span className="font-medium text-foreground">
                      {event.actor?.name ?? "System"}
                    </span>{" "}
                    {event.action.toLowerCase()}d a {humanizeEntityType(event.entityType)}
                  </div>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
