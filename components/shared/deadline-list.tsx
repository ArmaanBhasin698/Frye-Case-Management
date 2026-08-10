"use client";

import * as React from "react";
import { useActionState } from "react";
import { format } from "date-fns";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { DeadlineType } from "@prisma/client";

import { deadlineTypeLabel } from "@/lib/matters/format";
import { setDeadlineSatisfied, updateDeadline, type FormActionState } from "@/lib/matters/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

export type DeadlineSummary = {
  id: string;
  type: DeadlineType;
  date: Date;
  description: string;
  reminderDaysBefore: number;
  satisfied: boolean;
};

const INITIAL_STATE: FormActionState = { error: null };

function DeadlineEditForm({
  matterId,
  deadline,
  onDone,
}: {
  matterId: string;
  deadline: DeadlineSummary;
  onDone: () => void;
}) {
  const [state, formAction, isPending] = useActionState(updateDeadline, INITIAL_STATE);

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
      <input type="hidden" name="deadlineId" value={deadline.id} />

      <div className="space-y-1.5">
        <Label htmlFor={`deadline-description-${deadline.id}`}>Description</Label>
        <Input
          id={`deadline-description-${deadline.id}`}
          name="description"
          required
          defaultValue={deadline.description}
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={`deadline-type-${deadline.id}`}>Type</Label>
          <Select id={`deadline-type-${deadline.id}`} name="type" defaultValue={deadline.type}>
            <option value="STATUTE_OF_LIMITATIONS">Statute of Limitations</option>
            <option value="SPEEDY_TRIAL">Speedy Trial</option>
            <option value="FILING">Filing Deadline</option>
            <option value="OTHER">Other</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`deadline-date-${deadline.id}`}>Date</Label>
          <Input
            id={`deadline-date-${deadline.id}`}
            name="date"
            type="date"
            required
            defaultValue={format(deadline.date, "yyyy-MM-dd")}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`deadline-reminder-${deadline.id}`}>Remind (days before)</Label>
          <Input
            id={`deadline-reminder-${deadline.id}`}
            name="reminderDaysBefore"
            type="number"
            min={0}
            max={365}
            defaultValue={deadline.reminderDaysBefore}
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
          {isPending ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function DeadlineRow({ matterId, deadline }: { matterId: string; deadline: DeadlineSummary }) {
  const [editing, setEditing] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function toggleSatisfied() {
    setError(null);
    setPending(true);
    const result = await setDeadlineSatisfied({
      matterId,
      deadlineId: deadline.id,
      satisfied: !deadline.satisfied,
    });
    setPending(false);
    if (!result.ok) setError(result.error);
  }

  if (editing) {
    return (
      <Card>
        <CardContent className="p-4">
          <DeadlineEditForm matterId={matterId} deadline={deadline} onDone={() => setEditing(false)} />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="flex items-start gap-3">
          {deadline.satisfied ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          )}
          <div>
            <p className="text-sm font-medium text-foreground">{deadline.description}</p>
            <p className="text-xs text-muted-foreground">
              {deadlineTypeLabel(deadline.type)} &middot; {format(deadline.date, "MMM d, yyyy")}
            </p>
            {error && (
              <p className="mt-1 text-xs font-medium text-destructive" role="alert">
                {error}
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant={deadline.satisfied ? "success" : "outline"}>
            {deadline.satisfied ? "Satisfied" : "Upcoming"}
          </Badge>
          <Button variant="ghost" size="sm" disabled={pending} onClick={toggleSatisfied}>
            {pending ? "…" : deadline.satisfied ? "Mark incomplete" : "Mark complete"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function DeadlineList({ matterId, deadlines }: { matterId: string; deadlines: DeadlineSummary[] }) {
  if (deadlines.length === 0) {
    return <p className="text-sm text-muted-foreground">No deadlines recorded for this matter.</p>;
  }

  return (
    <div className="space-y-3">
      {deadlines.map((deadline) => (
        <DeadlineRow key={deadline.id} matterId={matterId} deadline={deadline} />
      ))}
    </div>
  );
}
