import { prisma } from "@/lib/db";
import { matterIdFilterFor } from "@/lib/auth/access";
import type { AuthorizableUser } from "@/lib/auth/authorization";

/** Case-stage reads. Stage names/order aren't case data; matter-derived counts are access-scoped. */

export function listStages(options: { includeArchived?: boolean } = {}) {
  return prisma.matterStage.findMany({
    where: options.includeArchived ? {} : { archivedAt: null },
    include: { _count: { select: { matters: true } } },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
}

/** Stage history for one matter. Caller must have asserted matter access. */
export function getMatterStageHistory(matterId: string) {
  return prisma.matterStageChange.findMany({
    where: { matterId },
    include: {
      fromStage: { select: { name: true } },
      toStage: { select: { name: true } },
      changedBy: { select: { name: true } },
    },
    orderBy: { changedAt: "desc" },
    take: 50,
  });
}

/**
 * Matter counts per stage over the matters `user` can access (non-archived
 * matters only), plus a "no stage" bucket. Counting happens in the
 * database after scoping — inaccessible matters are never counted.
 */
export async function getStageCounts(user: AuthorizableUser) {
  const scope = await matterIdFilterFor(user);
  const [stages, grouped] = await Promise.all([
    prisma.matterStage.findMany({ orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
    prisma.matter.groupBy({ by: ["stageId"], where: { ...scope, archived: false }, _count: { _all: true } }),
  ]);
  const byStage = new Map(grouped.map((g) => [g.stageId, g._count._all]));
  return {
    stages: stages
      .map((s) => ({ id: s.id, name: s.name, archived: Boolean(s.archivedAt), count: byStage.get(s.id) ?? 0 }))
      .filter((s) => !s.archived || s.count > 0),
    noStage: byStage.get(null) ?? 0,
  };
}
