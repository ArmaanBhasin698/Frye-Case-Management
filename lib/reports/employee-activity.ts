import { format } from "date-fns";

import { prisma } from "@/lib/db";
import { matterTitle } from "@/lib/matters/format";
import { ReportPdf } from "@/lib/reports/pdf";
import { rangeLabel, type DateRange } from "@/lib/reports/time-reports";
import { timeCategoryLabel } from "@/lib/time/labels";
import { formatHours, formatMinutes, summarizeEntries, type SummarizableEntry } from "@/lib/time/math";

/**
 * Employee Activity Report (ADMIN-only — the route enforces it). Reads the
 * usage tables written by the usage-instrumentation workstream
 * (UserSession, UserActivityEvent, UserActivityMinute) and recorded
 * TimeEntry rows. Active time is an *estimate* (count of heartbeat minutes)
 * and is labelled as such; it is never mixed into recorded work time. Rows
 * are reported as stored — nothing is inferred to fill gaps.
 */

export type EmployeeActivityData = {
  employee: { name: string; email: string; role: string };
  range: DateRange;
  sessions: { startedAt: Date; lastSeenAt: Date; endedAt: Date | null; endReason: string | null }[];
  events: { occurredAt: Date; type: string; module: string | null; result: string; matterLabel: string | null }[];
  estimatedActiveMinutes: number;
  activeMinutesByMatter: { label: string; minutes: number }[];
  timeEntries: SummarizableEntry[];
};

export async function loadEmployeeActivity(userId: string, range: DateRange): Promise<EmployeeActivityData | null> {
  const employee = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true, role: true } });
  if (!employee) return null;
  const between = { gte: range.from, lte: range.to };
  const matterSelect = { select: { caseNumber: true, client: { select: { firstName: true, lastName: true } } } };

  const [sessions, events, minutes, entries] = await Promise.all([
    prisma.userSession.findMany({
      where: { userId, startedAt: between },
      select: { startedAt: true, lastSeenAt: true, endedAt: true, endReason: true },
      orderBy: { startedAt: "asc" },
    }),
    prisma.userActivityEvent.findMany({
      where: { userId, occurredAt: between, type: { not: "PAGE_VIEW" } },
      select: { occurredAt: true, type: true, module: true, result: true, matter: matterSelect },
      orderBy: { occurredAt: "asc" },
      take: 2_000,
    }),
    prisma.userActivityMinute.findMany({
      where: { userId, minute: between },
      select: { matterId: true, matter: matterSelect },
    }),
    prisma.timeEntry.findMany({
      where: { userId, voidedAt: null, status: "SUBMITTED", workDate: between },
      include: { matter: { select: { caseNumber: true, client: { select: { firstName: true, lastName: true } } } } },
    }),
  ]);

  const byMatter = new Map<string, { label: string; minutes: number }>();
  for (const m of minutes) {
    if (!m.matterId || !m.matter) continue;
    const entry = byMatter.get(m.matterId) ?? { label: `${m.matter.caseNumber} — ${matterTitle(m.matter)}`, minutes: 0 };
    entry.minutes += 1;
    byMatter.set(m.matterId, entry);
  }

  return {
    employee,
    range,
    sessions,
    events: events.map((e) => ({
      occurredAt: e.occurredAt,
      type: e.type,
      module: e.module,
      result: e.result,
      matterLabel: e.matter ? `${e.matter.caseNumber} — ${matterTitle(e.matter)}` : null,
    })),
    estimatedActiveMinutes: minutes.length,
    activeMinutesByMatter: [...byMatter.values()].sort((a, b) => b.minutes - a.minutes),
    timeEntries: entries.map((e) => ({
      userId,
      userName: employee.name,
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

function humanize(value: string): string {
  return value.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export async function renderEmployeeActivityPdf(data: EmployeeActivityData, generatedAt = new Date()): Promise<Uint8Array> {
  const time = summarizeEntries(data.timeEntries, { categoryLabel: timeCategoryLabel });
  const pdf = await ReportPdf.create("Employee Activity Report", rangeLabel(data.range), generatedAt);
  pdf.keyValues([
    ["Employee", `${data.employee.name} (${data.employee.email})`],
    ["Role", humanize(data.employee.role)],
    ["Reporting period", rangeLabel(data.range)],
    ["Sessions", String(data.sessions.length)],
    ["Estimated active app time", `${formatMinutes(data.estimatedActiveMinutes)} (estimate)`],
    ["Recorded work time", `${formatHours(time.totalMinutes)} hours`],
  ]);
  pdf.paragraph(
    "Estimated active app time counts minutes in which the application was open, visible, and recently used (one minute counted once across tabs and devices). It is an estimate of application usage, not work performed, and is never converted into recorded work time.",
    { muted: true },
  );

  pdf.heading("Login / session history");
  pdf.table(
    [
      { header: "Signed in", width: 2 },
      { header: "Last activity", width: 2 },
      { header: "Ended", width: 2 },
      { header: "End reason", width: 1.4 },
    ],
    data.sessions.map((s) => [
      format(s.startedAt, "MM/dd/yyyy h:mm a"),
      format(s.lastSeenAt, "MM/dd/yyyy h:mm a"),
      s.endedAt ? format(s.endedAt, "MM/dd/yyyy h:mm a") : "Not recorded",
      s.endReason ? humanize(s.endReason) : "—",
    ]),
    { emptyText: "No recorded activity." },
  );

  pdf.heading("Significant application activity");
  pdf.table(
    [
      { header: "When", width: 2 },
      { header: "Event", width: 2 },
      { header: "Module", width: 1.5 },
      { header: "Matter", width: 3 },
      { header: "Result", width: 1 },
    ],
    data.events.map((e) => [
      format(e.occurredAt, "MM/dd/yyyy h:mm a"),
      humanize(e.type),
      e.module ?? "—",
      e.matterLabel ?? "—",
      humanize(e.result),
    ]),
    { emptyText: "No recorded activity." },
  );

  pdf.heading("Estimated active time by matter");
  pdf.table(
    [
      { header: "Matter", width: 4 },
      { header: "Estimated time", width: 1.5, align: "right" },
    ],
    data.activeMinutesByMatter.map((m) => [m.label, formatMinutes(m.minutes)]),
    { emptyText: "No recorded activity." },
  );

  pdf.heading("Recorded work time by matter");
  pdf.table(
    [
      { header: "Matter", width: 4 },
      { header: "Billable", width: 1, align: "right" },
      { header: "Total hours", width: 1, align: "right" },
    ],
    time.byMatter.map((b) => [b.label, formatHours(b.billableMinutes), formatHours(b.minutes)]),
    {
      emptyText: "No recorded time in this period.",
      totalRow: time.entryCount ? ["Total", formatHours(time.billableMinutes), formatHours(time.totalMinutes)] : undefined,
    },
  );
  return pdf.finish();
}
