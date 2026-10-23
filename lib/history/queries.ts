import type { Prisma, ProceedingType, RulingIssueType, RulingResult } from "@prisma/client";

import { prisma } from "@/lib/db";
import { getAssignedMatterIds } from "@/lib/auth/access";
import { isAdmin, type AuthorizableUser } from "@/lib/auth/authorization";
import { buildClosureReportFilter, buildObservationFilter, buildRulingFilter } from "@/lib/history/visibility";

/**
 * Professional-history reads. Every query composes the pure filters in
 * lib/history/visibility.ts with the viewer's assigned matters, so a judge
 * or prosecutor profile only ever aggregates rows from matters the viewer
 * can already open. Callers must have authorized the contact itself first.
 */

async function assignedFor(user: AuthorizableUser) {
  return isAdmin(user) ? [] : getAssignedMatterIds(user.id);
}

const matterRefSelect = {
  id: true,
  caseNumber: true,
  status: true,
  client: { select: { lastName: true } },
} satisfies Prisma.MatterSelect;

export type RulingHistoryFilters = {
  from?: string;
  to?: string;
  court?: string;
  proceedingType?: ProceedingType;
  issueType?: RulingIssueType;
  result?: RulingResult;
  matterId?: string;
};

export type RulingSummary = {
  sampleSize: number;
  from: Date | null;
  to: Date | null;
  byIssue: { issueType: RulingIssueType; total: number; byResult: Partial<Record<RulingResult, number>> }[];
};

/**
 * Counts only — never percentages — over the rulings actually recorded and
 * visible to this viewer, with the sample size and date range alongside.
 * This is Frye's recorded history, not judicial statistics, and makes no
 * prediction.
 */
export function summarizeRulings(rulings: { issueType: RulingIssueType; result: RulingResult; rulingDate: Date }[]): RulingSummary {
  const byIssue = new Map<RulingIssueType, { total: number; byResult: Partial<Record<RulingResult, number>> }>();
  let from: Date | null = null;
  let to: Date | null = null;
  for (const r of rulings) {
    const entry = byIssue.get(r.issueType) ?? { total: 0, byResult: {} };
    entry.total += 1;
    entry.byResult[r.result] = (entry.byResult[r.result] ?? 0) + 1;
    byIssue.set(r.issueType, entry);
    if (!from || r.rulingDate < from) from = r.rulingDate;
    if (!to || r.rulingDate > to) to = r.rulingDate;
  }
  return {
    sampleSize: rulings.length,
    from,
    to,
    byIssue: [...byIssue.entries()]
      .map(([issueType, v]) => ({ issueType, ...v }))
      .sort((a, b) => b.total - a.total),
  };
}

export function buildRulingHistoryWhere(
  contactId: string,
  scope: Prisma.JudicialRulingWhereInput,
  filters: RulingHistoryFilters,
): Prisma.JudicialRulingWhereInput {
  const conditions: Prisma.JudicialRulingWhereInput[] = [{ judgeContactId: contactId, supersededAt: null }, scope];
  if (filters.from && !Number.isNaN(Date.parse(filters.from))) conditions.push({ rulingDate: { gte: new Date(filters.from) } });
  if (filters.to && !Number.isNaN(Date.parse(filters.to))) conditions.push({ rulingDate: { lte: new Date(filters.to) } });
  if (filters.court) conditions.push({ court: { contains: filters.court, mode: "insensitive" } });
  if (filters.proceedingType) conditions.push({ proceedingType: filters.proceedingType });
  if (filters.issueType) conditions.push({ issueType: filters.issueType });
  if (filters.result) conditions.push({ result: filters.result });
  if (filters.matterId) conditions.push({ matterId: filters.matterId });
  return { AND: conditions };
}

