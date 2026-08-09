"use client";

import * as React from "react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { createCall, type FormActionState } from "@/lib/matters/actions";

const INITIAL_STATE: FormActionState = { error: null };

export type LogCallMatterOption = { id: string; label: string };

/**
 * The real "Log a Call" workflow (see docs/ROADMAP.md — no Vonage/telephony
 * integration exists yet; this is the internal Call-creation write path a
 * future telephony sync would eventually feed instead of a human filling
 * this form). Used two ways, never both at once:
 *  - Matter-scoped (Matter Calls tab, Matter Overview quick action): pass
 *    `matterId`, which becomes a hidden field — no picker, matching
 *    `NewDeadlineForm`/`NewCalendarEventForm`.
 *  - Firm-wide (Communications page): pass `matters` (already scoped
 *    server-side to what the current user may see) instead, which renders
 *    a picker including an explicit "Unfiled" option. The submitted
 *    `matterId` is still independently re-verified server-side
 *    (`lib/matters/actions.ts#createCall`) — this picker is a convenience,
 *    not the access control.
 */
export function LogCallForm({
  matterId,
  matters,
}: {
  matterId?: string;
  matters?: LogCallMatterOption[];
}) {
  const [state, formAction, isPending] = useActionState(createCall, INITIAL_STATE);
  const [open, setOpen] = React.useState(false);
  const [prevState, setPrevState] = React.useState(state);

  if (state !== prevState) {
    setPrevState(state);
    if (!state.error) {
      setOpen(false);
    }
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Log a Call
      </Button>
    );
  }

  return (
    <form action={formAction} className="space-y-3 rounded-lg border border-border bg-card p-4">
      {matterId ? (
        <input type="hidden" name="matterId" value={matterId} />
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="call-matterId">Matter</Label>
          <Select id="call-matterId" name="matterId" defaultValue="">
            <option value="">Unfiled (file later)</option>
            {matters?.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </Select>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="call-direction">Direction</Label>
          <Select id="call-direction" name="direction" defaultValue="OUTBOUND">
            <option value="OUTBOUND">Outbound</option>
            <option value="INBOUND">Inbound</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="call-contactName">Contact name</Label>
          <Input id="call-contactName" name="contactName" placeholder="Optional" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="call-fromNumber">From</Label>
          <Input id="call-fromNumber" name="fromNumber" required placeholder="e.g. 555-0100" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="call-toNumber">To</Label>
          <Input id="call-toNumber" name="toNumber" required placeholder="e.g. 555-0142" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="call-occurredAt">When</Label>
          <Input id="call-occurredAt" name="occurredAt" type="datetime-local" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="call-durationSeconds">Duration (seconds)</Label>
          <Input
            id="call-durationSeconds"
            name="durationSeconds"
            type="number"
            min={0}
            max={86400}
            required
            defaultValue={60}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="call-notes">Summary / notes</Label>
          <Input id="call-notes" name="notes" placeholder="Optional" />
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" name="flagged" className="h-3.5 w-3.5" />
        Flag for follow-up
      </label>

      {state.error && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {state.error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Logging…" : "Log Call"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
