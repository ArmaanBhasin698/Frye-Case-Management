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

export type ClientListView = "active" | "archived";

/**
 * `view` defaults to "active" (`archived: false`), so the firm-wide
 * Clients roster never surfaces an archived Client unless the caller
 * explicitly asks for the archived view (see
 * app/(dashboard)/clients/page.tsx) — same convention as
 * `lib/matters/queries.ts#listMatters`.
 */
export function listClients(options: { view?: ClientListView } = {}) {
  return prisma.client.findMany({
    where: { archived: (options.view ?? "active") === "archived" },
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

/**
 * Lightweight list for the "link to an existing client" picker on New
 * Matter — always excludes archived Clients unconditionally (no `view`
 * option): there's no scenario where starting a brand-new Matter under an
 * already-archived Client is the intended workflow.
 */
export function listClientsForPicker() {
  return prisma.client.findMany({
    where: { archived: false },
    select: { id: true, firstName: true, lastName: true },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
}
