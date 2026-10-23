import Link from "next/link";
import { format } from "date-fns";

import { requireCurrentUser } from "@/lib/auth/session";
import { assertMatterAccess, canEditMatter } from "@/lib/auth/access";
import { getMatterOutcome } from "@/lib/history/queries";
import { canAuthorProfessionalHistory } from "@/lib/history/visibility";
import {
  DISPOSITION_LABELS,
  OBSERVATION_CATEGORY_LABELS,
  OBSERVATION_KIND_LABELS,
  PROCEEDING_TYPE_LABELS,
  RESOLUTION_LABELS,
  RULING_ISSUE_LABELS,
  RULING_RESULT_LABELS,
  SHARE_SCOPE_LABELS,
  TRIAL_TYPE_LABELS,
  VERDICT_LABELS,
  type Verdict,
} from "@/lib/history/labels";
import { asCalendarDate } from "@/lib/matters/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RulingForm } from "@/components/shared/history/ruling-form";
import { ObservationForm } from "@/components/shared/history/observation-form";
import { ClosureForm, type ClosureInitial } from "@/components/shared/history/closure-form";
import { ReopenMatterForm } from "@/components/shared/history/reopen-form";

const d = (date: Date | null | undefined) => (date ? format(asCalendarDate(date), "MMM d, yyyy") : "—");
const iso = (date: Date | null | undefined) => (date ? date.toISOString().slice(0, 10) : undefined);

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value) return null;
  return (
    <div className="grid gap-1 sm:grid-cols-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="whitespace-pre-wrap sm:col-span-3">{value}</dd>
    </div>
  );
}

/**
 * Matter Outcome tab: significant rulings, matter-restricted professional
 * observations, the structured closure workflow, versioned closure
 * reports, and historical backfill. Re-asserts matter access itself.
 */
