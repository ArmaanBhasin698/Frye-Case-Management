import type {
  CallDirection,
  DeadlineType,
  DiscoveryFileType,
  DiscoveryReviewStatus,
  Prisma,
  TaskPriority,
  TaskStatus,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import { getAssignedMatterIds } from "@/lib/auth/access";
import { getCallVisibilityFilter } from "@/lib/communications/queries";
import { buildMatterIdFilter, buildMatterScopeFilter, isAdmin } from "@/lib/auth/authorization";
import type { AuthorizableUser } from "@/lib/auth/authorization";
import { matterTitle, todayAsStoredDate } from "@/lib/matters/format";

/**
 * Firm-wide Reports aggregate queries (see CLAUDE.md, section 4.4 and
 * docs/SECURITY.md) — the query layer behind app/(dashboard)/reports. This
 * is a read-only reporting pass over the exact rows every other firm-wide
 * page already reads (Task/Deadline/Document/DiscoveryFile/
 * DiscoveryProduction/Call/Note) — no new entity, no new write path, no
 * schema change.
 *
 * Authorization is never re-derived here: `getMatterScopes` below builds
 * every section's `where` fragment from the exact same pure rules
 * (`buildMatterIdFilter`/`buildMatterScopeFilter`, lib/auth/authorization.ts)
 * that `matterIdFilterFor`/`matterScopeFilterFor` (lib/auth/access.ts) wrap
 * for every other firm-wide page (lib/tasks/queries.ts,
 * lib/calendar/queries.ts, lib/discovery/queries.ts) — just resolved once
 * per report instead of once per section. For Calls, the exact
 * `getCallVisibilityFilter` helper lib/communications/queries.ts exports
 * for its own firm-wide page is reused as-is. An ADMIN gets an unrestricted
 * scope, everyone else only matters they're assigned to. A `matterId`
 * filter is always combined with that scope via `AND`, never in place of
 * it, so a caller can't widen a report beyond their own access by passing
 * one (see tests/reports/queries.test.ts).
 *
 * Every count/groupBy below runs as its own scoped aggregate query against
 * Postgres — this module never loads a full row set into memory just to
 * count or bucket it in JavaScript, with the sole exception of resolving
 * the small number of matter/user ids a breakdown names back to their
 * titles (bounded by the breakdown's `take` limit, and re-intersected with
 * the caller's own matter scope as defense in depth for matters).
 */

export type ReportWindow = "7d" | "30d" | "90d" | "all";

export type ReportFilters = {
  matterId?: string;
  window?: ReportWindow;
};

export type ReportMatterBreakdown = {
  matterId: string;
  label: string;
  caseNumber: string;
  count: number;
};

export type ReportAssigneeBreakdown = {
  userId: string | null;
  name: string;
  count: number;
};

export type ReportSummary = {
  matters: { active: number };
  tasks: {
    total: number;
    byStatus: Record<TaskStatus, number>;
    overdue: number;
    byPriority: Record<TaskPriority, number>;
    byMatter: ReportMatterBreakdown[];
    byAssignee: ReportAssigneeBreakdown[];
  };
  deadlines: {
    total: number;
    satisfied: number;
    upcoming: number;
    overdue: number;
    byType: Record<DeadlineType, number>;
  };
  documents: { total: number };
  discovery: {
    productions: number;
    files: number;
    byReviewStatus: Record<DiscoveryReviewStatus, number>;
    byFileType: Record<DiscoveryFileType, number>;
  };
  calls: {
    total: number;
    byDirection: Record<CallDirection, number>;
    /** `null` when the caller isn't allowed to see unfiled calls at all (see getCallVisibilityFilter) — never 0-as-"none exist". */
    unfiled: number | null;
  };
  activity: {
    window: ReportWindow;
    since: Date | null;
    tasksCreated: number;
    notesAdded: number;
    documentsUploaded: number;
    callsLogged: number;
    discoveryFilesRegistered: number;
  };
};

/** The exact shape `matterScopeFilterFor` (lib/auth/access.ts) returns: `{}` for an admin's unrestricted scope, `{ matterId: { in: [...] } }` otherwise. */
type MatterScope = { matterId?: { in: string[] } };

const TASK_STATUSES: TaskStatus[] = ["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"];
const TASK_PRIORITIES: TaskPriority[] = ["LOW", "NORMAL", "HIGH"];
const DEADLINE_TYPES: DeadlineType[] = ["STATUTE_OF_LIMITATIONS", "SPEEDY_TRIAL", "FILING", "OTHER"];
const DISCOVERY_REVIEW_STATUSES: DiscoveryReviewStatus[] = ["NOT_STARTED", "IN_REVIEW", "COMPLETE"];
const DISCOVERY_FILE_TYPES: DiscoveryFileType[] = ["PDF", "VIDEO", "AUDIO", "PHOTO", "OTHER"];
const CALL_DIRECTIONS: CallDirection[] = ["INBOUND", "OUTBOUND"];

const OPEN_TASK_STATUSES: TaskStatus[] = ["OPEN", "IN_PROGRESS"];

const MATTER_BREAKDOWN_LIMIT = 8;
const ASSIGNEE_BREAKDOWN_LIMIT = 8;

const WINDOW_DAYS: Record<ReportWindow, number | null> = { "7d": 7, "30d": 30, "90d": 90, all: null };

/** Server-local time, same convention as lib/dashboard/queries.ts and lib/calendar/queries.ts — see README's "Reports" section for the timezone caveat this implies. */
function windowStart(window: ReportWindow): Date | null {
  const days = WINDOW_DAYS[window];
  if (days == null) return null;
  const since = new Date();
  since.setDate(since.getDate() - days);
  return since;
}

function zeroRecord<K extends string>(keys: K[]): Record<K, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
}

