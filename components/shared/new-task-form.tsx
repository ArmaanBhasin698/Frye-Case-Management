"use client";

import * as React from "react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createTask } from "@/lib/matters/actions";

export function NewTaskForm({ matterId }: { matterId: string }) {
  const [state, formAction, isPending] = useActionState(createTask, { error: null });
  const [open, setOpen] = React.useState(false);
  const [prevState, setPrevState] = React.useState(state);

  // Collapse the form after a successful submit (unmounting it clears its
  // fields, so there's no separate reset step needed). Derived during
  // render, not an effect, so it can't trigger a cascading-render —
  // see https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes.
  if (state !== prevState) {
    setPrevState(state);
    if (!state.error) {
      setOpen(false);
    }
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        New Task
      </Button>
    );
  }

  return (
    <form action={formAction} className="space-y-3 rounded-lg border border-border bg-card p-4">
      <input type="hidden" name="matterId" value={matterId} />

      <div className="space-y-1.5">
        <Label htmlFor="task-title">Title</Label>
        <Input id="task-title" name="title" required placeholder="e.g. Subpoena records custodian" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="task-description">Description</Label>
        <Textarea id="task-description" name="description" placeholder="Optional details" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="task-dueDate">Due date</Label>
          <Input id="task-dueDate" name="dueDate" type="date" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="task-priority">Priority</Label>
          <Select id="task-priority" name="priority" defaultValue="NORMAL">
            <option value="LOW">Low</option>
            <option value="NORMAL">Normal</option>
            <option value="HIGH">High</option>
          </Select>
        </div>
      </div>

      {state.error && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {state.error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Adding…" : "Add Task"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