export default async function MatterOutcomePage({ params }: { params: Promise<{ matterId: string }> }) {
  const { matterId } = await params;
  const user = await requireCurrentUser();
  await assertMatterAccess(user, matterId);

  const outcome = await getMatterOutcome(user, matterId);
  const { matter, currentRulings, supersededRulings, observations, currentReport, priorReports } = outcome;
  if (!matter) return null;
  const mayEdit = await canEditMatter(user, matterId);
  const mayObserve = canAuthorProfessionalHistory(user);

  const judges = outcome.judges.map((j) => ({ id: j.id, label: j.displayName }));
  const professionals = outcome.professionals.map((p) => ({ id: p.id, label: p.displayName }));
  const documents = outcome.documents.map((doc) => ({ id: doc.id, label: doc.title }));
  const attorneys = outcome.attorneys.map((a) => ({ id: a.id, label: a.name }));
  const leadId = matter.assignments.find((a) => a.role === "LEAD_ATTORNEY")?.userId;

  const reportInitial = (r: NonNullable<typeof currentReport>): ClosureInitial => ({
    responsibleAttorneyId: r.responsibleAttorneyId ?? undefined,
    closureDate: iso(r.closureDate),
    caseType: r.caseType ?? undefined,
    charges: r.charges,
    disposition: r.disposition,
    dispositionDetail: r.dispositionDetail ?? undefined,
    outcomeDate: iso(r.outcomeDate),
    resolutionProcedure: r.resolutionProcedure,
    outcomeSummary: r.outcomeSummary,
    judgeContactId: r.judgeContactId ?? undefined,
    prosecutorContactId: r.prosecutorContactId ?? undefined,
    opposingCounselContactId: r.opposingCounselContactId ?? undefined,
    exceptionReason: r.exceptionReason ?? undefined,
    finalNotes: r.finalNotes ?? undefined,
    lessonsLearned: r.lessonsLearned ?? undefined,
    noSignificantRulings: r.noSignificantRulings,
    ...(r.trialOutcome
      ? {
          trialStartDate: iso(r.trialOutcome.trialStartDate),
          trialEndDate: iso(r.trialOutcome.trialEndDate),
          trialType: r.trialOutcome.trialType,
          defenseAttorneys: r.trialOutcome.defenseAttorneys ?? undefined,
          chargesTried: r.trialOutcome.chargesTried,
          verdicts: r.trialOutcome.verdicts as { charge: string; verdict: string }[],
          evidentiaryIssues: r.trialOutcome.evidentiaryIssues ?? undefined,
          significantMotions: r.trialOutcome.significantMotions ?? undefined,
          sentencingOutcome: r.trialOutcome.sentencingOutcome ?? undefined,
          trialSummary: r.trialOutcome.trialSummary,
          attorneyObservations: r.trialOutcome.attorneyObservations ?? undefined,
          trialLessonsLearned: r.trialOutcome.lessonsLearned ?? undefined,
        }
      : {}),
  });

  return (
    <div className="space-y-6">
      {matter.closureReviewStatus === "NEEDS_BACKFILL" && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          This matter was closed before structured closure reports existed. Its outcome has <strong>not been reviewed</strong>{" "}
          — an attorney on the matter can complete a historical report below. Nothing has been filled in automatically.
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle>Significant rulings</CardTitle>
            <p className="text-xs text-muted-foreground">Verified court rulings recorded by the firm. Each appears on the judge&apos;s profile.</p>
          </div>
          {mayEdit && <RulingForm matterId={matterId} defaultCourt={matter.court} judges={judges} documents={documents} />}
        </CardHeader>
        <CardContent>
          {currentRulings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No rulings recorded.</p>
          ) : (
            <ul className="divide-y divide-border">
              {currentRulings.map((r) => (
                <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge>Verified ruling</Badge>
                      <span className="font-medium">{RULING_ISSUE_LABELS[r.issueType]}</span>
                      <span>— {RULING_RESULT_LABELS[r.result]}</span>
                      {r.version > 1 && <Badge variant="outline">Corrected (v{r.version})</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {d(r.rulingDate)} · {PROCEEDING_TYPE_LABELS[r.proceedingType]} · {r.court} · Judge{" "}
                      <Link href={`/contacts/${r.judge.id}`} className="hover:underline">
                        {r.judge.displayName}
                      </Link>
                      {r.recordedBy ? ` · recorded by ${r.recordedBy.name} ${format(r.createdAt, "MMM d, yyyy")}` : ""}
                    </p>
                    {r.issueDetail && <p>{r.issueDetail}</p>}
                    {r.context && <p className="whitespace-pre-wrap text-muted-foreground">{r.context}</p>}
                    {r.correctionReason && <p className="text-xs text-muted-foreground">Correction: {r.correctionReason}</p>}
                    {r.document && (
                      <Link href={`/matters/${matterId}/documents/files/${r.document.id}`} className="text-xs text-primary hover:underline">
                        Supporting document: {r.document.title}
                      </Link>
                    )}
                  </div>
                  {mayEdit && (
                    <RulingForm
                      matterId={matterId}
                      defaultCourt={matter.court}
                      judges={judges}
                      documents={documents}
                      correcting={{
                        id: r.id,
                        judgeContactId: r.judgeContactId,
                        rulingDate: iso(r.rulingDate) ?? "",
                        court: r.court,
                        proceedingType: r.proceedingType,
                        issueType: r.issueType,
                        issueDetail: r.issueDetail ?? "",
                        result: r.result,
                        context: r.context ?? "",
                        documentId: r.documentId ?? "",
                      }}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
          {supersededRulings.length > 0 && (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-muted-foreground">Correction history ({supersededRulings.length} earlier versions)</summary>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {supersededRulings.map((r) => (
                  <li key={r.id}>
                    v{r.version}: {RULING_ISSUE_LABELS[r.issueType]} — {RULING_RESULT_LABELS[r.result]} ({d(r.rulingDate)}), superseded{" "}
                    {r.supersededAt ? format(r.supersededAt, "MMM d, yyyy") : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle>Professional observations</CardTitle>
            <p className="text-xs text-muted-foreground">Attorney notes and impressions — opinion, not verified fact. Restricted to this matter.</p>
          </div>
          {mayObserve && professionals.length > 0 && <ObservationForm subjects={professionals} fixedMatterId={matterId} />}
        </CardHeader>
        <CardContent>
          {observations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No observations recorded.</p>
          ) : (
            <ul className="space-y-3">
              {observations.filter((o) => !o.supersededAt).map((o) => (
                <li key={o.id} className="rounded-md border border-border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={o.kind === "SUBJECTIVE_IMPRESSION" ? "warning" : "secondary"}>{OBSERVATION_KIND_LABELS[o.kind]}</Badge>
                    <Badge variant="outline">{OBSERVATION_CATEGORY_LABELS[o.category]}</Badge>
                    <span className="text-muted-foreground">
                      about{" "}
                      <Link href={`/contacts/${o.subject.id}`} className="hover:underline">
                        {o.subject.displayName}
                      </Link>{" "}
                      · {o.author?.name ?? "former staff"} · {format(o.createdAt, "MMM d, yyyy")}
                      {o.version > 1 ? ` · corrected (v${o.version})` : ""}
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap">{o.body}</p>
                  {o.references && <p className="text-xs text-muted-foreground">References: {o.references}</p>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle>Closure report</CardTitle>
            <p className="text-xs text-muted-foreground">Closing a matter requires a validated structured report. Amendments create new versions.</p>
          </div>
          {mayEdit && (
            <div className="flex flex-wrap gap-2">
              {matter.status !== "CLOSED" && (
                <ClosureForm
                  mode="close"
                  matterId={matterId}
                  rulingCount={currentRulings.length}
                  attorneys={attorneys}
                  judges={judges}
                  professionals={professionals}
                  initial={{ charges: matter.charges, responsibleAttorneyId: leadId }}
                />
              )}
              {matter.status === "CLOSED" && !currentReport && (
                <ClosureForm
                  mode="backfill"
                  matterId={matterId}
                  rulingCount={currentRulings.length}
                  attorneys={attorneys}
                  judges={judges}
                  professionals={professionals}
                  initial={{ charges: matter.charges, closureDate: iso(matter.closedDate), responsibleAttorneyId: leadId }}
                />
              )}
              {matter.status === "CLOSED" && currentReport && (
                <ClosureForm
                  mode="amend"
                  matterId={matterId}
                  rulingCount={currentRulings.length}
                  attorneys={attorneys}
                  judges={judges}
                  professionals={professionals}
                  initial={reportInitial(currentReport)}
                />
              )}
              {matter.status === "CLOSED" && <ReopenMatterForm matterId={matterId} />}
            </div>
          )}
        </CardHeader>
        <CardContent>
          {!currentReport ? (
            <p className="text-sm text-muted-foreground">
              {matter.status === "CLOSED" ? "No closure report on file." : "This matter is not closed."}
            </p>
          ) : (
            <dl className="space-y-2 text-sm">
              <div className="flex flex-wrap gap-2 pb-2">
                <Badge>Version {currentReport.version}</Badge>
                {currentReport.isHistoricalBackfill && <Badge variant="warning">Historical backfill</Badge>}
                <Badge variant="secondary">{DISPOSITION_LABELS[currentReport.disposition]}</Badge>
                <Badge variant="outline">{RESOLUTION_LABELS[currentReport.resolutionProcedure]}</Badge>
              </div>
              <Row label="Closed" value={`${d(currentReport.closureDate)} by ${currentReport.closingAttorney?.name ?? "—"}`} />
              <Row label="Responsible attorney" value={currentReport.responsibleAttorney?.name} />
              <Row label="Case type" value={currentReport.caseType} />
              <Row label="Charges" value={currentReport.charges} />
              <Row label="Disposition detail" value={currentReport.dispositionDetail} />
              <Row label="Outcome date" value={currentReport.outcomeDate ? d(currentReport.outcomeDate) : null} />
              <Row label="Outcome summary" value={currentReport.outcomeSummary} />
              <Row
                label="Judge"
                value={currentReport.judge && <Link href={`/contacts/${currentReport.judge.id}`} className="hover:underline">{currentReport.judge.displayName}</Link>}
              />
              <Row
                label="Prosecutor / solicitor"
                value={currentReport.prosecutor && <Link href={`/contacts/${currentReport.prosecutor.id}`} className="hover:underline">{currentReport.prosecutor.displayName}</Link>}
              />
              <Row
                label="Opposing counsel"
                value={currentReport.opposingCounsel && <Link href={`/contacts/${currentReport.opposingCounsel.id}`} className="hover:underline">{currentReport.opposingCounsel.displayName}</Link>}
              />
              <Row label="Rulings" value={currentReport.noSignificantRulings ? "Attorney confirmed no significant rulings" : `${currentRulings.length} recorded`} />
              <Row label="Documented exception" value={currentReport.exceptionReason} />
              <Row label="Final notes" value={currentReport.finalNotes} />
              <Row label="Lessons learned" value={currentReport.lessonsLearned} />
              <Row label="Amendment reason" value={currentReport.amendmentReason} />
              {currentReport.trialOutcome && (
                <div className="mt-3 space-y-2 rounded-md border border-border p-3">
                  <p className="font-semibold">Trial report — {TRIAL_TYPE_LABELS[currentReport.trialOutcome.trialType]}</p>
                  <Row
                    label="Trial dates"
                    value={`${d(currentReport.trialOutcome.trialStartDate)} – ${d(currentReport.trialOutcome.trialEndDate)}`}
                  />
                  <Row label="Defense attorney(s)" value={currentReport.trialOutcome.defenseAttorneys} />
                  <Row label="Charges tried" value={currentReport.trialOutcome.chargesTried} />
                  <Row
                    label="Verdicts"
                    value={(currentReport.trialOutcome.verdicts as { charge: string; verdict: Verdict }[])
                      .map((v) => `${v.charge}: ${VERDICT_LABELS[v.verdict] ?? v.verdict}`)
                      .join("\n")}
                  />
                  <Row label="Evidentiary issues" value={currentReport.trialOutcome.evidentiaryIssues} />
                  <Row label="Significant motions" value={currentReport.trialOutcome.significantMotions} />
                  <Row label="Sentencing" value={currentReport.trialOutcome.sentencingOutcome} />
                  <Row label="Summary" value={currentReport.trialOutcome.trialSummary} />
                  <Row label="Attorney observations" value={currentReport.trialOutcome.attorneyObservations} />
                  <Row label="Lessons learned" value={currentReport.trialOutcome.lessonsLearned} />
                </div>
              )}
            </dl>
          )}
          {priorReports.length > 0 && (
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer text-muted-foreground">Earlier versions ({priorReports.length})</summary>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {priorReports.map((r) => (
                  <li key={r.id}>
                    v{r.version}: {DISPOSITION_LABELS[r.disposition]} via {RESOLUTION_LABELS[r.resolutionProcedure]}, closed {d(r.closureDate)} by{" "}
                    {r.closingAttorney?.name ?? "—"}; superseded {r.supersededAt ? format(r.supersededAt, "MMM d, yyyy") : ""}
                    {r.amendmentReason ? ` — ${r.amendmentReason}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p className="mt-4 text-xs text-muted-foreground">{SHARE_SCOPE_LABELS.MATTER_ONLY}: closure reports are visible only to people with access to this matter.</p>
        </CardContent>
      </Card>
    </div>
  );
}
