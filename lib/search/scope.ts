import type { Prisma } from "@prisma/client";

import type { ArchivedFilter, SearchParams, SearchType } from "@/lib/search/params";

/**
 * Pure Prisma `where` builders for global search. Every builder ANDs the
 * caller's authorization scope with the text match and filters, so
 * counting, pagination, and snippets only ever operate on rows the user
 * may see — nothing is fetched and then hidden in JavaScript.
 *
 * The scope is resolved once per request (lib/search/index.ts) from the
 * same helpers each module uses: matter assignments, contact visibility,
 * readable chat conversations, and professional-history filters.
 */

export type SearchScope = {
  isAdmin: boolean;
  /** Same rule as the /clients roster (ADMIN/ATTORNEY). */
  canSeeClients: boolean;
  assignedMatterIds: string[];
  contactVisibility: Prisma.ContactWhereInput;
  readableConversationIds: string[];
  rulingFilter: Prisma.JudicialRulingWhereInput;
  observationFilter: Prisma.ProfessionalObservationWhereInput;
};

export type TypeQuery = {
  /** Full scoped match condition (used for count and the "rest" segment). */
  where: Record<string, unknown>;
  /** Primary-field exact match (case-insensitive), ranked first; null if the type has none. */
  exact: Record<string, unknown> | null;
};

const contains = (q: string) => ({ contains: q, mode: "insensitive" as const });
const equals = (q: string) => ({ equals: q, mode: "insensitive" as const });

function matterIdScope(scope: SearchScope): Prisma.MatterWhereInput {
  return scope.isAdmin ? {} : { id: { in: scope.assignedMatterIds } };
}

function childMatterScope(scope: SearchScope): { matterId?: { in: string[] } } {
  return scope.isAdmin ? {} : { matterId: { in: scope.assignedMatterIds } };
}

function archivedMatter(archived: ArchivedFilter): Prisma.MatterWhereInput {
  if (archived === "all") return {};
  return { archived: archived === "archived" };
}

function dateRange(field: string, params: SearchParams): Record<string, unknown> {
  if (!params.from && !params.to) return {};
  return { [field]: { ...(params.from ? { gte: params.from } : {}), ...(params.to ? { lt: params.to } : {}) } };
}

function and(...parts: Record<string, unknown>[]): Record<string, unknown> {
  return { AND: parts.filter((p) => Object.keys(p).length > 0) };
}

export function buildTypeQuery(type: SearchType, scope: SearchScope, params: SearchParams): TypeQuery | null {
  const { q, matterId, archived } = params;

  switch (type) {
    case "matters": {
      const base = and(
        matterIdScope(scope),
        archivedMatter(archived),
        matterId ? { id: matterId } : {},
        dateRange("openedDate", params),
        {
          OR: [
            { caseNumber: contains(q) },
            { court: contains(q) },
            { charges: contains(q) },
            { client: { firstName: contains(q) } },
            { client: { lastName: contains(q) } },
          ],
        },
      );
      return { where: base, exact: { caseNumber: equals(q) } };
    }
    case "clients": {
      if (!scope.canSeeClients) return null;
      const base = and(
        archived === "all" ? {} : { archived: archived === "archived" },
        matterId ? { matters: { some: { id: matterId } } } : {},
        dateRange("createdAt", params),
        { OR: [{ firstName: contains(q) }, { lastName: contains(q) }, { email: contains(q) }, { phone: contains(q) }] },
      );
      return { where: base, exact: { OR: [{ lastName: equals(q) }, { firstName: equals(q) }] } };
    }
    case "contacts": {
      const base = and(
        scope.contactVisibility as Record<string, unknown>,
        archived === "all" ? {} : { archived: archived === "archived" },
        matterId
          ? {
              OR: [
                { matterLinks: { some: { matterId, removedAt: null } } },
                { client: { matters: { some: { id: matterId } } } },
              ],
            }
          : {},
        dateRange("createdAt", params),
        {
          OR: [
            { displayName: contains(q) },
            { jobTitle: contains(q) },
            { emails: { some: { address: contains(q) } } },
            { phones: { some: { number: { contains: q } } } },
          ],
        },
      );
      return { where: base, exact: { displayName: equals(q) } };
    }
    case "tasks": {
      const base = and(
        childMatterScope(scope),
        { matter: archivedMatter(archived) },
        matterId ? { matterId } : {},
        dateRange("dueDate", params),
        { title: contains(q) },
      );
      return { where: base, exact: { title: equals(q) } };
    }
    case "documents": {
      // Metadata only (title, filename, tags) — never document contents.
      const base = and(
        childMatterScope(scope),
        { matter: archivedMatter(archived) },
        matterId ? { matterId } : {},
        dateRange("uploadedAt", params),
        { OR: [{ title: contains(q) }, { originalFilename: contains(q) }, { tags: { has: q } }] },
      );
      return { where: base, exact: { title: equals(q) } };
    }
    case "time": {
      const base = and(
        childMatterScope(scope),
        { voidedAt: null },
        { matter: archivedMatter(archived) },
        matterId ? { matterId } : {},
        dateRange("workDate", params),
        { description: contains(q) },
      );
      return { where: base, exact: null };
    }
    case "notes": {
      const base = and(
        childMatterScope(scope),
        { matter: archivedMatter(archived) },
        matterId ? { matterId } : {},
        dateRange("createdAt", params),
        { body: contains(q) },
      );
      return { where: base, exact: null };
    }
    case "chat": {
      const base = and(
        { conversationId: { in: scope.readableConversationIds } },
        { deletedAt: null },
        matterId ? { conversation: { matterId } } : {},
        archived === "all"
          ? {}
          : archived === "archived"
            ? { conversation: { matter: { archived: true } } }
            : { OR: [{ conversation: { matterId: null } }, { conversation: { matter: { archived: false } } }] },
        dateRange("createdAt", params),
        { body: contains(q) },
      );
      return { where: base, exact: null };
    }
    case "rulings": {
      const base = and(
        scope.rulingFilter as Record<string, unknown>,
        { supersededAt: null },
        { matter: archivedMatter(archived) },
        matterId ? { matterId } : {},
        dateRange("rulingDate", params),
        {
          OR: [
            { issueDetail: contains(q) },
            { court: contains(q) },
            { context: contains(q) },
            { judge: { displayName: contains(q) } },
          ],
        },
      );
      return { where: base, exact: null };
    }
    case "observations": {
      const base = and(
        scope.observationFilter as Record<string, unknown>,
        { supersededAt: null },
        // The subject contact must itself be visible (firm-wide notes carry no matter).
        { subject: scope.contactVisibility },
        matterId ? { matterId } : {},
        archived === "all"
          ? {}
          : archived === "archived"
            ? { matter: { archived: true } }
            : { OR: [{ matterId: null }, { matter: { archived: false } }] },
        dateRange("createdAt", params),
        { body: contains(q) },
      );
      return { where: base, exact: null };
    }
  }
}
