import type { Prisma, SavedReportKind } from "@prisma/client";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { matterIdFilterFor, matterScopeFilterFor } from "@/lib/auth/access";
import { isAdmin, type AuthorizableUser } from "@/lib/auth/authorization";
import { formatCsvCents, type CsvValue } from "@/lib/csv";
import { TIME_CATEGORY_VALUES, timeCategoryLabel } from "@/lib/time/labels";
import { ACTIVITY_EVENT_TYPES, parseUsageFilters } from "@/lib/usage/queries";
import { SEARCH_TYPE_LABELS, parseSearchParams } from "@/lib/search/params";
import { collectSearchResults } from "@/lib/search";

/**
 * Saved operational reports. A saved report stores only its *filters*
 * (Zod-validated per kind) — never results, ids-with-privileges, or the
 * owner's role. Every run re-scopes to the user running it, so a report
 * saved while someone had access to a matter silently stops returning
 * that matter's rows once access is removed, and USAGE reports are
 * refused to anyone who isn't ADMIN at run time.
 */

export const REPORT_KINDS = ["MATTERS", "TASKS", "TIME", "USAGE", "SEARCH"] as const satisfies readonly SavedReportKind[];
export type ReportKind = (typeof REPORT_KINDS)[number];

export const REPORT_KIND_LABELS: Record<ReportKind, string> = {
  MATTERS: "Matters",
  TASKS: "Tasks",
  TIME: "Recorded time",
  USAGE: "Application usage (admin)",
  SEARCH: "Search results",
};

/** Exported/rendered row cap — reports are operational lists, not bulk dumps. */
export const REPORT_ROW_CAP = 5_000;

const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const opt = <T extends z.ZodTypeAny>(schema: T) => schema.optional().catch(undefined);

export const REPORT_FILTER_SCHEMAS = {
  MATTERS: z.object({
    status: opt(z.enum(["OPEN", "PENDING", "CLOSED"])),
    stageId: opt(id),
    archived: z.enum(["active", "archived", "all"]).catch("active"),
    attorneyId: opt(id),
    cfDefinitionId: opt(id),
    cfValue: opt(z.string().trim().min(1).max(200)),
  }),
  TASKS: z.object({
    status: opt(z.enum(["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"])),
    priority: opt(z.enum(["LOW", "NORMAL", "HIGH"])),
    assigneeId: opt(id),
    matterId: opt(id),
    dueFrom: opt(day),
    dueTo: opt(day),
  }),
  TIME: z.object({
    from: opt(day),
    to: opt(day),
    matterId: opt(id),
    userId: opt(id),
    category: opt(z.enum(TIME_CATEGORY_VALUES)),
    billable: opt(z.enum(["yes", "no"])),
  }),
  USAGE: z.object({
    from: opt(day),
    to: opt(day),
    userId: opt(id),
    matterId: opt(id),
    type: opt(z.enum(ACTIVITY_EVENT_TYPES)),
  }),
  SEARCH: z.object({
    q: z.string().trim().min(2).max(100),
    type: opt(z.string().max(30)),
    from: opt(day),
    to: opt(day),
    matterId: opt(id),
    archived: z.enum(["active", "archived", "all"]).catch("active"),
  }),
} as const;

export type ReportFilters = Record<string, string>;

/** Raw query/form values → validated, flat string filters (undefined dropped). */
export function parseReportFilters(kind: ReportKind, raw: Record<string, unknown>): { ok: true; filters: ReportFilters } | { ok: false } {
  const flat = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v === "" ? undefined : v]),
  );
  const parsed = REPORT_FILTER_SCHEMAS[kind].safeParse(flat);
  if (!parsed.success) return { ok: false };
  const filters: ReportFilters = {};
  for (const [k, v] of Object.entries(parsed.data)) if (typeof v === "string" && v) filters[k] = v;
  return { ok: true, filters };
}

export function canRunReportKind(user: AuthorizableUser, kind: ReportKind): boolean {
  return kind !== "USAGE" || isAdmin(user);
}

export type ReportTable = { columns: string[]; rows: CsvValue[][]; truncated: boolean };

const dayStart = (d: string) => new Date(`${d}T00:00:00Z`);
const dayAfter = (d: string) => new Date(dayStart(d).getTime() + 24 * 60 * 60 * 1000);
function rangeOf(from?: string, to?: string) {
  if (!from && !to) return undefined;
  return { ...(from ? { gte: dayStart(from) } : {}), ...(to ? { lt: dayAfter(to) } : {}) };
}

/**
 * Custom-field equality for the MATTERS report, by the definition's type.
 * A forged/unknown/non-matter definition yields a condition that matches
 * nothing rather than being ignored (never widens results).
 */
