import Link from "next/link";
import { format } from "date-fns";
import type { ContactCategory, ProceedingType, RulingIssueType, RulingResult } from "@prisma/client";

import type { AuthorizableUser } from "@/lib/auth/authorization";
import { getProfessionalHistory, type RulingHistoryFilters } from "@/lib/history/queries";
import { canAuthorProfessionalHistory } from "@/lib/history/visibility";
import {
  DISPOSITION_LABELS,
  OBSERVATION_CATEGORY_LABELS,
  OBSERVATION_KIND_LABELS,
  PROCEEDING_TYPE_LABELS,
  PROCEEDING_TYPE_VALUES,
  RESOLUTION_LABELS,
  RULING_ISSUE_LABELS,
  RULING_ISSUE_VALUES,
  RULING_RESULT_LABELS,
  RULING_RESULT_VALUES,
} from "@/lib/history/labels";
import { asCalendarDate, matterStatusLabel } from "@/lib/matters/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ObservationForm } from "@/components/shared/history/observation-form";

export const PROFESSIONAL_HISTORY_CATEGORIES: ReadonlySet<ContactCategory> = new Set([
  "JUDGE",
  "PROSECUTOR",
  "ASSISTANT_DISTRICT_ATTORNEY",
  "SOLICITOR",
  "OPPOSING_COUNSEL",
  "DEFENSE_ATTORNEY",
]);

const d = (date: Date) => format(asCalendarDate(date), "MMM d, yyyy");

function pick<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return allowed.includes(value as T) ? (value as T) : undefined;
}

export function readHistoryFilters(params: Record<string, string | string[] | undefined>): RulingHistoryFilters {
  const one = (k: string) => {
    const v = params[k];
    return (Array.isArray(v) ? v[0] : v) || undefined;
  };
  return {
    from: one("hFrom"),
    to: one("hTo"),
    court: one("hCourt"),
    proceedingType: pick<ProceedingType>(one("hProceeding"), PROCEEDING_TYPE_VALUES),
    issueType: pick<RulingIssueType>(one("hIssue"), RULING_ISSUE_VALUES),
    result: pick<RulingResult>(one("hResult"), RULING_RESULT_VALUES),
    matterId: one("hMatter"),
  };
}

/**
 * Judge / prosecutor / solicitor / opposing-counsel history on a contact
 * profile. Rendered only after the contact itself passed visibility; every
 * row here comes from lib/history/queries.ts, already limited to matters
 * the viewer can access, so counts and summaries never include hidden
 * matters.
 */
