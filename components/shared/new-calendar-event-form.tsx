"use client";

import * as React from "react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { createCalendarEvent, type FormActionState } from "@/lib/matters/actions";

const INITIAL_STATE: FormActionState = { error: null };

export function NewCalendarEventForm({ matterId }: { matterId: string }) {
  const [state, formAction, isPending] = useActionState(createCalendarEvent, INITIAL_STATE);
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
        New Event
      </Button>
    );
  }

  return (
    <form action={formAction} className="space-y-3 rounded-lg border border-border bg-card p-4">
      <input type="hidden" name="matterId" value={matterId} />

      <div className="space-y-1.5">
        <Label htmlFor="event-title">Title</Label>
        <Input id="event-title" name="title" required placeholder="e.g. Pretrial Conference" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="event-type">Type</Label>
          <Select id="event-type" name="type" defaultValue="OTHER">
            <option value="HEARING">Hearing</option>
            <option value="DEPOSITION">Deposition</option>
            <option value="MEETING">Meeting</option>
            <option value="OTHER">Other</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="event-location">Location</Label>
          <Input id="event-location" name="location" placeholder="Optional" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="event-startTime">Start</Label>
          <Input id="event-startTime" name="startTime" type="datetime-local" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="event-endTime">End</Label>
          <Input id="event-endTime" name="endTime" type="datetime-local" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="event-notes">Notes</Label>
          <Input id="event-notes" name="notes" placeholder="Optional" />
        </div>
      </div>

      {state.error && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {state.error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Creating…" : "Create Event"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
