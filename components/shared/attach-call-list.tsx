"use client";

import * as React from "react";
import { format } from "date-fns";
import { Flag, Mic, MicOff, PhoneIncoming, PhoneOutgoing } from "lucide-react";

import { formatCallDuration } from "@/lib/matters/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export type UnfiledCallSummary = {
  id: string;
  contactName: string | null;
  direction: "INBOUND" | "OUTBOUND";
  fromNumber: string;
  toNumber: string;
  occurredAt: Date;
  durationSeconds: number;
  recordingDropboxPath: string | null;
  flagged: boolean;
  notes: string | null;
};

/**
 * Mocked "attach an unfiled call to this matter" workflow. There is no
 * Vonage integration and no write path yet (see docs/ROADMAP.md, Phase 6)
 * — clicking "Attach" only updates local component state so the demo can
 * show the intended interaction. Nothing is persisted; refreshing the page
 * resets it.
 */
export function AttachCallList({
  calls,
  matterTitle,
}: {
  calls: UnfiledCallSummary[];
  matterTitle: string;
}) {
  const [attachedIds, setAttachedIds] = React.useState<Set<string>>(new Set());

  if (calls.length === 0) {
    return <p className="text-sm text-muted-foreground">No unfiled calls waiting for review.</p>;
  }

  return (
    <div className="space-y-3">
      {calls.map((call) => {
        const DirectionIcon = call.direction === "INBOUND" ? PhoneIncoming : PhoneOutgoing;
        const isAttached = attachedIds.has(call.id);

        return (
          <Card key={call.id} className={isAttached ? "border-emerald-300 bg-emerald-50/50" : undefined}>
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
                  {call.notes && <p className="mt-1 text-sm text-muted-foreground">{call.notes}</p>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {call.flagged && !isAttached && (
                  <Badge variant="warning" className="gap-1">
                    <Flag className="h-3 w-3" /> Flagged
                  </Badge>
                )}
                {isAttached ? (
                  <Badge variant="success">Attached to {matterTitle}</Badge>
                ) : (
                  <Button size="sm" onClick={() => setAttachedIds((prev) => new Set(prev).add(call.id))}>
                    Attach to {matterTitle}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
      <p className="text-xs text-muted-foreground">
        Demo only — attaching here updates this screen, not the database. Real Vonage call
        filing is a later phase (see docs/ROADMAP.md, Phase 6).
      </p>
    </div>
  );
}
