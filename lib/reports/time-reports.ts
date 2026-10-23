import { endOfDay, format, startOfDay, subDays } from "date-fns";

import { prisma } from "@/lib/db";
import { matterTitle } from "@/lib/matters/format";
import { ReportPdf } from "@/lib/reports/pdf";
import { timeCategoryLabel } from "@/lib/time/labels";
import { formatCents, formatHours, summarizeEntries, type SummarizableEntry } from "@/lib/time/math";

/**
 * Data loading + rendering for the Matter Time and Firm Utilization PDFs.
 * Callers (the route handlers) have already authorized the request; these
 * functions only ever read recorded TimeEntry rows — nothing is estimated
 * or invented, and empty periods render "No recorded time".
 */

export type DateRange = { from: Date; to: Date };

/** Parses ?from=YYYY-MM-DD&to=YYYY-MM-DD, defaulting to the last 30 days. Null if invalid. */
export function parseDateRange(from: string | null, to: string | null, now = new Date()): DateRange | null {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if ((from && !re.test(from)) || (to && !re.test(to))) return null;
  const end = to ? endOfDay(new Date(`${to}T12:00:00`)) : endOfDay(now);
  const start = from ? startOfDay(new Date(`${from}T12:00:00`)) : startOfDay(subDays(now, 30));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return null;
  if (end.getTime() - start.getTime() > 3 * 366 * 24 * 60 * 60 * 1000) return null;
  return { from: start, to: end };
}

export function rangeLabel(range: DateRange): string {
  return `${format(range.from, "MMM d, yyyy")} – ${format(range.to, "MMM d, yyyy")}`;
}

const recordedWhere = (range: DateRange) => ({
  voidedAt: null,
  status: "SUBMITTED" as const,
  workDate: { gte: range.from, lte: range.to },
});

// --- Matter time ---------------------------------------------------------------

export type MatterTimeReportData = {
  matter: { caseNumber: string; title: string; court: string; status: string };
  range: DateRange;
  includeAmounts: boolean;
  entries: (SummarizableEntry & { description: string })[];
};

export async function loadMatterTimeReport(matterId: string, range: DateRange, includeAmounts: boolean) {
  const matter = await prisma.matter.findUnique({
    where: { id: matterId },
    select: { caseNumber: true, court: true, status: true, client: { select: { firstName: true, lastName: true } } },
  });
  if (!matter) return null;
  const rows = await prisma.timeEntry.findMany({
    where: { matterId, ...recordedWhere(range) },
    include: { user: { select: { name: true } } },
    orderBy: [{ workDate: "asc" }, { createdAt: "asc" }],
  });
  const data: MatterTimeReportData = {
    matter: { caseNumber: matter.caseNumber, title: matterTitle(matter), court: matter.court, status: matter.status },
    range,
    includeAmounts,
    entries: rows.map((e) => ({
      userId: e.userId,
      userName: e.user.name,
      workDate: e.workDate,
      durationMinutes: e.durationMinutes,
      billable: e.billable,
      category: e.category,
      hourlyRateCents: e.hourlyRateCents,
      voidedAt: e.voidedAt,
      status: e.status,
      description: e.description,
    })),
  };
  return data;
}

export async function renderMatterTimePdf(data: MatterTimeReportData, generatedAt = new Date()): Promise<Uint8Array> {
  const summary = summarizeEntries(data.entries, { includeAmounts: data.includeAmounts, categoryLabel: timeCategoryLabel });
  const pdf = await ReportPdf.create("Matter Time Report", rangeLabel(data.range), generatedAt);
  pdf.keyValues([
    ["Matter", `${data.matter.title} (${data.matter.caseNumber})`],
    ["Court", data.matter.court],
    ["Status", data.matter.status],
    ["Reporting period", rangeLabel(data.range)],
    ["Total recorded hours", formatHours(summary.totalMinutes)],
    ["Billable hours", formatHours(summary.billableMinutes)],
    ["Nonbillable hours", formatHours(summary.nonbillableMinutes)],
    ...(data.includeAmounts && summary.billableAmountCents !== undefined
      ? ([["Billable value (rated entries)", formatCents(summary.billableAmountCents)]] as [string, string][])
      : []),
  ]);

  pdf.heading("Hours by staff member");
  pdf.table(
    [
      { header: "Staff member", width: 3 },
      { header: "Billable", width: 1, align: "right" },
      { header: "Nonbillable", width: 1, align: "right" },
      { header: "Total", width: 1, align: "right" },
    ],
    summary.byUser.map((b) => [b.label, formatHours(b.billableMinutes), formatHours(b.minutes - b.billableMinutes), formatHours(b.minutes)]),
    { emptyText: "No recorded time in this period." },
  );

  pdf.heading("Hours by activity category");
  pdf.table(
    [
      { header: "Category", width: 3 },
      { header: "Billable", width: 1, align: "right" },
      { header: "Total", width: 1, align: "right" },
    ],
    summary.byCategory.map((b) => [b.label, formatHours(b.billableMinutes), formatHours(b.minutes)]),
    { emptyText: "No recorded time in this period." },
  );

  pdf.heading("Time entries");
  const columns = [
    { header: "Date", width: 1.1 },
    { header: "Staff", width: 1.4 },
    { header: "Category", width: 1.5 },
    { header: "Description", width: 4 },
    { header: "Billable", width: 0.8 },
    { header: "Hours", width: 0.8, align: "right" as const },
    ...(data.includeAmounts ? [{ header: "Rate", width: 0.9, align: "right" as const }] : []),
  ];
  const counted = data.entries.filter((e) => !e.voidedAt && e.status !== "DRAFT");
  pdf.table(
    columns,
    counted.map((e) => [
      format(e.workDate, "MM/dd/yyyy"),
      e.userName,
      timeCategoryLabel(e.category),
      e.description,
      e.billable ? "Yes" : "No",
      formatHours(e.durationMinutes),
      ...(data.includeAmounts ? [e.hourlyRateCents ? formatCents(e.hourlyRateCents) : "—"] : []),
    ]),
    {
      emptyText: "No recorded time in this period.",
      totalRow: counted.length
        ? ["Total", "", "", "", "", formatHours(summary.totalMinutes), ...(data.includeAmounts ? [""] : [])]
        : undefined,
    },
  );
  return pdf.finish();
}

