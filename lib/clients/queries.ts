import { prisma } from "@/lib/db";

/**
 * Data-access functions for the Clients vertical slice. Every caller here
 * is a page or Server Action already gated by
 * `canManageClientsAndMatters`/`assertCanManageClientsAndMatters` (ADMIN or
 * ATTORNEY only — see lib/auth/authorization.ts), so — like
 * lib/matters/queries.ts's per-matter reads — these don't repeat that check
 * themselves. Clients have no matter-level scoping of their own: unlike a
 * Matter, a Client record isn't tied to a single assignment roster (one
 * client can span several matters with different staff), so there's no
 * narrower "which clients can this ADMIN/ATTORNEY see" filter to apply.
 */

export function listClients() {
  return prisma.client.findMany({
    include: { matters: { select: { id: true, caseNumber: true, status: true } } },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
}

export function getClientById(clientId: string) {
  return prisma.client.findUnique({
    where: { id: clientId },
    include: { matters: { orderBy: { openedDate: "desc" } } },
  });
}

/** Lightweight list for the "link to an existing client" picker on New Matter. */
export function listClientsForPicker() {
  return prisma.client.findMany({
    select: { id: true, firstName: true, lastName: true },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
}