/** Combines `where` fragments the same way every other firm-wide query file does: `AND` when there's more than one, the lone fragment (or `{}`) otherwise — never nests a lone `{}` in a way that would mean "no rows" instead of "no restriction." */
function combine<T extends object>(conditions: T[]): T {
  if (conditions.length <= 1) return conditions[0] ?? ({} as T);
  return { AND: conditions } as unknown as T;
}

/**
 * Resolves "what matters can `user` see" exactly once per report — the
 * assigned-matter lookup (`getAssignedMatterIds`) is the only I/O this
 * does; every `where` fragment below is then built from it with the same
 * pure, unit-tested rules `lib/auth/access.ts` wraps for every other
 * firm-wide page (`buildMatterIdFilter`/`buildMatterScopeFilter` — see
 * tests/auth/authorization.test.ts), just without re-querying assignments
 * once per section the way calling `matterIdFilterFor`/
 * `matterScopeFilterFor` from every section separately would.
 */
async function getMatterScopes(user: AuthorizableUser) {
  const assignedMatterIds = isAdmin(user) ? [] : await getAssignedMatterIds(user.id);
  return {
    matterWhere: buildMatterIdFilter(user, assignedMatterIds),
    scopeWhere: buildMatterScopeFilter(user, assignedMatterIds) as MatterScope,
  };
}

export async function getFirmReportSummary(
  user: AuthorizableUser,
  filters: ReportFilters = {},
): Promise<ReportSummary> {
  const window = filters.window ?? "30d";
  const since = windowStart(window);

  const [{ matterWhere, scopeWhere }, callVisibility] = await Promise.all([
    getMatterScopes(user),
    getCallVisibilityFilter(user),
  ]);

  const matterIdCond = filters.matterId ? { matterId: filters.matterId } : undefined;

  const [matters, tasks, deadlines, documents, discovery, calls, activity] = await Promise.all([
    getMatterSummary(matterWhere, filters.matterId),
    getTaskSummary(scopeWhere, matterIdCond, matterWhere),
    getDeadlineSummary(scopeWhere, matterIdCond),
    getDocumentSummary(scopeWhere, matterIdCond),
    getDiscoverySummary(scopeWhere, matterIdCond),
    getCallSummary(callVisibility, matterIdCond),
    getActivitySummary(scopeWhere, matterIdCond, callVisibility, since),
  ]);

  return {
    matters,
    tasks,
    deadlines,
    documents,
    discovery,
    calls,
    activity: { window, since, ...activity },
  };
}

async function getMatterSummary(
  matterWhere: Prisma.MatterWhereInput,
  matterId: string | undefined,
): Promise<ReportSummary["matters"]> {
  const where = combine<Prisma.MatterWhereInput>([
    matterWhere,
    { status: { in: ["OPEN", "PENDING"] } },
    ...(matterId ? [{ id: matterId }] : []),
  ]);
  const active = await prisma.matter.count({ where });
  return { active };
}

