import type { Prisma, TaskPriority, TaskStatus } from "@prisma/client";

import { prisma } from "@/lib/db";
import { matterScopeFilterFor } from "@/lib/auth/access";
import type { AuthorizableUser } from "@/lib/auth/authorization";
import { todayAsStoredDate } from "@/lib/matters/format";

/**
 * Firm-wide Task aggregate query (see CLAUDE.md, section 4.4 and
 * docs/SECURITY.md). This does not introduce a second Task record or a
 * new authorization rule — it's the existing per-matter `Task` model
 * (lib/matters/queries.ts#getMatterTasks writes/reads the same rows),
 * read across every matter `user` is allowed to see.
 *
 * `matterScopeFilterFor` (lib/auth/access.ts) is the same helper
 * lib/dashboard/queries.ts already uses for its firm-wide widgets: admins
 * get `{}` (no restriction), everyone else gets `{ matterId: { in:
 * assignedMatterIds } }`. Every filter below is combined with that scope
 * via `AND`, so a caller can never widen the result beyond it by passing
 * a filter — there is intentionally no way to call this without a scoped
 * `where` reaching Postgres.
 */

export type FirmTaskFilters = {
  status?: TaskStatus;
  priority?: TaskPriority;
  assignedToId?: string;
  matterId?: string;
  overdueOnly?: boolean;
};

export type FirmTaskSort = "dueDate" | "priority";

const OPEN_STATUSES: TaskStatus[] = ["OPEN", "IN_PROGRESS"];

export async function getFirmWideTasks(
  user: AuthorizableUser,
  filters: FirmTaskFilters = {},
  sort: FirmTaskSort = "dueDate",
) {
  const scopeWhere = await matterScopeFilterFor(user);

  const conditions: Prisma.TaskWhereInput[] = [scopeWhere];
  if (filters.status) conditions.push({ status: filters.status });
  if (filters.priority) conditions.push({ priority: filters.priority });
  if (filters.assignedToId) conditions.push({ assignedToId: filters.assignedToId });
  if (filters.matterId) conditions.push({ matterId: filters.matterId });
  if (filters.overdueOnly) {
    conditions.push({ dueDate: { lt: todayAsStoredDate() }, status: { in: OPEN_STATUSES } });
  }

  const orderBy: Prisma.TaskOrderByWithRelationInput[] =
    sort === "priority" ? [{ priority: "desc" }, { dueDate: "asc" }] : [{ dueDate: "asc" }, { priority: "desc" }];

  return prisma.task.findMany({
    where: conditions.length === 1 ? conditions[0] : { AND: conditions },
    include: { matter: { include: { client: true } }, assignedTo: true },
    orderBy,
  });
}

export type FirmWideTask = Awaited<ReturnType<typeof getFirmWideTasks>>[number];
