import { notFound } from "next/navigation";

import { prisma } from "@/lib/db";
import {
  buildMatterIdFilter,
  buildMatterScopeFilter,
  canAccessMatter,
  canManageClientsAndMatters,
  isAdmin,
} from "@/lib/auth/authorization";
import type { AuthorizableUser } from "@/lib/auth/authorization";

/** Matter ids `user` is assigned to. Meaningless (and unused) for admins. */
export async function getAssignedMatterIds(userId: string): Promise<string[]> {
  const rows = await prisma.matterAssignment.findMany({
    where: { userId },
    select: { matterId: true },
  });
  return rows.map((row) => row.matterId);
}

/** `where` fragment for a Matter query, scoped to what `user` may see. */
export async function matterIdFilterFor(user: AuthorizableUser) {
  if (isAdmin(user)) return buildMatterIdFilter(user, []);
  const assignedMatterIds = await getAssignedMatterIds(user.id);
  return buildMatterIdFilter(user, assignedMatterIds);
}

/** `where` fragment for a `matterId`-column query, scoped to what `user` may see. */
export async function matterScopeFilterFor(user: AuthorizableUser) {
  if (isAdmin(user)) return buildMatterScopeFilter(user, []);
  const assignedMatterIds = await getAssignedMatterIds(user.id);
  return buildMatterScopeFilter(user, assignedMatterIds);
}

/**
 * Boolean form of the matter-access decision, for call sites that can't
 * use `notFound()` (Server Actions invoked from client code, not a page
 * render — see lib/matters/actions.ts, lib/discovery/actions.ts). Page
 * renders should use `assertMatterAccess` below instead.
 */
export async function hasMatterAccess(user: AuthorizableUser, matterId: string): Promise<boolean> {
  if (isAdmin(user)) return true;
  const assignedMatterIds = await getAssignedMatterIds(user.id);
  return canAccessMatter(user, assignedMatterIds, matterId);
}

/**
 * Enforces matter-level authorization for a single matter (see CLAUDE.md,
 * section 4.4). Renders the standard Next.js not-found page rather than an
 * "access denied" message so an unauthorized user can't distinguish "this
 * matter doesn't exist" from "you can't see this matter."
 */
export async function assertMatterAccess(user: AuthorizableUser, matterId: string): Promise<void> {
  if (!(await hasMatterAccess(user, matterId))) {
    notFound();
  }
}

/**
 * Enforces the Client/Matter creation-and-editing role rule (see
 * lib/auth/authorization.ts#canManageClientsAndMatters) for a page render —
 * a PARALEGAL/STAFF user hitting /clients or /matters/new directly gets the
 * same not-found page as any other unauthorized route, not a distinguishable
 * "forbidden" page.
 */
export function assertCanManageClientsAndMatters(user: AuthorizableUser): void {
  if (!canManageClientsAndMatters(user)) {
    notFound();
  }
}

/**
 * Enforces ADMIN-only access for a page render (user management, MFA
 * reset) — stricter than `assertCanManageClientsAndMatters`, which also
 * allows ATTORNEY. Same not-found-not-forbidden pattern as above.
 */
export function assertIsAdmin(user: AuthorizableUser): void {
  if (!isAdmin(user)) {
    notFound();
  }
}

/**
 * Can `user` edit an *existing* Matter's own case-detail fields (court,
 * charges, case number, status, ...)? Admins always can. An ATTORNEY may,
 * but only for a matter they're actually assigned to (in any capacity,
 * LEAD or ASSOCIATE) — editing a matter they have no other access to
 * would bypass matter-level authorization entirely. PARALEGAL/STAFF never
 * can, regardless of assignment (see
 * lib/auth/authorization.ts#canManageClientsAndMatters).
 *
 * Deliberately does **not** cover the MatterAssignment roster itself —
 * see `canManageMatterTeam` below for that narrower rule.
 */
export async function canEditMatter(user: AuthorizableUser, matterId: string): Promise<boolean> {
  if (isAdmin(user)) return true;
  if (user.role !== "ATTORNEY") return false;
  return hasMatterAccess(user, matterId);
}

/** Page-render form of `canEditMatter` — see `assertMatterAccess` above. */
export async function assertCanEditMatter(user: AuthorizableUser, matterId: string): Promise<void> {
  if (!(await canEditMatter(user, matterId))) {
    notFound();
  }
}

/** Whether `user` is assigned to `matterId` specifically as `LEAD_ATTORNEY` (not merely ASSOCIATE_ATTORNEY, PARALEGAL, or STAFF). */
export async function isLeadAttorneyOfMatter(user: AuthorizableUser, matterId: string): Promise<boolean> {
  const assignment = await prisma.matterAssignment.findUnique({
    where: { matterId_userId: { matterId, userId: user.id } },
    select: { role: true },
  });
  return assignment?.role === "LEAD_ATTORNEY";
}

/**
 * Can `user` add/remove who's on a Matter's team, or change who its lead
 * attorney is? Deliberately narrower than `canEditMatter`: an
 * ASSOCIATE_ATTORNEY can edit case-detail fields (per `canEditMatter`
 * above) but must NOT be able to reshape the team — only the matter's own
 * LEAD_ATTORNEY, or an ADMIN, may. This is what actually enforces "the
 * lead attorney manages who's on their matter" (see
 * lib/matters/actions.ts#addMatterAssignment/removeMatterAssignment) —
 * never a company-wide role change, which stays exclusively under
 * lib/admin/users/actions.ts's ADMIN-only gate.
 */
export async function canManageMatterTeam(user: AuthorizableUser, matterId: string): Promise<boolean> {
  if (isAdmin(user)) return true;
  if (user.role !== "ATTORNEY") return false;
  return isLeadAttorneyOfMatter(user, matterId);
}