export function customFieldCondition(
  definition: { entity: string; type: string; options?: unknown } | null,
  definitionId: string,
  value: string,
): Prisma.MatterWhereInput {
  const none: Prisma.MatterWhereInput = { id: { in: [] } };
  if (!definition || definition.entity !== "MATTER") return none;
  let valueWhere: Prisma.CustomFieldValueWhereInput;
  switch (definition.type) {
    case "SHORT_TEXT":
    case "LONG_TEXT":
      valueWhere = { valueText: { equals: value, mode: "insensitive" } };
      break;
    case "NUMBER": {
      const n = Number(value);
      if (!Number.isFinite(n)) return none;
      valueWhere = { valueNumber: n };
      break;
    }
    case "BOOLEAN":
      if (value !== "true" && value !== "false") return none;
      valueWhere = { valueBoolean: value === "true" };
      break;
    case "DATE":
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return none;
      valueWhere = { valueDate: { gte: dayStart(value), lt: dayAfter(value) } };
      break;
    case "SINGLE_SELECT": {
      // Accept an option id or its label (case-insensitive); retired options still resolve.
      const options = Array.isArray(definition.options) ? (definition.options as { id?: unknown; label?: unknown }[]) : [];
      const match = options.find(
        (o) => o.id === value || (typeof o.label === "string" && o.label.toLowerCase() === value.toLowerCase()),
      );
      if (!match || typeof match.id !== "string") return none;
      valueWhere = { valueOptionId: match.id };
      break;
    }
    default:
      return none;
  }
  return { customFieldValues: { some: { definitionId, ...valueWhere } } };
}

async function runMatters(user: AuthorizableUser, f: ReportFilters): Promise<ReportTable> {
  const conditions: Prisma.MatterWhereInput[] = [await matterIdFilterFor(user)];
  if (f.status) conditions.push({ status: f.status as "OPEN" | "PENDING" | "CLOSED" });
  if (f.stageId) conditions.push({ stageId: f.stageId });
  if (f.archived !== "all") conditions.push({ archived: f.archived === "archived" });
  if (f.attorneyId) conditions.push({ assignments: { some: { userId: f.attorneyId, role: { in: ["LEAD_ATTORNEY", "ASSOCIATE_ATTORNEY"] } } } });
  if (f.cfDefinitionId && f.cfValue) {
    const def = await prisma.customFieldDefinition.findUnique({ where: { id: f.cfDefinitionId }, select: { entity: true, type: true, options: true } });
    conditions.push(customFieldCondition(def, f.cfDefinitionId, f.cfValue));
  }
  const matters = await prisma.matter.findMany({
    where: { AND: conditions },
    orderBy: [{ openedDate: "desc" }, { id: "asc" }],
    take: REPORT_ROW_CAP + 1,
    select: {
      caseNumber: true,
      court: true,
      charges: true,
      status: true,
      archived: true,
      openedDate: true,
      closedDate: true,
      client: { select: { firstName: true, lastName: true } },
      stage: { select: { name: true } },
      assignments: { where: { role: "LEAD_ATTORNEY" }, select: { user: { select: { name: true } } } },
    },
  });
  return {
    columns: ["Case number", "Client", "Status", "Stage", "Court", "Charges", "Opened", "Closed", "Archived", "Lead attorney"],
    rows: matters.slice(0, REPORT_ROW_CAP).map((m) => [
      m.caseNumber,
      `${m.client.firstName} ${m.client.lastName}`,
      m.status,
      m.stage?.name ?? "",
      m.court,
      m.charges,
      m.openedDate.toISOString().slice(0, 10),
      m.closedDate ? m.closedDate.toISOString().slice(0, 10) : "",
      m.archived,
      m.assignments[0]?.user.name ?? "",
    ]),
    truncated: matters.length > REPORT_ROW_CAP,
  };
}

async function runTasks(user: AuthorizableUser, f: ReportFilters): Promise<ReportTable> {
  const conditions: Prisma.TaskWhereInput[] = [await matterScopeFilterFor(user)];
  if (f.status) conditions.push({ status: f.status as "OPEN" });
  if (f.priority) conditions.push({ priority: f.priority as "NORMAL" });
  if (f.assigneeId) conditions.push({ assignedToId: f.assigneeId });
  if (f.matterId) conditions.push({ matterId: f.matterId });
  const due = rangeOf(f.dueFrom, f.dueTo);
  if (due) conditions.push({ dueDate: due });
  const tasks = await prisma.task.findMany({
    where: { AND: conditions },
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { id: "asc" }],
    take: REPORT_ROW_CAP + 1,
    select: {
      title: true,
      status: true,
      priority: true,
      dueDate: true,
      assignedTo: { select: { name: true } },
      matter: { select: { caseNumber: true, client: { select: { lastName: true } } } },
    },
  });
  return {
    columns: ["Task", "Matter", "Status", "Priority", "Assignee", "Due date"],
    rows: tasks.slice(0, REPORT_ROW_CAP).map((t) => [
      t.title,
      `State v. ${t.matter.client.lastName} (${t.matter.caseNumber})`,
      t.status,
      t.priority,
      t.assignedTo?.name ?? "",
      t.dueDate ? t.dueDate.toISOString().slice(0, 10) : "",
    ]),
    truncated: tasks.length > REPORT_ROW_CAP,
  };
}