async function getTaskSummary(
  scopeWhere: MatterScope,
  matterIdCond: { matterId: string } | undefined,
  matterWhere: Prisma.MatterWhereInput,
): Promise<ReportSummary["tasks"]> {
  const where = combine<Prisma.TaskWhereInput>([scopeWhere, ...(matterIdCond ? [matterIdCond] : [])]);
  const overdueWhere = combine<Prisma.TaskWhereInput>([
    where,
    { dueDate: { lt: todayAsStoredDate() }, status: { in: OPEN_TASK_STATUSES } },
  ]);

  const [total, statusGroups, overdue, priorityGroups, matterGroups, assigneeGroups] = await Promise.all([
    prisma.task.count({ where }),
    prisma.task.groupBy({ by: ["status"], where, _count: true }),
    prisma.task.count({ where: overdueWhere }),
    prisma.task.groupBy({ by: ["priority"], where, _count: true }),
    prisma.task.groupBy({
      by: ["matterId"],
      where,
      _count: true,
      // `id` orders by true row count per group, unlike ordering on the
      // grouped-by column itself, which would silently rank a nullable
      // grouped field's "unassigned" bucket as 0 (see assignedToId below).
      orderBy: { _count: { id: "desc" } },
      take: MATTER_BREAKDOWN_LIMIT,
    }),
    prisma.task.groupBy({
      by: ["assignedToId"],
      where,
      _count: true,
      orderBy: { _count: { id: "desc" } },
      take: ASSIGNEE_BREAKDOWN_LIMIT,
    }),
  ]);

  const byStatus = zeroRecord(TASK_STATUSES);
  for (const g of statusGroups) byStatus[g.status] = g._count;

  const byPriority = zeroRecord(TASK_PRIORITIES);
  for (const g of priorityGroups) byPriority[g.priority] = g._count;

  const [byMatter, byAssignee] = await Promise.all([
    resolveMatterBreakdown(
      matterWhere,
      matterGroups.map((g) => ({ matterId: g.matterId, count: g._count })),
    ),
    resolveAssigneeBreakdown(assigneeGroups.map((g) => ({ userId: g.assignedToId, count: g._count }))),
  ]);

  return { total, byStatus, overdue, byPriority, byMatter, byAssignee };
}

async function resolveMatterBreakdown(
  matterWhere: Prisma.MatterWhereInput,
  groups: { matterId: string; count: number }[],
): Promise<ReportMatterBreakdown[]> {
  if (groups.length === 0) return [];
  const ids = groups.map((g) => g.matterId);
  // Defense in depth: re-intersect with the caller's own matter scope
  // before resolving titles, even though `groups` was already produced
  // from a scoped `where` — see the module doc comment above.
  const matters = await prisma.matter.findMany({
    where: combine<Prisma.MatterWhereInput>([matterWhere, { id: { in: ids } }]),
    include: { client: true },
  });
  const byId = new Map(matters.map((m) => [m.id, m]));

  return groups
    .map((g) => {
      const matter = byId.get(g.matterId);
      if (!matter) return null;
      return { matterId: g.matterId, label: matterTitle(matter), caseNumber: matter.caseNumber, count: g.count };
    })
    .filter((row): row is ReportMatterBreakdown => row !== null);
}

async function resolveAssigneeBreakdown(
  groups: { userId: string | null; count: number }[],
): Promise<ReportAssigneeBreakdown[]> {
  const ids = groups.map((g) => g.userId).filter((id): id is string => id !== null);
  const users = ids.length > 0 ? await prisma.user.findMany({ where: { id: { in: ids } } }) : [];
  const byId = new Map(users.map((u) => [u.id, u]));

  return groups.map((g) => ({
    userId: g.userId,
    name: g.userId ? byId.get(g.userId)?.name ?? "Unknown" : "Unassigned",
    count: g.count,
  }));
}

async function getDeadlineSummary(
  scopeWhere: MatterScope,
  matterIdCond: { matterId: string } | undefined,
): Promise<ReportSummary["deadlines"]> {
  const where = combine<Prisma.DeadlineWhereInput>([scopeWhere, ...(matterIdCond ? [matterIdCond] : [])]);
  const today = todayAsStoredDate();

  const [total, satisfied, upcoming, overdue, typeGroups] = await Promise.all([
    prisma.deadline.count({ where }),
    prisma.deadline.count({ where: combine([where, { satisfied: true }]) }),
    prisma.deadline.count({ where: combine([where, { satisfied: false, date: { gte: today } }]) }),
    prisma.deadline.count({ where: combine([where, { satisfied: false, date: { lt: today } }]) }),
    prisma.deadline.groupBy({ by: ["type"], where, _count: true }),
  ]);

  const byType = zeroRecord(DEADLINE_TYPES);
  for (const g of typeGroups) byType[g.type] = g._count;

  return { total, satisfied, upcoming, overdue, byType };
}

async function getDocumentSummary(
  scopeWhere: MatterScope,
  matterIdCond: { matterId: string } | undefined,
): Promise<ReportSummary["documents"]> {
  const where = combine<Prisma.DocumentWhereInput>([scopeWhere, ...(matterIdCond ? [matterIdCond] : [])]);
  const total = await prisma.document.count({ where });
  return { total };
}

