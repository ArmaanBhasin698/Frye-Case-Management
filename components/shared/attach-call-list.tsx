"use client";

import * as React from "react";
import { format } from "date-fns";
import { Flag, Mic, MicOff, PhoneIncoming, PhoneOutgoing } from "lucide-react";

import { formatCallDuration } from "@/lib/matters/format";
import { attachCallToMatter } from "@/lib/matters/actions";
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
 * "Attach an unfiled call to this matter" workflow. There is still no
 * Vonage integration (see docs/ROADMAP.md, Phase 6) — these calls are
 * manually logged/seeded — but clicking "Attach" now persists
 * `Call.matterId`/`filedById`/`filedAt` via the `attachCallToMatter`
 * Server Action and survives a refresh.
 */
export function AttachCallList({
  calls,
  matterId,
  matterTitle,
}: {
  calls: UnfiledCallSummary[];
  matterId: string;
  matterTitle: string;
}) {
  const [attachedIds, setAttachedIds] = React.useState<Set<string>>(new Set());
  const [pendingIds, setPendingIds] = React.useState<Set<string>>(new Set());
  const [errorId, setErrorId] = React.useState<string | null>(null);

  if (calls.length === 0) {
    return <p className="text-sm text-muted-foreground">No unfiled calls waiting for review.</p>;
  }

  async function attach(callId: string) {
    setErrorId(null);
    setPendingIds((prev) => new Set(prev).add(callId));
    const result = await attachCallToMatter({ matterId, callId });
    setPendingIds((prev) => {
      const next = new Set(prev);
      next.delete(callId);
      return next;
    });
    if (result.ok) {
      setAttachedIds((prev) => new Set(prev).add(callId));
    } else {
      setErrorId(callId);
    }
  }

  return (
    <div className="space-y-3">
      {calls.map((call) => {
        const DirectionIcon = call.direction === "INBOUND" ? PhoneIncoming : PhoneOutgoing;
        const isAttached = attachedIds.has(call.id);
        const isPending = pendingIds.has(call.id);

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
                  {errorId === call.id && (
                    <p className="mt-1 text-xs font-medium text-destructive" role="alert">
                      Couldn&apos;t attach this call. It may have already been filed elsewhere.
                    </p>
                  )}
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
                  <Button size="sm" disabled={isPending} onClick={() => attach(call.id)}>
                    {isPending ? "Attaching…" : `Attach to ${matterTitle}`}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
      <p className="text-xs text-muted-foreground">
        Attaching a call here saves it to this matter. Automatic Vonage call filing is a later
        phase (see docs/ROADMAP.md, Phase 6) — for now calls land here manually logged/seeded.
      </p>
    </div>
  );
}
