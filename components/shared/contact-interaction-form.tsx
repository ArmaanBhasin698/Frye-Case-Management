"use client";

import * as React from "react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { recordContactInteraction, setInteractionFollowUpStatus, type FormActionState } from "@/lib/contacts/actions";
import {
  FOLLOW_UP_STATUS_LABELS,
  FOLLOW_UP_STATUS_VALUES,
  INTERACTION_TYPE_LABELS,
  INTERACTION_TYPE_VALUES,
} from "@/lib/contacts/labels";

const INITIAL_STATE: FormActionState = { error: null };

type Option = { id: string; label: string };

/**
 * Manually record an interaction that already happened. Phone calls can
 * also be logged from a matter's Calls tab and linked to this contact
 * there; both appear on the same timeline.
 */
export function ContactInteractionForm({
  contactId,
  matters,
  staff,
  currentUserId,
}: {
  contactId: string;
  matters: Option[];
  staff: Option[];
  currentUserId: string;
}) {
  const [state, formAction, isPending] = useActionState(recordContactInteraction, INITIAL_STATE);
  const [open, setOpen] = React.useState(false);
  const [prevState, setPrevState] = React.useState(state);

  if (state !== prevState) {
    setPrevState(state);
    if (!state.error) setOpen(false);
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Record interaction
      </Button>
    );
  }

  return (
    <form action={formAction} className="space-y-3 rounded-lg border border-border bg-card p-4">
      <input type="hidden" name="contactId" value={contactId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="int-type">Type</Label>
          <Select id="int-type" name="type" required defaultValue="MEETING">
            {INTERACTION_TYPE_VALUES.map((t) => (
              <option key={t} value={t}>
                {INTERACTION_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="int-occurredAt">When it happened</Label>
          <Input id="int-occurredAt" name="occurredAt" type="datetime-local" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="int-staff">Staff member</Label>
          <Select id="int-staff" name="staffId" defaultValue={currentUserId}>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="int-matter">Matter (optional)</Label>
          <Select id="int-matter" name="matterId" defaultValue="">
            <option value="">Not matter-specific</option>
            {matters.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="int-summary">Brief description</Label>
          <Textarea id="int-summary" name="summary" rows={2} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="int-outcome">Outcome (optional)</Label>
          <Input id="int-outcome" name="outcome" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="int-followUp">Follow-up</Label>
          <Select id="int-followUp" name="followUpStatus" defaultValue="NONE">
            {FOLLOW_UP_STATUS_VALUES.map((f) => (
              <option key={f} value={f}>
                {FOLLOW_UP_STATUS_LABELS[f]}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {state.error && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {state.error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}

export function CompleteFollowUpButton({ interactionId }: { interactionId: string }) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function complete() {
    setError(null);
    setPending(true);
    const result = await setInteractionFollowUpStatus({ interactionId, followUpStatus: "COMPLETED" });
    setPending(false);
    if (!result.ok) setError(result.error);
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button variant="outline" size="sm" disabled={pending} onClick={complete}>
        Mark follow-up complete
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}
