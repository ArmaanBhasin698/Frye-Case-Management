"use client";

import * as React from "react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { correctObservation, recordObservation, type FormActionState } from "@/lib/history/actions";
import {
  OBSERVATION_CATEGORY_LABELS,
  OBSERVATION_CATEGORY_VALUES,
  OBSERVATION_KIND_LABELS,
  OBSERVATION_KIND_VALUES,
} from "@/lib/history/labels";

const INITIAL: FormActionState = { error: null };
type Option = { id: string; label: string };

/**
 * Record (or correct) an attorney observation about a professional.
 * Defaults to matter-restricted; sharing firm-wide is an explicit choice
 * that drops the matter link and requires confirming the note contains no
 * privileged or matter-specific information.
 */
export function ObservationForm({
  subjects,
  matters,
  fixedSubjectId,
  fixedMatterId,
  correcting,
}: {
  subjects?: Option[];
  matters?: Option[];
  fixedSubjectId?: string;
  fixedMatterId?: string;
  correcting?: { id: string; category: string; kind: string; body: string; references: string; shareScope: string; matterId: string };
}) {
  const [state, formAction, isPending] = useActionState(correcting ? correctObservation : recordObservation, INITIAL);
  const [open, setOpen] = React.useState(false);
  const [scope, setScope] = React.useState(correcting?.shareScope ?? "MATTER_ONLY");
  const [prev, setPrev] = React.useState(state);
  if (state !== prev) {
    setPrev(state);
    if (!state.error) setOpen(false);
  }

  if (!open) {
    return (
      <Button variant={correcting ? "ghost" : "outline"} size="sm" onClick={() => setOpen(true)}>
        {correcting ? "Correct" : "Add observation"}
      </Button>
    );
  }

  const c = correcting;
  return (
    <form action={formAction} className="w-full space-y-3 rounded-lg border border-border bg-card p-4">
      {c && <input type="hidden" name="observationId" value={c.id} />}
      {fixedSubjectId && <input type="hidden" name="subjectContactId" value={fixedSubjectId} />}
      <div className="grid gap-3 sm:grid-cols-2">
        {!fixedSubjectId && subjects && (
          <div className="space-y-1.5">
            <Label htmlFor="o-subject">About</Label>
            <Select id="o-subject" name="subjectContactId" required defaultValue="">
              <option value="" disabled>
                Choose a professional…
              </option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="o-kind">Type</Label>
          <Select id="o-kind" name="kind" defaultValue={c?.kind ?? "PROCEDURAL_OBSERVATION"}>
            {OBSERVATION_KIND_VALUES.map((v) => (
              <option key={v} value={v}>
                {OBSERVATION_KIND_LABELS[v]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="o-cat">Category</Label>
          <Select id="o-cat" name="category" defaultValue={c?.category ?? "HEARING_PROCEDURE"}>
            {OBSERVATION_CATEGORY_VALUES.map((v) => (
              <option key={v} value={v}>
                {OBSERVATION_CATEGORY_LABELS[v]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="o-scope">Visibility</Label>
          <Select id="o-scope" name="shareScope" value={scope} onChange={(e) => setScope(e.target.value)} disabled={Boolean(c)}>
            <option value="MATTER_ONLY">Restricted to one matter (default)</option>
            <option value="FIRM_ATTORNEYS">Firm-wide reference note (attorneys)</option>
          </Select>
          {c && <input type="hidden" name="shareScope" value={scope} />}
        </div>
        {scope === "MATTER_ONLY" &&
          (fixedMatterId || c?.matterId ? (
            <input type="hidden" name="matterId" value={fixedMatterId ?? c?.matterId} />
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="o-matter">Matter</Label>
              <Select id="o-matter" name="matterId" required defaultValue="">
                <option value="" disabled>
                  Choose a matter…
                </option>
                {(matters ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </div>
          ))}
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="o-body">Observation</Label>
          <Textarea id="o-body" name="body" rows={3} required defaultValue={c?.body} />
          <p className="text-xs text-muted-foreground">
            Record practical, factual professional observations. This is an attorney&apos;s note, not a verified ruling —
            avoid conclusions about fairness, bias, or future decisions.
          </p>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="o-refs">Supporting references (optional)</Label>
          <Input id="o-refs" name="references" defaultValue={c?.references} />
        </div>
        {scope === "FIRM_ATTORNEYS" && (
          <label className="flex items-start gap-2 text-sm sm:col-span-2">
            <input type="checkbox" name="confirmNoPrivileged" className="mt-1" />
            This note contains no privileged, client-identifying, or matter-specific information and may be shared with
            all firm attorneys.
          </label>
        )}
        {c && (
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="o-reason">Reason for correction</Label>
            <Input id="o-reason" name="correctionReason" required />
          </div>
        )}
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
          {isPending ? "Saving…" : c ? "Save corrected version" : "Save observation"}
        </Button>
      </div>
    </form>
  );
}
