import type { DiscoveryFileType, DiscoveryReviewStatus, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { matterScopeFilterFor } from "@/lib/auth/access";
import type { AuthorizableUser } from "@/lib/auth/authorization";

/**
 * Firm-wide Discovery aggregate query (see CLAUDE.md, section 4.4 and
 * docs/SECURITY.md) — the query behind app/(dashboard)/discovery. Reads the
 * exact same `DiscoveryFile` rows the per-matter Discovery tab already
 * writes (lib/discovery/actions.ts#registerDiscoveryFile,
 * lib/matters/queries.ts#getMatterDiscoveryProductions), not a second
 * record or entity — this is a read-only cross-matter index over them.
 *
 * `DiscoveryFile` has no `matterId` column of its own (unlike `Task`,
 * `Deadline`, `CalendarEvent`, filed `Call`, and `DiscoveryProduction`) —
 * it only reaches a matter through its parent `DiscoveryProduction`. So
 * unlike lib/tasks/queries.ts and lib/calendar/queries.ts, the scope from
 * `matterScopeFilterFor` (lib/auth/access.ts) can't be applied directly to
 * this model's `where` — it has to be nested under a `production` relation
 * filter instead. An ADMIN's unrestricted scope (`{}`) is left at the top
 * level rather than nested as `{ production: {} }`, mirroring the same
 * "don't nest an empty object where it might mean something different"
 * caution lib/communications/queries.ts documents for `OR` branches — see
 * tests/discovery/queries.test.ts for the regression coverage proving an
 * ADMIN still sees every file this way.
 */

export type FirmDiscoveryFilters = {
  matterId?: string;
  fileType?: DiscoveryFileType;
  reviewStatus?: DiscoveryReviewStatus;
};

export type FirmDiscoverySort = "recent" | "oldest";

export async function getFirmWideDiscoveryFiles(
  user: AuthorizableUser,
  filters: FirmDiscoveryFilters = {},
  sort: FirmDiscoverySort = "recent",
) {
  const scopeWhere = await matterScopeFilterFor(user);
  const scopeIsUnrestricted = Object.keys(scopeWhere).length === 0;

  const conditions: Prisma.DiscoveryFileWhereInput[] = [];
  if (!scopeIsUnrestricted) conditions.push({ production: scopeWhere });
  if (filters.matterId) conditions.push({ production: { matterId: filters.matterId } });
  if (filters.reviewStatus) conditions.push({ production: { reviewStatus: filters.reviewStatus } });
  if (filters.fileType) conditions.push({ fileType: filters.fileType });

  return prisma.discoveryFile.findMany({
    where: conditions.length === 0 ? {} : conditions.length === 1 ? conditions[0] : { AND: conditions },
    include: {
      registeredBy: true,
      production: { include: { matter: { include: { client: true } } } },
    },
    orderBy: { createdAt: sort === "oldest" ? "asc" : "desc" },
  });
}

export type FirmWideDiscoveryFile = Awaited<ReturnType<typeof getFirmWideDiscoveryFiles>>[number];
