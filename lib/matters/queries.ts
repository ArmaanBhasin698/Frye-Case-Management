import { prisma } from "@/lib/db";
import { matterIdFilterFor } from "@/lib/auth/access";
import { canManageClientsAndMatters } from "@/lib/auth/authorization";
import type { AuthorizableUser } from "@/lib/auth/authorization";

/**
 * Data-access functions for the Matters vertical slice.
 *
 * `listMatters` is the only function here that needs to be told *who's
 * asking* — it returns a cross-matter list, so it must be scoped to what
 * `user` may see (see CLAUDE.md, section 4.4). Every other function below
 * takes a specific `matterId` whose access has already been checked by the
 * caller (app/(dashboard)/matters/[matterId]/layout.tsx runs
 * `assertMatterAccess` before any of these run), so they don't repeat that
 * check themselves.
 */

export type MatterListView = "active" | "archived";

/**
 * `view` defaults to "active" (`archived: false`) — every existing
 * call site (the Matters page itself, and every firm-wide filter bar's
 * matter picker: Tasks/Calendar/Discovery/Communications/Reports) keeps
 * its current behavior unchanged and never surfaces an archived Matter.
 * Pass `{ view: "archived" }` only for the explicit archived-records view
 * (see app/(dashboard)/matters/page.tsx). This is a plain visibility
 * filter, layered on top of `matterIdFilterFor`'s existing authorization
 * scoping, never a substitute for it — an archived Matter the caller isn't
 * otherwise authorized to see still never appears in either view.
 */
export async function listMatters(user: AuthorizableUser, options: { view?: MatterListView } = {}) {
  const where = await matterIdFilterFor(user);
  return prisma.matter.findMany({
    where: { ...where, archived: (options.view ?? "active") === "archived" },
    include: {
      client: true,
      assignments: { include: { user: true } },
    },
    orderBy: { openedDate: "desc" },
  });
}

export function getMatterHeader(matterId: string) {
  return prisma.matter.findUnique({
    where: { id: matterId },
    include: {
      client: true,
      assignments: { include: { user: true } },
      archivedBy: true,
    },
  });
}

/** Same shape as `getMatterHeader` — kept as its own named query for the Edit Matter page's clarity. */
export function getMatterForEdit(matterId: string) {
  return getMatterHeader(matterId);
}

/** Active staff, for the assignment picker on New/Edit Matter. */
export function listAssignableUsers() {
  return prisma.user.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  });
}

/**
 * Candidate Task assignees for a matter: staff genuinely assigned to it,
 * plus every active ADMIN (who can see every matter regardless of
 * assignment — see lib/auth/authorization.ts#isAdmin). Mirrors exactly
 * the server-side rule `lib/matters/actions.ts#updateTask` enforces for a
 * submitted `assignedToId`, so the picker never offers a choice the
 * action would reject.
 */
export async function getMatterAssignableUsers(matterId: string) {
  const [assignments, admins] = await Promise.all([
    prisma.matterAssignment.findMany({
      where: { matterId, user: { status: "ACTIVE" } },
      select: { user: { select: { id: true, name: true } } },
    }),
    prisma.user.findMany({
      where: { role: "ADMIN", status: "ACTIVE" },
      select: { id: true, name: true },
    }),
  ]);

  const byId = new Map<string, { id: string; name: string }>();
  for (const { user } of assignments) byId.set(user.id, user);
  for (const admin of admins) byId.set(admin.id, admin);

  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function getMatterNotes(matterId: string) {
  return prisma.note.findMany({
    where: { matterId },
    include: { author: true },
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
  });
}

export function getMatterTasks(matterId: string) {
  return prisma.task.findMany({
    where: { matterId },
    include: { assignedTo: true },
    orderBy: [{ status: "asc" }, { dueDate: "asc" }],
  });
}

export function getMatterDeadlines(matterId: string) {
  return prisma.deadline.findMany({
    where: { matterId },
    orderBy: { date: "asc" },
  });
}

export function getMatterCalendarEvents(matterId: string) {
  return prisma.calendarEvent.findMany({
    where: { matterId },
    orderBy: { startTime: "asc" },
  });
}

export function getMatterDiscoveryProductions(matterId: string) {
  return prisma.discoveryProduction.findMany({
    where: { matterId },
    include: {
      files: { include: { registeredBy: true }, orderBy: { createdAt: "asc" } },
    },
    orderBy: { receivedDate: "desc" },
  });
}

export function getMatterDiscoveryComparisons(matterId: string) {
  return prisma.discoveryComparison.findMany({
    where: { matterId },
    include: {
      fromProduction: true,
      toProduction: true,
      runBy: true,
      matches: { orderBy: { status: "asc" } },
    },
    orderBy: { runAt: "desc" },
  });
}

export function getMatterDocuments(matterId: string) {
  return prisma.document.findMany({
    where: { matterId },
    include: { uploadedBy: true },
    orderBy: { uploadedAt: "desc" },
  });
}

export function getMatterCalls(matterId: string) {
  return prisma.call.findMany({
    where: { matterId },
    include: { filedBy: true },
    orderBy: { occurredAt: "desc" },
  });
}

export function getMatterAuditEvents(matterId: string) {
  return prisma.auditEvent.findMany({
    where: { matterId },
    include: { actor: true },
    orderBy: { occurredAt: "desc" },
  });
}

/**
 * Calls received but not yet attached to any matter — the pool a staff
 * member picks from when filing a call. Global (not matter-scoped) by
 * definition; the Calls tab uses this to power the mocked "Attach to
 * Matter" workflow (see components/shared/attach-call-list.tsx).
 *
 * Unfiled calls carry no matter assignment to check, so this needs its own
 * gate rather than the matterId-already-checked-by-the-caller convention
 * every other function here relies on: only ADMIN/ATTORNEY may see them,
 * the same rule lib/communications/queries.ts#getCallVisibilityFilter
 * enforces for the firm-wide Communications page and
 * lib/matters/actions.ts#attachCallToMatter enforces for filing one.
 * PARALEGAL/STAFF get an empty list, not an error.
 */
export function getUnfiledCalls(user: AuthorizableUser) {
  if (!canManageClientsAndMatters(user)) return Promise.resolve([]);
  return prisma.call.findMany({
    where: { matterId: null },
    orderBy: { occurredAt: "desc" },
  });
}