// --- Firm utilization -------------------------------------------------------------

export type FirmUtilizationData = { range: DateRange; entries: SummarizableEntry[] };

export async function loadFirmUtilization(range: DateRange): Promise<FirmUtilizationData> {
  const rows = await prisma.timeEntry.findMany({
    where: recordedWhere(range),
    include: {
      user: { select: { name: true } },
      matter: { select: { id: true, caseNumber: true, client: { select: { firstName: true, lastName: true } } } },
    },
  });
  return {
    range,
    entries: rows.map((e) => ({
      userId: e.userId,
      userName: e.user.name,
      matterId: e.matterId,
      matterLabel: `${e.matter.caseNumber} — ${matterTitle(e.matter)}`,
      workDate: e.workDate,
      durationMinutes: e.durationMinutes,
      billable: e.billable,
      category: e.category,
      hourlyRateCents: e.hourlyRateCents,
      voidedAt: e.voidedAt,
      status: e.status,
    })),
  };
}

export async function renderFirmUtilizationPdf(data: FirmUtilizationData, generatedAt = new Date()): Promise<Uint8Array> {
  const summary = summarizeEntries(data.entries, { includeAmounts: true, categoryLabel: timeCategoryLabel });
  const pdf = await ReportPdf.create("Firm Utilization Report", rangeLabel(data.range), generatedAt);
  pdf.keyValues([
    ["Reporting period", rangeLabel(data.range)],
    ["Total recorded hours", formatHours(summary.totalMinutes)],
    ["Billable hours", formatHours(summary.billableMinutes)],
    ["Nonbillable hours", formatHours(summary.nonbillableMinutes)],
    ["Time entries", String(summary.entryCount)],
  ]);
  pdf.paragraph(
    "Recorded work time only (submitted, non-voided entries). Application usage estimates are not included and are never counted as work time.",
    { muted: true },
  );
  const cols = [
    { header: "Name", width: 3 },
    { header: "Billable", width: 1, align: "right" as const },
    { header: "Nonbillable", width: 1, align: "right" as const },
    { header: "Total", width: 1, align: "right" as const },
  ];
  const toRow = (b: { label: string; minutes: number; billableMinutes: number }) => [
    b.label,
    formatHours(b.billableMinutes),
    formatHours(b.minutes - b.billableMinutes),
    formatHours(b.minutes),
  ];
  const total = ["Firm-wide total", formatHours(summary.billableMinutes), formatHours(summary.nonbillableMinutes), formatHours(summary.totalMinutes)];
  pdf.heading("Hours by employee");
  pdf.table(cols, summary.byUser.map(toRow), { emptyText: "No recorded time in this period.", totalRow: summary.entryCount ? total : undefined });
  pdf.heading("Hours by matter");
  pdf.table(
    [{ ...cols[0]!, header: "Matter" }, ...cols.slice(1)],
    summary.byMatter.map(toRow),
    { emptyText: "No recorded time in this period.", totalRow: summary.entryCount ? total : undefined },
  );
  pdf.heading("Hours by activity category");
  pdf.table([{ ...cols[0]!, header: "Category" }, ...cols.slice(1)], summary.byCategory.map(toRow), {
    emptyText: "No recorded time in this period.",
  });
  return pdf.finish();
}
