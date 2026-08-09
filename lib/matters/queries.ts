import { prisma } from "@/lib/db";
import { matterIdFilterFor } from "@/lib/auth/access";
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

export async function listMatters(user: AuthorizableUser) {
  const where = await matterIdFilterFor(user);
  return prisma.matter.findMany({
    where,
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
    where: { active: true },
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
      where: { matterId, user: { active: true } },
      select: { user: { select: { id: true, name: true } } },
    }),
    prisma.user.findMany({
      where: { role: "ADMIN", active: true },
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
 */
export function getUnfiledCalls() {
  return prisma.call.findMany({
    where: { matterId: null },
    orderBy: { occurredAt: "desc" },
  });
}