/** Amount columns (rate, amount) are included only for ADMIN, matching the time module. */
async function runTime(user: AuthorizableUser, f: ReportFilters): Promise<ReportTable> {
  const conditions: Prisma.TimeEntryWhereInput[] = [await matterScopeFilterFor(user), { voidedAt: null, status: "SUBMITTED" }];
  const range = rangeOf(f.from, f.to);
  if (range) conditions.push({ workDate: range });
  if (f.matterId) conditions.push({ matterId: f.matterId });
  if (f.userId) conditions.push({ userId: f.userId });
  if (f.category) conditions.push({ category: f.category as "OTHER" });
  if (f.billable) conditions.push({ billable: f.billable === "yes" });
  const entries = await prisma.timeEntry.findMany({
    where: { AND: conditions },
    orderBy: [{ workDate: "desc" }, { id: "asc" }],
    take: REPORT_ROW_CAP + 1,
    select: {
      workDate: true,
      durationMinutes: true,
      category: true,
      billable: true,
      description: true,
      hourlyRateCents: true,
      user: { select: { name: true } },
      matter: { select: { caseNumber: true, client: { select: { lastName: true } } } },
    },
  });
  const admin = isAdmin(user);
  return {
    columns: [
      "Date",
      "Matter",
      "Staff",
      "Category",
      "Hours",
      "Billable",
      "Description",
      ...(admin ? ["Hourly rate", "Amount"] : []),
    ],
    rows: entries.slice(0, REPORT_ROW_CAP).map((e) => [
      e.workDate.toISOString().slice(0, 10),
      `State v. ${e.matter.client.lastName} (${e.matter.caseNumber})`,
      e.user.name,
      timeCategoryLabel(e.category),
      (e.durationMinutes / 60).toFixed(2),
      e.billable,
      e.description,
      ...(admin
        ? [
            e.hourlyRateCents ? formatCsvCents(e.hourlyRateCents) : "",
            e.hourlyRateCents && e.billable ? formatCsvCents(Math.round((e.durationMinutes / 60) * e.hourlyRateCents)) : "",
          ]
        : []),
    ]),
    truncated: entries.length > REPORT_ROW_CAP,
  };
}

async function runUsage(f: ReportFilters): Promise<ReportTable> {
  const filters = parseUsageFilters(f);
  const events = await prisma.userActivityEvent.findMany({
    where: {
      occurredAt: { gte: filters.from, lt: filters.to },
      ...(filters.userId ? { userId: filters.userId } : {}),
      ...(filters.matterId ? { matterId: filters.matterId } : {}),
      ...(filters.type ? { type: filters.type } : {}),
    },
    orderBy: [{ occurredAt: "desc" }, { id: "asc" }],
    take: REPORT_ROW_CAP + 1,
    select: {
      occurredAt: true,
      type: true,
      module: true,
      path: true,
      result: true,
      user: { select: { name: true } },
      matter: { select: { caseNumber: true } },
    },
  });
  return {
    columns: ["Time (UTC)", "Staff", "Event", "Module", "Path", "Matter", "Result"],
    rows: events.slice(0, REPORT_ROW_CAP).map((e) => [
      e.occurredAt,
      e.user?.name ?? "",
      e.type,
      e.module ?? "",
      e.path ?? "",
      e.matter?.caseNumber ?? "",
      e.result,
    ]),
    truncated: events.length > REPORT_ROW_CAP,
  };
}

async function runSearch(user: AuthorizableUser, f: ReportFilters): Promise<ReportTable> {
  const parsed = parseSearchParams(f);
  if (!parsed.ok) return { columns: ["Type", "Title", "Details", "Excerpt", "Date", "Link"], rows: [], truncated: false };
  const results = await collectSearchResults(user, parsed.params, REPORT_ROW_CAP);
  const rows: CsvValue[][] = [];
  for (const r of results) {
    for (const item of r.items) {
      rows.push([SEARCH_TYPE_LABELS[r.type], item.title, item.subtitle ?? "", item.snippet ?? "", item.date ? item.date.toISOString().slice(0, 10) : "", item.href]);
    }
  }
  return {
    columns: ["Type", "Title", "Details", "Excerpt", "Date", "Link"],
    rows: rows.slice(0, REPORT_ROW_CAP),
    truncated: results.some((r) => r.total > r.items.length) || rows.length > REPORT_ROW_CAP,
  };
}

/**
 * Runs a report for `user` with already-validated filters. Returns null
 * when the user may not run this kind (USAGE for non-admins).
 */
export async function runReport(user: AuthorizableUser, kind: ReportKind, filters: ReportFilters): Promise<ReportTable | null> {
  if (!canRunReportKind(user, kind)) return null;
  switch (kind) {
    case "MATTERS":
      return runMatters(user, filters);
    case "TASKS":
      return runTasks(user, filters);
    case "TIME":
      return runTime(user, filters);
    case "USAGE":
      return runUsage(filters);
    case "SEARCH":
      return runSearch(user, filters);
  }
}

export function reportKindFromSlug(slug: string): ReportKind | null {
  const upper = slug.toUpperCase();
  return (REPORT_KINDS as readonly string[]).includes(upper) ? (upper as ReportKind) : null;
}
