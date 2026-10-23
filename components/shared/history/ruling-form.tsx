"use client";

import * as React from "react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { correctRuling, recordRuling, type FormActionState } from "@/lib/history/actions";
import {
  PROCEEDING_TYPE_LABELS,
  PROCEEDING_TYPE_VALUES,
  RULING_ISSUE_LABELS,
  RULING_ISSUE_VALUES,
  RULING_RESULT_LABELS,
  RULING_RESULT_VALUES,
} from "@/lib/history/labels";

const INITIAL: FormActionState = { error: null };
type Option = { id: string; label: string };

export type RulingInitial = {
  id: string;
  judgeContactId: string;
  rulingDate: string;
  court: string;
  proceedingType: string;
  issueType: string;
  issueDetail: string;
  result: string;
  context: string;
  documentId: string;
};

/**
 * Record a ruling on a matter, or (with `correcting`) supersede an existing
 * one with a new version. Judge and document options are already scoped to
 * this matter; the action re-validates both.
 */
export function RulingForm({
  matterId,
  defaultCourt,
  judges,
  documents,
  correcting,
}: {
  matterId: string;
  defaultCourt: string;
  judges: Option[];
  documents: Option[];
  correcting?: RulingInitial;
}) {
  const [state, formAction, isPending] = useActionState(correcting ? correctRuling : recordRuling, INITIAL);
  const [open, setOpen] = React.useState(false);
  const [prev, setPrev] = React.useState(state);
  if (state !== prev) {
    setPrev(state);
    if (!state.error) setOpen(false);
  }

  if (!open) {
    return (
      <Button variant={correcting ? "ghost" : "outline"} size="sm" onClick={() => setOpen(true)} disabled={judges.length === 0}>
        {correcting ? "Correct" : judges.length === 0 ? "Link a judge to record rulings" : "Record ruling"}
      </Button>
    );
  }

  const c = correcting;
  return (
    <form action={formAction} className="w-full space-y-3 rounded-lg border border-border bg-card p-4">
      <input type="hidden" name="matterId" value={matterId} />
      {c && <input type="hidden" name="rulingId" value={c.id} />}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="r-judge">Judge</Label>
          <Select id="r-judge" name="judgeContactId" required defaultValue={c?.judgeContactId ?? judges[0]?.id ?? ""}>
            {judges.map((j) => (
              <option key={j.id} value={j.id}>
                {j.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="r-date">Ruling date</Label>
          <Input id="r-date" name="rulingDate" type="date" required defaultValue={c?.rulingDate} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="r-court">Court</Label>
          <Input id="r-court" name="court" required defaultValue={c?.court ?? defaultCourt} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="r-proc">Proceeding</Label>
          <Select id="r-proc" name="proceedingType" defaultValue={c?.proceedingType ?? "MOTION_HEARING"}>
            {PROCEEDING_TYPE_VALUES.map((v) => (
              <option key={v} value={v}>
                {PROCEEDING_TYPE_LABELS[v]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="r-issue">Motion / legal issue</Label>
          <Select id="r-issue" name="issueType" defaultValue={c?.issueType ?? "MOTION_TO_SUPPRESS"}>
            {RULING_ISSUE_VALUES.map((v) => (
              <option key={v} value={v}>
                {RULING_ISSUE_LABELS[v]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="r-result">Result</Label>
          <Select id="r-result" name="result" defaultValue={c?.result ?? "GRANTED"}>
            {RULING_RESULT_VALUES.map((v) => (
              <option key={v} value={v}>
                {RULING_RESULT_LABELS[v]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="r-detail">Issue detail (optional)</Label>
          <Input id="r-detail" name="issueDetail" defaultValue={c?.issueDetail} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="r-doc">Supporting document (optional)</Label>
          <Select id="r-doc" name="documentId" defaultValue={c?.documentId ?? ""}>
            <option value="">None</option>
            {documents.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-3">
          <Label htmlFor="r-context">Procedural context (optional)</Label>
          <Textarea id="r-context" name="context" rows={2} defaultValue={c?.context} />
        </div>
        {c && (
          <div className="space-y-1.5 sm:col-span-3">
            <Label htmlFor="r-reason">Reason for correction</Label>
            <Input id="r-reason" name="correctionReason" required />
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
          {isPending ? "Saving…" : c ? "Save corrected version" : "Record ruling"}
        </Button>
      </div>
    </form>
  );
}
