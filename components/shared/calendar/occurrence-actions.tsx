"use client";

import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";

import { cancelOccurrence, restoreOccurrence, updateOccurrence, type EventFormState } from "@/lib/calendar/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function useOccurrenceAction(action: typeof cancelOccurrence, eventId: string, originalStart: string) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function run(confirmMessage: string) {
    if (!window.confirm(confirmMessage)) return;
    setError(null);
    setPending(true);
    const result = await action({ eventId, originalStart });
    setPending(false);
    if (!result.ok) setError(result.error);
  }
  return { pending, error, run };
}

/** Cancels only this occurrence; the rest of the series is unchanged. */
export function CancelOccurrenceButton({ eventId, originalStart }: { eventId: string; originalStart: string }) {
  const { pending, error, run } = useOccurrenceAction(cancelOccurrence, eventId, originalStart);
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => run("Cancel only this occurrence? The rest of the series is unchanged and it stays in history as cancelled.")}
      >
        {pending ? "…" : "Cancel this occurrence"}
      </Button>
      {error && (
        <span className="text-xs font-medium text-destructive" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

/** Removes this occurrence's exception so it follows the series again. */
export function RestoreOccurrenceButton({ eventId, originalStart }: { eventId: string; originalStart: string }) {
  const { pending, error, run } = useOccurrenceAction(restoreOccurrence, eventId, originalStart);
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => run("Restore this occurrence to the series' normal time and details?")}>
        {pending ? "…" : "Restore to series"}
      </Button>
      {error && (
        <span className="text-xs font-medium text-destructive" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

const INITIAL_STATE: EventFormState = { error: null };

export type OccurrenceFormInitial = {
  eventId: string;
  originalStart: string;
  allDay: boolean;
  timeZone: string;
  start: string;
  end: string;
  title: string;
  location: string;
  meetingUrl: string;
};

/**
 * Edits ONE occurrence of a repeating event (time, title, location, link).
 * Blank title/location/link fall back to the series value. Submitted via
 * onSubmit so a validation error keeps what the user typed.
 */
export function OccurrenceForm({ initial, cancelHref }: { initial: OccurrenceFormInitial; cancelHref: string }) {
  const [state, formAction, isPending] = useActionState(updateOccurrence, INITIAL_STATE);
  const [, startTransition] = React.useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-border bg-card p-6">
      <input type="hidden" name="eventId" value={initial.eventId} />
      <input type="hidden" name="originalStart" value={initial.originalStart} />
      <p className="text-sm text-muted-foreground">
        Changes apply to this occurrence only. Times are in {initial.timeZone.replace("_", " ")}. Leave the title,
        location, or link blank to keep the series&apos; value.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="occ-start">{initial.allDay ? "Start date" : "Starts"}</Label>
          <Input id="occ-start" name="start" type={initial.allDay ? "date" : "datetime-local"} required defaultValue={initial.start} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="occ-end">{initial.allDay ? "End date" : "Ends"}</Label>
          <Input id="occ-end" name="end" type={initial.allDay ? "date" : "datetime-local"} defaultValue={initial.end} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="occ-title">Title for this occurrence (optional)</Label>
          <Input id="occ-title" name="title" defaultValue={initial.title} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="occ-location">Location (optional)</Label>
          <Input id="occ-location" name="location" defaultValue={initial.location} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="occ-meeting">Meeting link (optional)</Label>
          <Input id="occ-meeting" name="meetingUrl" type="url" inputMode="url" defaultValue={initial.meetingUrl} />
        </div>
      </div>
      {state.error && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {state.error}
        </p>
      )}
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="ghost" size="sm" asChild>
          <Link href={cancelHref}>Cancel</Link>
        </Button>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Saving…" : "Save this occurrence"}
        </Button>
      </div>
    </form>
  );
}