export async function getProfessionalHistory(user: AuthorizableUser, contactId: string, filters: RulingHistoryFilters = {}) {
  const assigned = await assignedFor(user);
  const rulingScope = buildRulingFilter(user, assigned);
  const closureScope = buildClosureReportFilter(user, assigned);

  const [rulings, priorVersions, closures, observations, priorObservationVersions] = await Promise.all([
    prisma.judicialRuling.findMany({
      where: buildRulingHistoryWhere(contactId, rulingScope, filters),
      include: { matter: { select: matterRefSelect }, recordedBy: { select: { name: true } }, document: { select: { id: true, title: true } } },
      orderBy: { rulingDate: "desc" },
    }),
    prisma.judicialRuling.findMany({
      where: { AND: [{ judgeContactId: contactId, supersededAt: { not: null } }, rulingScope] },
      select: { id: true, version: true, result: true, issueType: true, rulingDate: true, supersededAt: true, correctionReason: true },
      orderBy: { version: "desc" },
    }),
    prisma.matterClosureReport.findMany({
      where: {
        AND: [
          { supersededAt: null },
          { OR: [{ judgeContactId: contactId }, { prosecutorContactId: contactId }, { opposingCounselContactId: contactId }] },
          closureScope,
        ],
      },
      include: { matter: { select: { ...matterRefSelect, court: true } }, trialOutcome: { select: { trialType: true } } },
      orderBy: { closureDate: "desc" },
    }),
    prisma.professionalObservation.findMany({
      where: { AND: [{ subjectContactId: contactId, supersededAt: null }, buildObservationFilter(user, assigned)] },
      include: { matter: { select: matterRefSelect }, author: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.professionalObservation.findMany({
      where: { AND: [{ subjectContactId: contactId, supersededAt: { not: null } }, buildObservationFilter(user, assigned)] },
      select: { id: true, version: true, supersededAt: true, correctionReason: true },
    }),
  ]);

  const roleIn = (r: (typeof closures)[number]) =>
    r.judgeContactId === contactId ? "Judge" : r.prosecutorContactId === contactId ? "Prosecutor / solicitor" : "Opposing counsel";

  const lastProfessionalActivity =
    [...rulings.map((r) => r.rulingDate), ...closures.map((c) => c.closureDate)].sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

  return {
    rulings,
    priorVersionCount: priorVersions.length,
    priorVersions,
    summary: summarizeRulings(rulings),
    caseOutcomes: closures.map((c) => ({ ...c, roleInMatter: roleIn(c) })),
    observations,
    priorObservationVersionCount: priorObservationVersions.length,
    lastProfessionalActivity,
  };
}

/** Everything the matter Outcome tab shows. Caller must have asserted matter access. */
export async function getMatterOutcome(user: AuthorizableUser, matterId: string) {
  const assigned = await assignedFor(user);
  const [matter, rulings, observations, reports, matterContacts, documents, attorneys] = await Promise.all([
    prisma.matter.findUnique({
      where: { id: matterId },
      select: {
        id: true,
        status: true,
        caseNumber: true,
        court: true,
        charges: true,
        openedDate: true,
        closedDate: true,
        closureReviewStatus: true,
        assignments: { select: { role: true, userId: true } },
      },
    }),
    prisma.judicialRuling.findMany({
      where: { matterId },
      include: { judge: { select: { id: true, displayName: true } }, recordedBy: { select: { name: true } }, document: { select: { id: true, title: true } } },
      orderBy: [{ rulingDate: "desc" }, { version: "desc" }],
    }),
    prisma.professionalObservation.findMany({
      where: { AND: [{ matterId }, buildObservationFilter(user, assigned)] },
      include: { subject: { select: { id: true, displayName: true } }, author: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.matterClosureReport.findMany({
      where: { matterId },
      include: {
        trialOutcome: true,
        closingAttorney: { select: { name: true } },
        responsibleAttorney: { select: { name: true } },
        judge: { select: { id: true, displayName: true } },
        prosecutor: { select: { id: true, displayName: true } },
        opposingCounsel: { select: { id: true, displayName: true } },
      },
      orderBy: { version: "desc" },
    }),
    prisma.matterContact.findMany({
      where: { matterId, removedAt: null },
      select: { role: true, contact: { select: { id: true, displayName: true, categories: true } } },
    }),
    prisma.document.findMany({ where: { matterId }, select: { id: true, title: true }, orderBy: { uploadedAt: "desc" } }),
    prisma.user.findMany({
      where: { role: { in: ["ADMIN", "ATTORNEY"] }, status: "ACTIVE" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const professionals = [...new Map(matterContacts.map((mc) => [mc.contact.id, mc.contact])).values()];
  return {
    matter,
    currentRulings: rulings.filter((r) => !r.supersededAt),
    supersededRulings: rulings.filter((r) => r.supersededAt),
    observations,
    currentReport: reports.find((r) => !r.supersededAt) ?? null,
    priorReports: reports.filter((r) => r.supersededAt),
    judges: professionals.filter((c) => c.categories.includes("JUDGE")),
    professionals,
    documents,
    attorneys,
  };
}

/** Matters this user can open whose closure report still needs backfilling. */
export async function listMattersNeedingBackfill(user: AuthorizableUser) {
  const assigned = await assignedFor(user);
  return prisma.matter.findMany({
    where: { closureReviewStatus: "NEEDS_BACKFILL", ...(isAdmin(user) ? {} : { id: { in: assigned } }) },
    select: { id: true, caseNumber: true, client: { select: { lastName: true } } },
  });
}
