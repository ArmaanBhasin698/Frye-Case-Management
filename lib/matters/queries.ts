import { prisma } from "@/lib/db";

/**
 * Data-access functions for the Matters vertical slice.
 *
 * These are plain reads with no access control yet — authentication and
 * matter-level authorization are not implemented in this milestone (see
 * docs/ROADMAP.md, Phase 1/2). Every one of these will need an
 * authorization check added before this application handles real case
 * data (see CLAUDE.md, section 4.4 and docs/SECURITY.md).
 */

export function listMatters() {
  return prisma.matter.findMany({
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

export function getMatterDiscoveryProductions(matterId: string) {
  return prisma.discoveryProduction.findMany({
    where: { matterId },
    include: { files: true },
    orderBy: { receivedDate: "desc" },
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
