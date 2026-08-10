"use client";

import * as React from "react";
import { useActionState } from "react";
import { format } from "date-fns";
import { CalendarClock } from "lucide-react";
import type { CalendarEventType } from "@prisma/client";

import { calendarEventTypeLabel } from "@/lib/matters/format";
import { updateCalendarEvent, type FormActionState } from "@/lib/matters/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

export type CalendarEventSummary = {
  id: string;
  title: string;
  type: CalendarEventType;
  startTime: Date;
  endTime: Date | null;
  location: string | null;
  notes: string | null;
};

const INITIAL_STATE: FormActionState = { error: null };

/** `datetime-local` inputs need "yyyy-MM-ddTHH:mm", not date-fns's default ISO format. */
function toDateTimeLocal(date: Date) {
  return format(date, "yyyy-MM-dd'T'HH:mm");
}

function CalendarEventEditForm({
  matterId,
  event,
  onDone,
}: {
  matterId: string;
  event: CalendarEventSummary;
  onDone: () => void;
}) {
  const [state, formAction, isPending] = useActionState(updateCalendarEvent, INITIAL_STATE);

  // Call onDone from an effect, not during render — the state transition
  // means the update already committed, and this component's parent owns
  // `editing`, so we can't update it synchronously while this component
  // is still rendering.
  React.useEffect(() => {
    if (state !== INITIAL_STATE && !state.error) {
      onDone();
    }
  }, [state, onDone]);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="matterId" value={matterId} />
      <input type="hidden" name="eventId" value={event.id} />

      <div className="space-y-1.5">
        <Label htmlFor={`event-title-${event.id}`}>Title</Label>
        <Input id={`event-title-${event.id}`} name="title" required defaultValue={event.title} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`event-type-${event.id}`}>Type</Label>
          <Select id={`event-type-${event.id}`} name="type" defaultValue={event.type}>
            <option value="HEARING">Hearing</option>
            <option value="DEPOSITION">Deposition</option>
            <option value="MEETING">Meeting</option>
            <option value="OTHER">Other</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`event-location-${event.id}`}>Location</Label>
          <Input id={`event-location-${event.id}`} name="location" defaultValue={event.location ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`event-startTime-${event.id}`}>Start</Label>
          <Input
            id={`event-startTime-${event.id}`}
            name="startTime"
            type="datetime-local"
            required
            defaultValue={toDateTimeLocal(event.startTime)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`event-endTime-${event.id}`}>End</Label>
          <Input
            id={`event-endTime-${event.id}`}
            name="endTime"
            type="datetime-local"
            defaultValue={event.endTime ? toDateTimeLocal(event.endTime) : ""}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`event-notes-${event.id}`}>Notes</Label>
          <Input id={`event-notes-${event.id}`} name="notes" defaultValue={event.notes ?? ""} />
        </div>
      </div>

      {state.error && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {state.error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function CalendarEventRow({ matterId, event }: { matterId: string; event: CalendarEventSummary }) {
  const [editing, setEditing] = React.useState(false);

  if (editing) {
    return (
      <Card>
        <CardContent className="p-4">
          <CalendarEventEditForm matterId={matterId} event={event} onDone={() => setEditing(false)} />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="flex items-start gap-3">
          <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium text-foreground">{event.title}</p>
            <p className="text-xs text-muted-foreground">
              {format(event.startTime, "MMM d, yyyy 'at' h:mm a")}
              {event.endTime ? ` – ${format(event.endTime, "h:mm a")}` : ""}
              {event.location ? ` · ${event.location}` : ""}
            </p>
            {event.notes && <p className="mt-1 text-sm text-muted-foreground">{event.notes}</p>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="outline">{calendarEventTypeLabel(event.type)}</Badge>
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function CalendarEventList({
  matterId,
  events,
}: {
  matterId: string;
  events: CalendarEventSummary[];
}) {
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">No calendar events recorded for this matter.</p>;
  }

  return (
    <div className="space-y-3">
      {events.map((event) => (
        <CalendarEventRow key={event.id} matterId={matterId} event={event} />
      ))}
    </div>
  );
}
