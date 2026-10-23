"use client";

import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";
import type { RecurrenceFrequency } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createEvent, updateEvent, type EventFormState } from "@/lib/calendar/actions";
import {
  ADDITIONAL_REMINDER_OPTIONS,
  CALENDAR_EVENT_TYPE_VALUES,
  EVENT_STATUS_LABELS,
  EVENT_STATUS_VALUES,
  RECURRENCE_LABELS,
  RECURRENCE_VALUES,
  REMINDER_OPTIONS,
} from "@/lib/calendar/fields";
import { COMMON_TIME_ZONES } from "@/lib/calendar/timezone";
import { calendarEventTypeLabel } from "@/lib/matters/format";
import type { EventFormInitial } from "@/lib/calendar/form-initial";

const INITIAL_STATE: EventFormState = { error: null };

type Option = { id: string; label: string };


/**
 * Create/edit form for a calendar event. Option lists arrive pre-scoped
 * (visible matters/contacts, active staff); the Server Action re-validates
 * every id. Submitted via onSubmit + startTransition so a validation error
 * doesn't reset what the user typed.
 */
export function EventForm({
  initial,
  matters,
  staff,
  contacts,
  cancelHref,
  notice,
}: {
  initial: EventFormInitial;
  matters: Option[];
  staff: Option[];
  contacts: Option[];
  cancelHref: string;
  /** Optional context line (e.g. "This contact is on 2 of your matters — choose one"). */
  notice?: string;
}) {
  const isEdit = Boolean(initial.id);
  const [state, formAction, isPending] = useActionState(isEdit ? updateEvent : createEvent, INITIAL_STATE);
  const [allDay, setAllDay] = React.useState(initial.allDay);
  const [recurrence, setRecurrence] = React.useState<RecurrenceFrequency>(initial.recurrenceFrequency);
  const [, startTransition] = React.useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  // Switching between timed and all-day keeps the date part of what was entered.
  const startDefault = allDay ? initial.start.slice(0, 10) : initial.start.length === 10 ? `${initial.start}T09:00` : initial.start;
  const endDefault = allDay ? initial.end.slice(0, 10) : initial.end.length === 10 ? "" : initial.end;

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-lg border border-border bg-card p-6">
      {initial.id && <input type="hidden" name="eventId" value={initial.id} />}
      {notice && <p className="rounded-md border border-border bg-muted/40 p-2 text-sm text-muted-foreground">{notice}</p>}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="ev-title">Title</Label>
          <Input id="ev-title" name="title" required defaultValue={initial.title} placeholder="e.g. Client meeting — plea options" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ev-type">Type</Label>
          <Select id="ev-type" name="type" defaultValue={initial.type}>
            {CALENDAR_EVENT_TYPE_VALUES.map((t) => (
              <option key={t} value={t}>
                {calendarEventTypeLabel(t)}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ev-status">Status</Label>
          <Select id="ev-status" name="status" defaultValue={initial.status}>
            {EVENT_STATUS_VALUES.map((s) => (
              <option key={s} value={s}>
                {EVENT_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="ev-matter">Matter (optional)</Label>
          <Select id="ev-matter" name="matterId" defaultValue={initial.matterId}>
            <option value="">No matter — internal event</option>
            {matters.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="space-y-3 rounded-md border border-border p-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="allDay" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
          All-day
        </label>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="ev-start">{allDay ? "Start date" : "Starts"}</Label>
            <Input key={`start-${allDay}`} id="ev-start" name="start" type={allDay ? "date" : "datetime-local"} required defaultValue={startDefault} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ev-end">{allDay ? "End date" : "Ends"}</Label>
            <Input key={`end-${allDay}`} id="ev-end" name="end" type={allDay ? "date" : "datetime-local"} defaultValue={endDefault} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ev-tz">Time zone</Label>
            <Select id="ev-tz" name="timeZone" defaultValue={initial.timeZone}>
              {[...new Set([initial.timeZone, ...COMMON_TIME_ZONES])].map((tz) => (
                <option key={tz} value={tz}>
                  {tz.replace("_", " ")}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="ev-recurrence">Repeats</Label>
            <Select
              id="ev-recurrence"
              name="recurrenceFrequency"
              value={recurrence}
              onChange={(e) => setRecurrence(e.target.value as RecurrenceFrequency)}
            >
              {RECURRENCE_VALUES.map((r) => (
                <option key={r} value={r}>
                  {RECURRENCE_LABELS[r]}
                </option>
              ))}
            </Select>
          </div>
          {recurrence !== "NONE" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="ev-interval">Every</Label>
                <Input id="ev-interval" name="recurrenceInterval" type="number" min={1} max={52} defaultValue={initial.recurrenceInterval} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ev-until">Until (optional)</Label>
                <Input id="ev-until" name="recurrenceUntil" type="date" defaultValue={initial.recurrenceUntil} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ev-count">Or number of times</Label>
                <Input id="ev-count" name="recurrenceCount" type="number" min={1} max={500} defaultValue={initial.recurrenceCount} />
              </div>
            </>
          )}
        </div>
        {recurrence !== "NONE" && (
          <p className="text-xs text-muted-foreground">
            Edits and cancellation apply to every occurrence in the series.
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="ev-location">Location</Label>
          <Input id="ev-location" name="location" defaultValue={initial.location} placeholder="Courtroom, office, or address" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ev-meeting">Meeting link (optional)</Label>
          <Input
            id="ev-meeting"
            name="meetingUrl"
            type="url"
            inputMode="url"
            defaultValue={initial.meetingUrl}
            placeholder="https://zoom.us/j/… · Teams · Google Meet"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ev-reminder">Reminder</Label>
          <Select id="ev-reminder" name="reminderMinutesBefore" defaultValue={initial.reminderMinutesBefore}>
            {REMINDER_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">Shown in-app on the dashboard; no email or text is sent.</p>
        </div>
        <fieldset className="space-y-1.5 sm:col-span-2">
          <legend className="text-sm font-medium">Additional reminders</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {ADDITIONAL_REMINDER_OPTIONS.map((r) => (
              <label key={r.value} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="reminderOffsetsMinutes"
                  value={r.value}
                  defaultChecked={initial.reminderOffsetsMinutes.includes(r.value)}
                />
                {r.label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="ev-description">Description</Label>
          <Textarea id="ev-description" name="description" rows={3} defaultValue={initial.description} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">Staff attendees</legend>
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-2">
            {staff.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="attendeeIds" value={s.id} defaultChecked={initial.attendeeIds.includes(s.id)} />
                {s.label}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">Linked contacts</legend>
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-2">
            {contacts.length === 0 && <p className="text-xs text-muted-foreground">No contacts available.</p>}
            {contacts.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="contactIds" value={c.id} defaultChecked={initial.contactIds.includes(c.id)} />
                {c.label}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      {isEdit && initial.recurrenceFrequency !== "NONE" && (
        <p className="rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
          You are editing the entire series. Individually changed or cancelled occurrences are kept when their original date
          is still part of the series; any that no longer are will be removed.
        </p>
      )}

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
          {isPending ? "Saving…" : isEdit ? "Save event" : "Create event"}
        </Button>
      </div>
    </form>
  );
}
