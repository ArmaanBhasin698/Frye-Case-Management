"use client";

import * as React from "react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { createDeadline, type FormActionState } from "@/lib/matters/actions";

const INITIAL_STATE: FormActionState = { error: null };

export function NewDeadlineForm({ matterId }: { matterId: string }) {
  const [state, formAction, isPending] = useActionState(createDeadline, INITIAL_STATE);
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
        New Deadline
      </Button>
    );
  }

  return (
    <form action={formAction} className="space-y-3 rounded-lg border border-border bg-card p-4">
      <input type="hidden" name="matterId" value={matterId} />

      <div className="space-y-1.5">
        <Label htmlFor="deadline-description">Description</Label>
        <Input
          id="deadline-description"
          name="description"
          required
          placeholder="e.g. Deadline to file pretrial motions"
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="deadline-type">Type</Label>
          <Select id="deadline-type" name="type" defaultValue="OTHER">
            <option value="STATUTE_OF_LIMITATIONS">Statute of Limitations</option>
            <option value="SPEEDY_TRIAL">Speedy Trial</option>
            <option value="FILING">Filing Deadline</option>
            <option value="OTHER">Other</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="deadline-date">Date</Label>
          <Input id="deadline-date" name="date" type="date" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="deadline-reminderDaysBefore">Remind (days before)</Label>
          <Input
            id="deadline-reminderDaysBefore"
            name="reminderDaysBefore"
            type="number"
            min={0}
            max={365}
            defaultValue={7}
          />
        </div>
      </div>

      {state.error && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {state.error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Creating…" : "Create Deadline"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
