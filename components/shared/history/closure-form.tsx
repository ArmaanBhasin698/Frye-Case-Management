"use client";

import * as React from "react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { amendClosureReport, backfillClosureReport, closeMatter, type FormActionState } from "@/lib/history/actions";
import {
  DISPOSITION_LABELS,
  DISPOSITION_VALUES,
  RESOLUTION_LABELS,
  RESOLUTION_VALUES,
  TRIAL_TYPE_LABELS,
  TRIAL_TYPE_VALUES,
  VERDICT_LABELS,
  VERDICT_VALUES,
} from "@/lib/history/labels";

const INITIAL: FormActionState = { error: null };
type Option = { id: string; label: string };

type ClosureTextKey =
  | "responsibleAttorneyId"
  | "closureDate"
  | "caseType"
  | "charges"
  | "disposition"
  | "dispositionDetail"
  | "outcomeDate"
  | "resolutionProcedure"
  | "outcomeSummary"
  | "judgeContactId"
  | "prosecutorContactId"
  | "opposingCounselContactId"
  | "exceptionReason"
  | "finalNotes"
  | "lessonsLearned"
  | "trialStartDate"
  | "trialEndDate"
  | "trialType"
  | "defenseAttorneys"
  | "chargesTried"
  | "evidentiaryIssues"
  | "significantMotions"
  | "sentencingOutcome"
  | "trialSummary"
  | "attorneyObservations"
  | "trialLessonsLearned";

export type ClosureInitial = { [K in ClosureTextKey]?: string } & {
  verdicts?: { charge: string; verdict: string }[];
  noSignificantRulings?: boolean;
};

const ACTIONS = { close: closeMatter, amend: amendClosureReport, backfill: backfillClosureReport } as const;
const TITLES = { close: "Close Matter", amend: "Amend closure report", backfill: "Complete historical closure report" } as const;