/** `DiscoveryFile` has no `matterId` column of its own (see lib/discovery/queries.ts) — reach a matter only through `production`, and skip nesting an admin's unrestricted `{}` under it (same regression lib/discovery/queries.ts#getFirmWideDiscoveryFiles guards). */
function discoveryFileWhereFor(
  productionWhere: Prisma.DiscoveryProductionWhereInput,
  scopeIsUnrestricted: boolean,
  extra?: Prisma.DiscoveryFileWhereInput,
): Prisma.DiscoveryFileWhereInput {
  const base: Prisma.DiscoveryFileWhereInput = scopeIsUnrestricted ? {} : { production: productionWhere };
  return extra ? combine<Prisma.DiscoveryFileWhereInput>([base, extra]) : base;
}

async function getDiscoverySummary(
  scopeWhere: MatterScope,
  matterIdCond: { matterId: string } | undefined,
): Promise<ReportSummary["discovery"]> {
  const productionWhere = combine<Prisma.DiscoveryProductionWhereInput>([
    scopeWhere,
    ...(matterIdCond ? [matterIdCond] : []),
  ]);
  const scopeIsUnrestricted = Object.keys(scopeWhere).length === 0 && !matterIdCond;
  const fileWhere = discoveryFileWhereFor(productionWhere, scopeIsUnrestricted);

  const [productions, files, reviewGroups, fileTypeGroups] = await Promise.all([
    prisma.discoveryProduction.count({ where: productionWhere }),
    prisma.discoveryFile.count({ where: fileWhere }),
    prisma.discoveryProduction.groupBy({ by: ["reviewStatus"], where: productionWhere, _count: true }),
    prisma.discoveryFile.groupBy({ by: ["fileType"], where: fileWhere, _count: true }),
  ]);

  const byReviewStatus = zeroRecord(DISCOVERY_REVIEW_STATUSES);
  for (const g of reviewGroups) byReviewStatus[g.reviewStatus] = g._count;

  const byFileType = zeroRecord(DISCOVERY_FILE_TYPES);
  for (const g of fileTypeGroups) byFileType[g.fileType] = g._count;

  return { productions, files, byReviewStatus, byFileType };
}

async function getCallSummary(
  callVisibility: { where: Prisma.CallWhereInput; mayViewUnfiled: boolean },
  matterIdCond: { matterId: string } | undefined,
): Promise<ReportSummary["calls"]> {
  const where = combine<Prisma.CallWhereInput>([
    callVisibility.where,
    ...(matterIdCond ? [matterIdCond] : []),
  ]);

  const [total, directionGroups, unfiled] = await Promise.all([
    prisma.call.count({ where }),
    prisma.call.groupBy({ by: ["direction"], where, _count: true }),
    callVisibility.mayViewUnfiled
      ? prisma.call.count({ where: combine([where, { matterId: null }]) })
      : Promise.resolve(null),
  ]);

  const byDirection = zeroRecord(CALL_DIRECTIONS);
  for (const g of directionGroups) byDirection[g.direction] = g._count;

  return { total, byDirection, unfiled };
}

async function getActivitySummary(
  scopeWhere: MatterScope,
  matterIdCond: { matterId: string } | undefined,
  callVisibility: { where: Prisma.CallWhereInput; mayViewUnfiled: boolean },
  since: Date | null,
): Promise<Omit<ReportSummary["activity"], "window" | "since">> {
  const extra = matterIdCond ? [matterIdCond] : [];
  const scopeIsUnrestricted = Object.keys(scopeWhere).length === 0 && !matterIdCond;

  const taskWhere = combine<Prisma.TaskWhereInput>([
    scopeWhere,
    ...extra,
    ...(since ? [{ createdAt: { gte: since } }] : []),
  ]);
  const noteWhere = combine<Prisma.NoteWhereInput>([
    scopeWhere,
    ...extra,
    ...(since ? [{ createdAt: { gte: since } }] : []),
  ]);
  const documentWhere = combine<Prisma.DocumentWhereInput>([
    scopeWhere,
    ...extra,
    ...(since ? [{ uploadedAt: { gte: since } }] : []),
  ]);
  const callWhere = combine<Prisma.CallWhereInput>([
    callVisibility.where,
    ...extra,
    ...(since ? [{ createdAt: { gte: since } }] : []),
  ]);
  const productionWhere = combine<Prisma.DiscoveryProductionWhereInput>([scopeWhere, ...extra]);
  const discoveryFileWhere = discoveryFileWhereFor(
    productionWhere,
    scopeIsUnrestricted,
    since ? { createdAt: { gte: since } } : undefined,
  );

  const [tasksCreated, notesAdded, documentsUploaded, callsLogged, discoveryFilesRegistered] = await Promise.all([
    prisma.task.count({ where: taskWhere }),
    prisma.note.count({ where: noteWhere }),
    prisma.document.count({ where: documentWhere }),
    prisma.call.count({ where: callWhere }),
    prisma.discoveryFile.count({ where: discoveryFileWhere }),
  ]);

  return { tasksCreated, notesAdded, documentsUploaded, callsLogged, discoveryFilesRegistered };
}
