import type { CallDirection, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { matterScopeFilterFor } from "@/lib/auth/access";
import { canManageClientsAndMatters } from "@/lib/auth/authorization";
import type { AuthorizableUser } from "@/lib/auth/authorization";

/**
 * Firm-wide Communications aggregate query (see CLAUDE.md, section 4.4 and
 * docs/SECURITY.md) — the query behind app/(dashboard)/communications. This
 * is a Calls-first foundation for the eventual Vonage integration: it reads
 * the exact same `Call` rows the per-matter Calls tab already writes
 * (lib/matters/queries.ts#getMatterCalls, lib/matters/actions.ts#createCall/
 * attachCallToMatter), not a second record or entity.
 *
 * Visibility has two parts:
 *  - **Filed calls** (`matterId` set) use `matterScopeFilterFor`
 *    (lib/auth/access.ts), the same helper lib/tasks/queries.ts and
 *    lib/calendar/queries.ts already use: an ADMIN sees every matter's
 *    calls, everyone else only calls on matters they're assigned to.
 *  - **Unfiled calls** (`matterId` null) carry no assignment/ownership of
 *    their own — `Call` has no "logged by" column (see
 *    docs/DATA_MODEL.md's Call entry), only `filedById`/`filedAt`, which
 *    stay null until a call is filed. Rather than invent a new scoping
 *    concept or expose every unfiled call's phone numbers/notes to every
 *    authenticated user firm-wide, this reuses the same conservative
 *    `canManageClientsAndMatters` (ADMIN/ATTORNEY) gate already documented
 *    for "no existing assignment to check against" scenarios (originating
 *    a Client/Matter — see lib/auth/authorization.ts). PARALEGAL/STAFF
 *    users see filed calls on their own assigned matters, but never any
 *    unfiled call, including ones they personally logged — see README.md
 *    for this documented limitation.
 */

export type FirmCallFilters = {
  matterId?: string;
  direction?: CallDirection;
  filedState?: "filed" | "unfiled";
};

export type FirmCallSort = "recent" | "oldest";

/**
 * The `Call` visibility rule documented above, factored out so other
 * firm-wide aggregates (lib/reports/queries.ts) can reuse the exact same
 * authorization decision instead of re-deriving it — see CLAUDE.md,
 * section 4.6 ("don't duplicate authorization logic").
 */
export async function getCallVisibilityFilter(
  user: AuthorizableUser,
): Promise<{ where: Prisma.CallWhereInput; mayViewUnfiled: boolean }> {
  const scopeWhere = await matterScopeFilterFor(user);
  const mayViewUnfiled = canManageClientsAndMatters(user);

  // `scopeWhere` is `{}` (no keys) for an admin's unrestricted scope — Prisma
  // only treats `{}` as "match everything" at the top level of `where`, not
  // when nested as an OR branch, where it instead contributes zero rows (see
  // tests/communications/queries.test.ts for the regression coverage). An
  // admin nested inside `OR: [{ matterId: null }, {}]` would therefore see
  // ONLY unfiled calls — every filed call silently disappears. Skip the OR
  // entirely once the scope is already unrestricted.
  const scopeIsUnrestricted = Object.keys(scopeWhere).length === 0;
  const where: Prisma.CallWhereInput = scopeIsUnrestricted
    ? {}
    : mayViewUnfiled
      ? { OR: [{ matterId: null }, scopeWhere] }
      : scopeWhere;

  return { where, mayViewUnfiled };
}

export async function getFirmWideCalls(
  user: AuthorizableUser,
  filters: FirmCallFilters = {},
  sort: FirmCallSort = "recent",
) {
  const { where: visibility } = await getCallVisibilityFilter(user);

  const conditions: Prisma.CallWhereInput[] = [visibility];
  if (filters.matterId) conditions.push({ matterId: filters.matterId });
  if (filters.direction) conditions.push({ direction: filters.direction });
  if (filters.filedState === "filed") conditions.push({ matterId: { not: null } });
  if (filters.filedState === "unfiled") conditions.push({ matterId: null });

  return prisma.call.findMany({
    where: conditions.length === 1 ? conditions[0] : { AND: conditions },
    include: { matter: { include: { client: true } }, filedBy: true },
    orderBy: { occurredAt: sort === "oldest" ? "asc" : "desc" },
  });
}

export type FirmWideCall = Awaited<ReturnType<typeof getFirmWideCalls>>[number];