function Field({ label, htmlFor, children, wide }: { label: string; htmlFor: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`space-y-1.5 ${wide ? "sm:col-span-2" : ""}`}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

/**
 * Structured matter-closure workflow (close / amend / historical
 * backfill). Trial fields appear — and are only required — when the
 * resolution procedure is Trial. Submitted through onSubmit (not
 * `<form action>`) so a validation error never wipes a long report.
 * Everything is re-validated server-side in lib/history/actions.ts.
 */
export function ClosureForm({
  mode,
  matterId,
  rulingCount,
  attorneys,
  judges,
  professionals,
  initial = {},
}: {
  mode: keyof typeof ACTIONS;
  matterId: string;
  rulingCount: number;
  attorneys: Option[];
  judges: Option[];
  professionals: Option[];
  initial?: ClosureInitial;
}) {
  const [state, formAction, isPending] = useActionState(ACTIONS[mode], INITIAL);
  const [open, setOpen] = React.useState(false);
  const [procedure, setProcedure] = React.useState(initial.resolutionProcedure ?? "PLEA");
  const [disposition, setDisposition] = React.useState(initial.disposition ?? "PLEA_AGREEMENT");
  const [verdicts, setVerdicts] = React.useState(
    (initial.verdicts?.length ? initial.verdicts : [{ charge: "", verdict: "NOT_GUILTY" }]).map((v, i) => ({ ...v, key: `v-${i}` })),
  );
  const nextKey = React.useRef(0);
  const [, startTransition] = React.useTransition();
  const [prev, setPrev] = React.useState(state);
  if (state !== prev) {
    setPrev(state);
    if (!state.error) setOpen(false);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  if (!open) {
    return (
      <Button size="sm" variant={mode === "close" ? "default" : "outline"} onClick={() => setOpen(true)}>
        {TITLES[mode]}
      </Button>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  return (
    <form onSubmit={handleSubmit} className="w-full space-y-6 rounded-lg border border-border bg-card p-5">
      <input type="hidden" name="matterId" value={matterId} />
      <h3 className="text-base font-semibold">{TITLES[mode]}</h3>
      {mode === "backfill" && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
          Historical backfill: record only what the file actually shows. Leave unknown fields blank and document gaps
          in the exception reason — never reconstruct details from memory as if verified.
        </p>
      )}

      <section className="grid gap-3 sm:grid-cols-2">
        <Field label="Responsible attorney" htmlFor="c-resp">
          <Select id="c-resp" name="responsibleAttorneyId" defaultValue={initial.responsibleAttorneyId ?? ""}>
            <option value="">Not specified</option>
            {attorneys.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Closure date" htmlFor="c-date">
          <Input id="c-date" name="closureDate" type="date" required defaultValue={initial.closureDate ?? today} />
        </Field>
        <Field label="Case type (optional)" htmlFor="c-type">
          <Input id="c-type" name="caseType" defaultValue={initial.caseType} placeholder="e.g. Felony drug possession" />
        </Field>
        <Field label="Charges" htmlFor="c-charges">
          <Input id="c-charges" name="charges" required defaultValue={initial.charges} />
        </Field>
        <Field label="How was the matter resolved?" htmlFor="c-proc">
          <Select id="c-proc" name="resolutionProcedure" value={procedure} onChange={(e) => setProcedure(e.target.value)}>
            {RESOLUTION_VALUES.map((v) => (
              <option key={v} value={v}>
                {RESOLUTION_LABELS[v]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Final disposition" htmlFor="c-disp">
          <Select id="c-disp" name="disposition" value={disposition} onChange={(e) => setDisposition(e.target.value)}>
            {DISPOSITION_VALUES.map((v) => (
              <option key={v} value={v}>
                {DISPOSITION_LABELS[v]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Disposition detail (optional)" htmlFor="c-dispd">
          <Input id="c-dispd" name="dispositionDetail" defaultValue={initial.dispositionDetail} />
        </Field>
        <Field label="Outcome date (optional)" htmlFor="c-odate">
          <Input id="c-odate" name="outcomeDate" type="date" defaultValue={initial.outcomeDate} />
        </Field>
        <Field label="Outcome summary" htmlFor="c-sum" wide>
          <Textarea id="c-sum" name="outcomeSummary" rows={3} required defaultValue={initial.outcomeSummary} />
        </Field>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <Field label="Judge" htmlFor="c-judge">
          <Select id="c-judge" name="judgeContactId" defaultValue={initial.judgeContactId ?? ""}>
            <option value="">None / not recorded</option>
            {judges.map((j) => (
              <option key={j.id} value={j.id}>
                {j.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Prosecutor / solicitor" htmlFor="c-pros">
          <Select id="c-pros" name="prosecutorContactId" defaultValue={initial.prosecutorContactId ?? ""}>
            <option value="">None / not recorded</option>
            {professionals.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Opposing counsel (if applicable)" htmlFor="c-opp">
          <Select id="c-opp" name="opposingCounselContactId" defaultValue={initial.opposingCounselContactId ?? ""}>
            <option value="">None / not applicable</option>
            {professionals.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <p className="text-xs text-muted-foreground sm:col-span-3">
          Only contacts linked to this matter are listed — add them on the Contacts tab first.
        </p>
      </section>

      {procedure === "TRIAL" && (
        <section className="space-y-3 rounded-md border border-border p-4">
          <h4 className="text-sm font-semibold">Trial report</h4>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Trial start" htmlFor="t-start">
              <Input id="t-start" name="trialStartDate" type="date" required defaultValue={initial.trialStartDate} />
            </Field>
            <Field label="Trial end (optional)" htmlFor="t-end">
              <Input id="t-end" name="trialEndDate" type="date" defaultValue={initial.trialEndDate} />
            </Field>
            <Field label="Bench or jury" htmlFor="t-type">
              <Select id="t-type" name="trialType" defaultValue={initial.trialType ?? "JURY"}>
                {TRIAL_TYPE_VALUES.map((v) => (
                  <option key={v} value={v}>
                    {TRIAL_TYPE_LABELS[v]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Defense attorney(s)" htmlFor="t-def">
              <Input id="t-def" name="defenseAttorneys" defaultValue={initial.defenseAttorneys} />
            </Field>
            <Field label="Charges tried" htmlFor="t-charges" wide>
              <Input id="t-charges" name="chargesTried" required defaultValue={initial.chargesTried} />
            </Field>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Verdict by charge</p>
            {verdicts.map((row) => (
              <div key={row.key} className="flex gap-2">
                <Input name="verdictCharge" aria-label="Charge" defaultValue={row.charge} placeholder="Charge" />
                <Select name="verdictResult" aria-label="Verdict" defaultValue={row.verdict} className="w-64">
                  {VERDICT_VALUES.map((v) => (
                    <option key={v} value={v}>
                      {VERDICT_LABELS[v]}
                    </option>
                  ))}
                </Select>
                {verdicts.length > 1 && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setVerdicts(verdicts.filter((v) => v.key !== row.key))}>
                    Remove
                  </Button>
                )}
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setVerdicts([...verdicts, { charge: "", verdict: "NOT_GUILTY", key: `added-${nextKey.current++}` }])}
            >
              Add charge
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Key evidentiary issues" htmlFor="t-evid">
              <Textarea id="t-evid" name="evidentiaryIssues" rows={2} defaultValue={initial.evidentiaryIssues} />
            </Field>
            <Field label="Significant motions" htmlFor="t-mot">
              <Textarea id="t-mot" name="significantMotions" rows={2} defaultValue={initial.significantMotions} />
            </Field>
            <Field label="Sentencing outcome (if applicable)" htmlFor="t-sent">
              <Textarea id="t-sent" name="sentencingOutcome" rows={2} defaultValue={initial.sentencingOutcome} />
            </Field>
            <Field label="Attorney observations" htmlFor="t-obs">
              <Textarea id="t-obs" name="attorneyObservations" rows={2} defaultValue={initial.attorneyObservations} />
            </Field>
            <Field label="Trial summary" htmlFor="t-sum" wide>
              <Textarea id="t-sum" name="trialSummary" rows={3} required defaultValue={initial.trialSummary} />
            </Field>
            <Field label="Trial lessons learned" htmlFor="t-less" wide>
              <Textarea id="t-less" name="trialLessonsLearned" rows={2} defaultValue={initial.trialLessonsLearned} />
            </Field>
          </div>
        </section>
      )}

      <section className="space-y-3 rounded-md border border-border p-4">
        <h4 className="text-sm font-semibold">Significant rulings</h4>
        <p className="text-sm text-muted-foreground">
          {rulingCount > 0
            ? `${rulingCount} ruling${rulingCount === 1 ? " is" : "s are"} recorded on this matter and will be linked to this report and to the judge's history.`
            : "No rulings are recorded on this matter yet. Record them above, or confirm none were significant."}
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="noSignificantRulings" defaultChecked={initial.noSignificantRulings} />
          There were no significant rulings to record.
        </label>
        <Field label={`Documented exception${disposition === "ADMINISTRATIVE_CLOSURE" ? " (required for administrative closure)" : " (optional)"}`} htmlFor="c-exc" wide>
          <Textarea
            id="c-exc"
            name="exceptionReason"
            rows={2}
            defaultValue={initial.exceptionReason}
            placeholder="e.g. Historical file incomplete — rulings not available"
          />
        </Field>
      </section>

      <section className="space-y-3 rounded-md border border-border p-4">
        <h4 className="text-sm font-semibold">Judge, prosecutor & opposing counsel observations (optional)</h4>
        <p className="text-xs text-muted-foreground">
          Saved as matter-restricted attorney observations on each professional&apos;s profile. To share a general
          reference note firm-wide, add it from their contact profile instead.
        </p>
        {[
          { prefix: "judgeObs_", label: "Judge & court observations" },
          { prefix: "prosecutorObs_", label: "Prosecutor / solicitor notes (negotiations, procedure)" },
          { prefix: "opposingObs_", label: "Opposing counsel notes" },
        ].map((slot) => (
          <div key={slot.prefix} className="grid gap-2 sm:grid-cols-4">
            <Field label={slot.label} htmlFor={`${slot.prefix}body`} wide>
              <Textarea id={`${slot.prefix}body`} name={`${slot.prefix}body`} rows={2} />
            </Field>
            <Field label="Type" htmlFor={`${slot.prefix}kind`}>
              <Select id={`${slot.prefix}kind`} name={`${slot.prefix}kind`} defaultValue="PROCEDURAL_OBSERVATION">
                <option value="PROCEDURAL_OBSERVATION">Attorney observation</option>
                <option value="SUBJECTIVE_IMPRESSION">Subjective impression</option>
                <option value="LESSON_LEARNED">Lesson learned</option>
              </Select>
            </Field>
            <input type="hidden" name={`${slot.prefix}shareScope`} value="MATTER_ONLY" />
          </div>
        ))}
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <Field label="Final attorney notes" htmlFor="c-notes">
          <Textarea id="c-notes" name="finalNotes" rows={3} defaultValue={initial.finalNotes} />
        </Field>
        <Field label="Lessons learned" htmlFor="c-lessons">
          <Textarea id="c-lessons" name="lessonsLearned" rows={3} defaultValue={initial.lessonsLearned} />
        </Field>
        {mode === "amend" && (
          <Field label="Reason for amendment" htmlFor="c-amend" wide>
            <Input id="c-amend" name="amendmentReason" required />
          </Field>
        )}
        <label className="flex items-start gap-2 text-sm sm:col-span-2">
          <input type="checkbox" name="reviewedObservations" className="mt-1" />I have reviewed the rulings and
          professional-history observations for this matter.
        </label>
      </section>

      {state.error && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {state.error}
        </p>
      )}
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Saving…" : mode === "close" ? "Validate & close matter" : "Save report version"}
        </Button>
      </div>
    </form>
  );
}
