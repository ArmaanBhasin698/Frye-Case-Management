import type { UserRole } from "@prisma/client";

/**
 * Pure matter-level authorization rules — no I/O, no Prisma, no Next.js
 * imports. Kept this way on purpose so the core rule ("admins see
 * everything, everyone else only sees matters they're assigned to") is
 * unit-testable without a database (see tests/auth/authorization.test.ts).
 *
 * lib/auth/access.ts wraps these with the Prisma queries that fetch a
 * user's assigned matter ids; callers (Server Components) use that layer,
 * not this one, for anything that touches the database.
 */

export type AuthorizableUser = {
  id: string;
  role: UserRole;
};

export function isAdmin(user: AuthorizableUser): boolean {
  return user.role === "ADMIN";
}

/**
 * Can `user` originate a brand-new Client or Matter? Neither docs/SECURITY.md
 * nor docs/DATA_MODEL.md previously specified who may do this — creating a
 * new case record has no existing MatterAssignment to check against, unlike
 * every other write path in the app. Conservative rule, chosen deliberately
 * rather than defaulting to "any logged-in user": only ADMIN and ATTORNEY
 * may create or edit the core fields of a Client or Matter, mirroring how a
 * real firm decides to take on a new client/case. PARALEGAL/STAFF keep full
 * read/write access to sub-resources (Notes, Tasks, Calls, Discovery) on
 * matters they're assigned to — this rule only gates Client/Matter records
 * and MatterAssignment membership themselves. See docs/SECURITY.md.
 */
export function canManageClientsAndMatters(user: AuthorizableUser): boolean {
  return isAdmin(user) || user.role === "ATTORNEY";
}

/**
 * Can `user` access a specific matter, given the ids of matters they're
 * assigned to? Admins bypass the assignment check entirely.
 */
export function canAccessMatter(
  user: AuthorizableUser,
  assignedMatterIds: string[],
  matterId: string,
): boolean {
  if (isAdmin(user)) return true;
  return assignedMatterIds.includes(matterId);
}

/**
 * Prisma `where` fragment restricting a Matter query to `id`s the user may
 * see. Returns `{}` (no restriction) for admins.
 */
export function buildMatterIdFilter(
  user: AuthorizableUser,
  assignedMatterIds: string[],
): { id?: { in: string[] } } {
  if (isAdmin(user)) return {};
  return { id: { in: assignedMatterIds } };
}

/**
 * Prisma `where` fragment restricting a query on a model with a `matterId`
 * column (Task, Deadline, CalendarEvent, DiscoveryProduction, Document,
 * filed Call, ...) to matters the user may see. Returns `{}` for admins.
 */
export function buildMatterScopeFilter(
  user: AuthorizableUser,
  assignedMatterIds: string[],
): { matterId?: { in: string[] } } {
  if (isAdmin(user)) return {};
  return { matterId: { in: assignedMatterIds } };
}
