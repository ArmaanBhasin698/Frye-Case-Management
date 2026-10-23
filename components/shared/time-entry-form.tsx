"use client";

import * as React from "react";
import { useActionState } from "react";
import type { TimeActivityCategory } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createTimeEntry, updateTimeEntry, type TimeFormState } from "@/lib/time/actions";
import { TIME_CATEGORY_LABELS, TIME_CATEGORY_VALUES } from "@/lib/time/labels";

const INITIAL: TimeFormState = { error: null };

export type TimeEntryInitial = {
  id: string;
  workDate: string;
  durationMinutes: number;
  category: TimeActivityCategory;
  description: string;
  billable: boolean;
  hourlyRate: string;
};

/**
 * Manual time entry (create), or correcting / confirming an existing entry
 * (`initial` set — including a DRAFT produced by stopping a timer).
 * `matters` renders a picker (firm Time page); `matterId` pins the matter
 * (matter Time tab). Rate and on-behalf-of fields render only for ADMIN,
 * and the server ignores them from anyone else regardless.
 */
export function TimeEntryForm({
  matterId,
  matters,
  staff,
  isAdmin,
  initial,
  submitLabel,
  onDone,
}: {
  matterId?: string;
  matters?: { id: string; label: string }[];
  staff?: { id: string; label: string }[];
  isAdmin: boolean;
  initial?: TimeEntryInitial;
  submitLabel?: string;
  onDone?: () => void;
}) {
  const [state, formAction, isPending] = useActionState(initial ? updateTimeEntry : createTimeEntry, INITIAL);
  const [prev, setPrev] = React.useState(state);
  const [saved, setSaved] = React.useState(false);
  const today = new Date().toISOString().slice(0, 10);

  if (state !== prev) {
    setPrev(state);
    if (!state.error) {
      setSaved(true);
      onDone?.();
    }
  }

  return (
    <form action={formAction} className="space-y-3 rounded-lg border border-border bg-card p-4">
      {initial && <input type="hidden" name="entryId" value={initial.id} />}
      {matterId && <input type="hidden" name="matterId" value={matterId} />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {!matterId && !initial && matters && (
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="te-matter">Matter</Label>
            <Select id="te-matter" name="matterId" required defaultValue="">
              <option value="" disabled>
                Choose a matter…
              </option>
              {matters.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="te-date">Work date</Label>
          <Input id="te-date" name="workDate" type="date" required defaultValue={initial?.workDate ?? today} />
        </div>
        <div className="space-y-1.5">
          <Label>Duration</Label>
          <div className="flex gap-2">
            <Input
              name="hours"
              type="number"
              min={0}
              max={24}
              aria-label="Hours"
              placeholder="h"
              defaultValue={initial ? Math.floor(initial.durationMinutes / 60) : undefined}
            />
            <Input
              name="minutes"
              type="number"
              min={0}
              max={59}
              aria-label="Minutes"
              placeholder="m"
              defaultValue={initial ? initial.durationMinutes % 60 : undefined}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="te-start">Start / end (optional)</Label>
          <div className="flex gap-2">
            <Input id="te-start" name="startTime" type="time" aria-label="Start time" />
            <Input name="endTime" type="time" aria-label="End time" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="te-category">Activity</Label>
          <Select id="te-category" name="category" required defaultValue={initial?.category ?? "LEGAL_RESEARCH"}>
            {TIME_CATEGORY_VALUES.map((c) => (
              <option key={c} value={c}>
                {TIME_CATEGORY_LABELS[c]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2 lg:col-span-4">
          <Label htmlFor="te-description">Work description</Label>
          <Textarea id="te-description" name="description" rows={2} required defaultValue={initial?.description} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="billable" defaultChecked={initial?.billable ?? true} />
          Billable
        </label>
        {isAdmin && (
          <div className="space-y-1.5">
            <Label htmlFor="te-rate">Hourly rate (admin, optional)</Label>
            <Input id="te-rate" name="hourlyRate" inputMode="decimal" placeholder="e.g. 250" defaultValue={initial?.hourlyRate} />
          </div>
        )}
        {isAdmin && !initial && staff && (
          <div className="space-y-1.5">
            <Label htmlFor="te-user">Recorded for</Label>
            <Select id="te-user" name="userId" defaultValue="">
              <option value="">Myself</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Enter hours/minutes, or a start and end time (which takes precedence). Only time you actually worked — app
        usage is never counted as work time.
      </p>
      {state.error && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {state.error}
        </p>
      )}
      {!state.error && state.warning && <p className="text-sm font-medium text-amber-700">{state.warning}</p>}
      {saved && !state.error && !state.warning && <p className="text-sm text-muted-foreground">Saved.</p>}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Saving…" : (submitLabel ?? (initial ? "Save changes" : "Record time"))}
        </Button>
      </div>
    </form>
  );
}
