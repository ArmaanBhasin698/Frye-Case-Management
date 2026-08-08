import { format } from "date-fns";
import { Flag, Mic, MicOff, PhoneIncoming, PhoneOutgoing } from "lucide-react";

import { getMatterCalls, getMatterHeader, getUnfiledCalls } from "@/lib/matters/queries";
import { formatCallDuration, matterTitle as formatMatterTitle } from "@/lib/matters/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AttachCallList } from "@/components/shared/attach-call-list";

export default async function MatterCallsPage({
  params,
}: {
  params: Promise<{ matterId: string }>;
}) {
  const { matterId } = await params;
  const [matter, calls, unfiledCalls] = await Promise.all([
    getMatterHeader(matterId),
    getMatterCalls(matterId),
    getUnfiledCalls(),
  ]);

  if (!matter) return null;

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-dashed border-border bg-muted/40 p-3 text-sm text-muted-foreground">
        Vonage is not connected yet — these are manually logged calls (see docs/ROADMAP.md, Phase
        6 for the planned integration).
      </div>

      {unfiledCalls.length > 0 && (
        <Card className="border-amber-300">
          <CardHeader>
            <CardTitle>Unfiled calls awaiting review</CardTitle>
            <p className="text-sm text-muted-foreground">
              Calls received firm-wide that haven&apos;t been attached to a matter yet. If one of
              these belongs here, attach it below.
            </p>
          </CardHeader>
          <CardContent>
            <AttachCallList calls={unfiledCalls} matterTitle={formatMatterTitle(matter)} />
          </CardContent>
        </Card>
      )}

      <div>
        <h2 className="mb-3 text-sm font-semibold text-foreground">
          Calls on {formatMatterTitle(matter)}
        </h2>
        {calls.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              No calls logged for this matter yet.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {calls.map((call) => {
              const DirectionIcon = call.direction === "INBOUND" ? PhoneIncoming : PhoneOutgoing;
              return (
                <Card key={call.id}>
                  <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
                    <div className="flex items-start gap-3">
                      <DirectionIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {call.contactName ?? "Unknown contact"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {call.fromNumber} &rarr; {call.toNumber} &middot;{" "}
                          {format(call.occurredAt, "MMM d, yyyy 'at' h:mm a")} &middot;{" "}
                          {formatCallDuration(call.durationSeconds)}
                        </p>
                        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                          {call.recordingDropboxPath ? (
                            <>
                              <Mic className="h-3 w-3" /> Recording available
                            </>
                          ) : (
                            <>
                              <MicOff className="h-3 w-3" /> No recording
                            </>
                          )}
                        </p>
                        {call.notes && (
                          <p className="mt-1 text-sm text-muted-foreground">{call.notes}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {call.flagged && (
                        <Badge variant="warning" className="gap-1">
                          <Flag className="h-3 w-3" /> Flagged
                        </Badge>
                      )}
                      {call.filedBy && (
                        <span className="text-xs text-muted-foreground">
                          Filed by {call.filedBy.name}
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
