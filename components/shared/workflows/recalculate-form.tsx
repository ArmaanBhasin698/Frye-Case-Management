"use client";

import * as React from "react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatInZone } from "@/lib/calendar/timezone";
import { previewWorkflowRecalculation, recalculateWorkflow, type FormState, type RecalculationPlan } from "@/lib/workflows/actions";

const INITIAL: FormState = { error: null };

/**
 * Preview-only diff of moving one application's open items to a new
 * anchor, then an explicit confirm. Completed/cancelled tasks and past or
 * cancelled events are listed as skipped; Deadlines are never involved.
 */
export function RecalculateWorkflowForm({
  applicationId,
  currentAnchor,
  timeZone,
}: {
  applicationId: string;
  currentAnchor: string;
  timeZone: string;
}) {
  // Task due dates are date-only (UTC midnight of the day); event times are instants shown in the workflow's zone.
  const fmt = (kind: "TASK" | "EVENT", d: Date | null) =>
    !d
      ? "—"
      : kind === "TASK"
        ? new Date(d).toISOString().slice(0, 10)
        : formatInZone(new Date(d), timeZone, { dateStyle: "medium", timeStyle: "short" });
  const [open, setOpen] = React.useState(false);
  const [anchorDate, setAnchorDate] = React.useState(currentAnchor);
  const [plan, setPlan] = React.useState<RecalculationPlan | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [state, formAction, isPending] = useActionState(recalculateWorkflow, INITIAL);
  const [prev, setPrev] = React.useState(state);
  if (state !== prev) {
    setPrev(state);
    if (!state.error) {
      setOpen(false);
      setPlan(null);
    }
  }

  if (!open) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Change anchor date…
      </Button>
    );
  }

  async function runPreview() {
    setError(null);
    const result = await previewWorkflowRecalculation({ applicationId, anchorDate });
    if (result.ok) setPlan(result.data);
    else setError(result.error);
  }

  return (
    <div className="w-full space-y-2 rounded-md border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="date"
          aria-label="New anchor date"
          className="w-44"
          value={anchorDate}
          onChange={(e) => {
            setAnchorDate(e.target.value);
            setPlan(null);
          }}
        />
        <Button type="button" size="sm" variant="outline" onClick={runPreview}>
          Preview changes
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-destructive">{error}</p>}
      {plan && (
        <form action={formAction} className="space-y-2">
          <input type="hidden" name="applicationId" value={applicationId} />
          <input type="hidden" name="anchorDate" value={anchorDate} />
          <p className="font-medium">Will move {plan.moves.length} item(s):</p>
          <ul className="list-disc pl-5 text-xs">
            {plan.moves.map((m) => (
              <li key={m.id}>
                {m.title}: {fmt(m.kind, m.from)} → {fmt(m.kind, m.to)}
              </li>
            ))}
          </ul>
          {plan.skipped.length > 0 && (
            <>
              <p className="font-medium">Left unchanged:</p>
              <ul className="list-disc pl-5 text-xs text-muted-foreground">
                {plan.skipped.map((s) => (
                  <li key={s.id}>
                    {s.title} — {s.reason}
                  </li>
                ))}
              </ul>
            </>
          )}
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" name="confirm" /> I confirm moving these items. Legal deadlines are not affected.
          </label>
          {state.error && <p className="text-destructive">{state.error}</p>}
          <Button type="submit" size="sm" disabled={isPending}>
            Apply new anchor
          </Button>
        </form>
      )}
    </div>
  );
}