export async function ProfessionalHistorySection({
  user,
  contactId,
  isJudge,
  filters,
  matterOptions,
}: {
  user: AuthorizableUser;
  contactId: string;
  isJudge: boolean;
  filters: RulingHistoryFilters;
  matterOptions: { id: string; label: string }[];
}) {
  const history = await getProfessionalHistory(user, contactId, filters);
  const { rulings, summary, caseOutcomes, observations } = history;
  const filtered = Object.values(filters).some(Boolean);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Professional history</CardTitle>
          <p className="text-xs text-muted-foreground">
            Frye&apos;s own recorded history with this professional, limited to matters you can access. It is not a
            comprehensive record and makes no prediction.
            {history.lastProfessionalActivity && ` Last recorded professional activity: ${d(history.lastProfessionalActivity)}.`}
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Case outcomes</h3>
            {caseOutcomes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No closed-matter outcomes recorded with this professional.</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {caseOutcomes.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div>
                      <Link href={`/matters/${c.matter.id}/outcome`} className="font-medium hover:underline">
                        State v. {c.matter.client.lastName} ({c.matter.caseNumber})
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {c.roleInMatter} · {c.matter.court} · closed {d(c.closureDate)} ·{" "}
                        {RESOLUTION_LABELS[c.resolutionProcedure]}
                        {c.trialOutcome ? ` (${c.trialOutcome.trialType === "JURY" ? "jury" : "bench"} trial)` : ""}
                      </p>
                    </div>
                    <Badge variant="secondary">{DISPOSITION_LABELS[c.disposition]}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {isJudge && (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Ruling history</h3>
              <form method="get" className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-muted/30 p-2">
                <div className="space-y-1">
                  <Label htmlFor="h-from" className="text-xs">From</Label>
                  <Input id="h-from" name="hFrom" type="date" defaultValue={filters.from} className="w-36" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="h-to" className="text-xs">To</Label>
                  <Input id="h-to" name="hTo" type="date" defaultValue={filters.to} className="w-36" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="h-court" className="text-xs">Court</Label>
                  <Input id="h-court" name="hCourt" defaultValue={filters.court} className="w-40" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="h-proc" className="text-xs">Proceeding</Label>
                  <Select id="h-proc" name="hProceeding" defaultValue={filters.proceedingType ?? ""} className="w-40">
                    <option value="">Any</option>
                    {PROCEEDING_TYPE_VALUES.map((v) => (
                      <option key={v} value={v}>{PROCEEDING_TYPE_LABELS[v]}</option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="h-issue" className="text-xs">Motion / issue</Label>
                  <Select id="h-issue" name="hIssue" defaultValue={filters.issueType ?? ""} className="w-44">
                    <option value="">Any</option>
                    {RULING_ISSUE_VALUES.map((v) => (
                      <option key={v} value={v}>{RULING_ISSUE_LABELS[v]}</option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="h-result" className="text-xs">Result</Label>
                  <Select id="h-result" name="hResult" defaultValue={filters.result ?? ""} className="w-36">
                    <option value="">Any</option>
                    {RULING_RESULT_VALUES.map((v) => (
                      <option key={v} value={v}>{RULING_RESULT_LABELS[v]}</option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="h-matter" className="text-xs">Matter</Label>
                  <Select id="h-matter" name="hMatter" defaultValue={filters.matterId ?? ""} className="w-44">
                    <option value="">Any of yours</option>
                    {matterOptions.map((m) => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </Select>
                </div>
                <Button type="submit" size="sm">Filter</Button>
                {filtered && (
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={`/contacts/${contactId}`}>Clear</Link>
                  </Button>
                )}
              </form>

              <div className="rounded-md border border-border p-3 text-sm">
                <p className="font-medium">Frye recorded history (counts, not percentages)</p>
                <p className="text-xs text-muted-foreground">
                  Sample: {summary.sampleSize} recorded ruling{summary.sampleSize === 1 ? "" : "s"}
                  {summary.from && summary.to ? `, ${d(summary.from)} – ${d(summary.to)}` : ""}
                  {filtered ? " (filtered)" : ""}. Only rulings the firm chose to record, on matters you can access.
                </p>
                {summary.byIssue.length > 0 && (
                  <ul className="mt-2 space-y-0.5">
                    {summary.byIssue.map((row) => (
                      <li key={row.issueType}>
                        {RULING_ISSUE_LABELS[row.issueType]} ({row.total}):{" "}
                        {Object.entries(row.byResult)
                          .map(([result, n]) => `${RULING_RESULT_LABELS[result as RulingResult]} ${n}`)
                          .join(", ")}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {rulings.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recorded rulings{filtered ? " match these filters" : ""}.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Matter</TableHead>
                      <TableHead>Proceeding</TableHead>
                      <TableHead>Motion / issue</TableHead>
                      <TableHead>Result</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rulings.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-nowrap text-sm">{d(r.rulingDate)}</TableCell>
                        <TableCell className="text-sm">
                          <Link href={`/matters/${r.matter.id}/outcome`} className="hover:underline">
                            State v. {r.matter.client.lastName}
                          </Link>
                          <p className="text-xs text-muted-foreground">
                            {r.matter.caseNumber} · {matterStatusLabel(r.matter.status)} · {r.court}
                          </p>
                        </TableCell>
                        <TableCell className="text-sm">{PROCEEDING_TYPE_LABELS[r.proceedingType]}</TableCell>
                        <TableCell className="text-sm">
                          {RULING_ISSUE_LABELS[r.issueType]}
                          {r.issueDetail && <p className="text-xs text-muted-foreground">{r.issueDetail}</p>}
                          {r.version > 1 && <p className="text-xs text-muted-foreground">Corrected (v{r.version})</p>}
                        </TableCell>
                        <TableCell>
                          <Badge>{RULING_RESULT_LABELS[r.result]}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {history.priorVersionCount > 0 && (
                <p className="text-xs text-muted-foreground">
                  {history.priorVersionCount} earlier ruling version{history.priorVersionCount === 1 ? " was" : "s were"} corrected; see each
                  matter&apos;s Outcome tab for the correction history.
                </p>
              )}
            </section>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle>Attorney observations</CardTitle>
            <p className="text-xs text-muted-foreground">
              Opinion and practical experience — not verified rulings. Matter-restricted notes appear only to people on that
              matter; firm-wide reference notes are shared with attorneys.
            </p>
          </div>
          {canAuthorProfessionalHistory(user) && <ObservationForm fixedSubjectId={contactId} matters={matterOptions} />}
        </CardHeader>
        <CardContent>
          {observations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No observations you can see.</p>
          ) : (
            <ul className="space-y-3">
              {observations.map((o) => (
                <li key={o.id} className="rounded-md border border-border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={o.kind === "SUBJECTIVE_IMPRESSION" ? "warning" : "secondary"}>{OBSERVATION_KIND_LABELS[o.kind]}</Badge>
                      <Badge variant="outline">{OBSERVATION_CATEGORY_LABELS[o.category]}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {o.author?.name ?? "former staff"} · {format(o.createdAt, "MMM d, yyyy")} ·{" "}
                        {o.matter ? (
                          <Link href={`/matters/${o.matter.id}/outcome`} className="hover:underline">
                            {o.matter.caseNumber}
                          </Link>
                        ) : (
                          "Firm-wide reference note"
                        )}
                        {o.version > 1 ? ` · corrected (v${o.version})` : ""}
                      </span>
                    </div>
                    {(o.author?.id === user.id || user.role === "ADMIN") && (
                      <ObservationForm
                        fixedSubjectId={contactId}
                        correcting={{
                          id: o.id,
                          category: o.category,
                          kind: o.kind,
                          body: o.body,
                          references: o.references ?? "",
                          shareScope: o.shareScope,
                          matterId: o.matterId ?? "",
                        }}
                      />
                    )}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap">{o.body}</p>
                  {o.references && <p className="text-xs text-muted-foreground">References: {o.references}</p>}
                  {o.correctionReason && <p className="text-xs text-muted-foreground">Correction: {o.correctionReason}</p>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
