import type { ContactCategory, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { hasMatterAccess, matterIdFilterFor, matterScopeFilterFor } from "@/lib/auth/access";
import { canManageClientsAndMatters, isAdmin, type AuthorizableUser } from "@/lib/auth/authorization";
import { contactVisibilityFilterFor } from "@/lib/contacts/visibility";
import { buildAssociatedMatters, buildTimeline, deriveClientStatus } from "@/lib/contacts/history";

/**
 * Contact reads. Every query ANDs `contactVisibilityFilterFor(user)`, and
 * every matter-derived section (associated matters, client status,
 * relationships, interactions, calls) is additionally restricted to the
 * viewer's accessible matters *before* anything is counted or shown —
 * hidden rows are never counted or hinted at (see
 * docs/FIRM_OPERATIONS_EXPANSION.md, section 4).
 */

export const CONTACTS_PAGE_SIZE = 25;

export type ContactListFilters = {
  q?: string;
  category?: ContactCategory;
  organizationId?: string;
  matterId?: string;
  clientStatus?: "current" | "former";
  view?: "active" | "archived";
  sort?: "name" | "recent";
  page?: number;
};

const matterSummarySelect = {
  id: true,
  caseNumber: true,
  status: true,
  archived: true,
  openedDate: true,
  closedDate: true,
  client: { select: { firstName: true, lastName: true } },
  assignments: { select: { role: true, user: { select: { name: true } } } },
} satisfies Prisma.MatterSelect;

export async function listContacts(user: AuthorizableUser, filters: ContactListFilters = {}) {
  const visibility = await contactVisibilityFilterFor(user);
  const matterWhere = await matterIdFilterFor(user);
  const conditions: Prisma.ContactWhereInput[] = [visibility, { archived: filters.view === "archived" }];

  const q = filters.q?.trim();
  if (q) {
    conditions.push({
      OR: [
        { displayName: { contains: q, mode: "insensitive" } },
        { jobTitle: { contains: q, mode: "insensitive" } },
        { organization: { displayName: { contains: q, mode: "insensitive" } } },
        { emails: { some: { address: { contains: q, mode: "insensitive" } } } },
        { phones: { some: { number: { contains: q } } } },
      ],
    });
  }
  if (filters.category) conditions.push({ categories: { has: filters.category } });
  if (filters.organizationId) conditions.push({ organizationId: filters.organizationId });

  if (filters.matterId) {
    // Filtering by a matter the viewer can't access would reveal which of
    // their visible contacts are involved in it — answer with nothing.
    if (!(await hasMatterAccess(user, filters.matterId))) {
      return { rows: [], total: 0, page: 1, pageSize: CONTACTS_PAGE_SIZE };
    }
    conditions.push({
      OR: [
        { matterLinks: { some: { matterId: filters.matterId, removedAt: null } } },
        { client: { matters: { some: { id: filters.matterId } } } },
      ],
    });
  }

  // Client status is computed over *visible* matters only (see deriveClientStatus).
  if (filters.clientStatus === "current") {
    conditions.push({ client: { matters: { some: { AND: [matterWhere, { status: { in: ["OPEN", "PENDING"] } }] } } } });
  } else if (filters.clientStatus === "former") {
    conditions.push({
      client: {
        matters: {
          some: matterWhere,
          none: { AND: [matterWhere, { status: { in: ["OPEN", "PENDING"] } }] },
        },
      },
    });
  }

  const where: Prisma.ContactWhereInput = { AND: conditions };
  const page = Math.max(1, filters.page ?? 1);
  const orderBy: Prisma.ContactOrderByWithRelationInput[] =
    filters.sort === "recent"
      ? [{ lastContactedAt: { sort: "desc", nulls: "last" } }, { displayName: "asc" }]
      : [{ displayName: "asc" }];

  const [total, contacts] = await Promise.all([
    prisma.contact.count({ where }),
    prisma.contact.findMany({
      where,
      orderBy,
      skip: (page - 1) * CONTACTS_PAGE_SIZE,
      take: CONTACTS_PAGE_SIZE,
      select: {
        id: true,
        kind: true,
        displayName: true,
        jobTitle: true,
        categories: true,
        lastContactedAt: true,
        archived: true,
        clientId: true,
        organization: { select: { id: true, displayName: true } },
        phones: { where: { isPrimary: true }, select: { number: true }, take: 1 },
        emails: { where: { isPrimary: true }, select: { address: true }, take: 1 },
        client: { select: { matters: { where: matterWhere, select: { status: true } } } },
      },
    }),
  ]);

  const rows = contacts.map(({ client, ...contact }) => ({
    ...contact,
    clientStatus: contact.clientId && client ? deriveClientStatus(client.matters) : null,
  }));

  return { rows, total, page, pageSize: CONTACTS_PAGE_SIZE };
}

/** Calls the viewer may see: filed calls on their matters, plus unfiled calls for ADMIN/ATTORNEY (same rule as lib/communications/queries.ts). */
async function callScopeFor(user: AuthorizableUser): Promise<Prisma.CallWhereInput> {
  if (isAdmin(user)) return {};
  const scope = await matterScopeFilterFor(user);
  return canManageClientsAndMatters(user) ? { OR: [scope, { matterId: null }] } : scope;
}

export async function getContactDetail(user: AuthorizableUser, contactId: string) {
  const visibility = await contactVisibilityFilterFor(user);
  const matterWhere = await matterIdFilterFor(user);
  const matterScope = await matterScopeFilterFor(user);

  const contact = await prisma.contact.findFirst({
    where: { AND: [{ id: contactId }, visibility] },
    include: {
      phones: { orderBy: [{ isPrimary: "desc" }, { number: "asc" }] },
      emails: { orderBy: [{ isPrimary: "desc" }, { address: "asc" }] },
      organization: { select: { id: true, displayName: true } },
      members: {
        where: { AND: [visibility, { archived: false }] },
        select: { id: true, displayName: true, jobTitle: true },
        orderBy: { displayName: "asc" },
      },
      assignedStaff: { select: { id: true, name: true } },
      createdBy: { select: { name: true } },
      client: {
        select: {
          id: true,
          email: true,
          phone: true,
          address: true,
          matters: { where: matterWhere, select: matterSummarySelect },
        },
      },
      matterLinks: {
        where: { removedAt: null, matter: matterWhere },
        select: { role: true, roleDetail: true, startDate: true, endDate: true, matter: { select: matterSummarySelect } },
      },
    },
  });
  if (!contact) return null;

  const relationshipMatterCondition: Prisma.ContactRelationshipWhereInput = isAdmin(user)
    ? {}
    : { OR: [{ matterId: null }, matterScope] };

  const [relationships, interactions, calls] = await Promise.all([
    prisma.contactRelationship.findMany({
      where: {
        AND: [
          {
            OR: [
              { fromContactId: contactId, toContact: visibility },
              { toContactId: contactId, fromContact: visibility },
            ],
          },
          relationshipMatterCondition,
        ],
      },
      include: {
        fromContact: { select: { id: true, displayName: true } },
        toContact: { select: { id: true, displayName: true } },
        matter: { select: { id: true, caseNumber: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.contactInteraction.findMany({
      where: { AND: [{ contactId }, isAdmin(user) ? {} : { OR: [{ matterId: null }, matterScope] }] },
      include: { staff: { select: { name: true } }, matter: { select: { id: true, caseNumber: true } } },
      orderBy: { occurredAt: "desc" },
      take: 200,
    }),
    prisma.call.findMany({
      where: { AND: [{ contactId }, await callScopeFor(user)] },
      select: {
        id: true,
        direction: true,
        occurredAt: true,
        durationSeconds: true,
        notes: true,
        filedBy: { select: { name: true } },
        matter: { select: { id: true, caseNumber: true } },
      },
      orderBy: { occurredAt: "desc" },
      take: 200,
    }),
  ]);

  const timeline = buildTimeline({ interactions, calls });
  const lastInteractionByMatter = new Map<string, Date>();
  for (const entry of timeline) {
    if (entry.matter && !lastInteractionByMatter.has(entry.matter.id)) {
      lastInteractionByMatter.set(entry.matter.id, entry.occurredAt);
    }
  }

  const clientMatters = contact.client?.matters ?? [];
  return {
    contact,
    clientStatus: contact.clientId ? deriveClientStatus(clientMatters) : null,
    associatedMatters: buildAssociatedMatters({
      links: contact.matterLinks,
      clientMatters,
      lastInteractionByMatter,
    }),
    relationships,
    timeline,
  };
}

export async function getContactForEdit(user: AuthorizableUser, contactId: string) {
  const visibility = await contactVisibilityFilterFor(user);
  return prisma.contact.findFirst({
    where: { AND: [{ id: contactId }, visibility] },
    include: {
      phones: { orderBy: [{ isPrimary: "desc" }, { number: "asc" }] },
      emails: { orderBy: [{ isPrimary: "desc" }, { address: "asc" }] },
    },
  });
}

/** Contacts on one matter. Callers must already have asserted matter access. */
export async function listMatterContacts(matterId: string) {
  const [links, matter] = await Promise.all([
    prisma.matterContact.findMany({
      where: { matterId, removedAt: null },
      include: {
        contact: {
          select: {
            id: true,
            displayName: true,
            jobTitle: true,
            organization: { select: { displayName: true } },
            phones: { where: { isPrimary: true }, select: { number: true }, take: 1 },
            emails: { where: { isPrimary: true }, select: { address: true }, take: 1 },
          },
        },
      },
      orderBy: [{ role: "asc" }, { contact: { displayName: "asc" } }],
    }),
    prisma.matter.findUnique({
      where: { id: matterId },
      select: { client: { select: { id: true, firstName: true, lastName: true, contact: { select: { id: true } } } } },
    }),
  ]);
  return { links, client: matter?.client ?? null };
}

/** Non-archived visible contacts, for pickers (relationship target, add-to-matter). */
export async function listContactOptions(user: AuthorizableUser, options: { organizationsOnly?: boolean } = {}) {
  const visibility = await contactVisibilityFilterFor(user);
  return prisma.contact.findMany({
    where: {
      AND: [visibility, { archived: false }, options.organizationsOnly ? { kind: "ORGANIZATION" } : {}],
    },
    select: { id: true, displayName: true, kind: true },
    orderBy: { displayName: "asc" },
    take: 1_000,
  });
}

/** Matters the viewer can access, for matter pickers on contact forms. */
export async function listAccessibleMatterOptions(user: AuthorizableUser) {
  const where = await matterIdFilterFor(user);
  return prisma.matter.findMany({
    where: { ...where, archived: false },
    select: { id: true, caseNumber: true, client: { select: { firstName: true, lastName: true } } },
    orderBy: { openedDate: "desc" },
  });
}

/** Contacts actively linked to a matter (including its client), for the Log a Call contact picker. */
export async function listMatterContactOptions(matterId: string) {
  const { links, client } = await listMatterContacts(matterId);
  const options = links.map((l) => ({ id: l.contact.id, displayName: l.contact.displayName }));
  if (client?.contact) options.unshift({ id: client.contact.id, displayName: `${client.firstName} ${client.lastName}` });
  return [...new Map(options.map((o) => [o.id, o])).values()];
}

/** Whether a contact is actively on a matter — linked via MatterContact, or as that matter's client. */
export async function isContactOnMatter(contactId: string, matterId: string): Promise<boolean> {
  const count = await prisma.contact.count({
    where: {
      id: contactId,
      OR: [
        { matterLinks: { some: { matterId, removedAt: null } } },
        { client: { matters: { some: { id: matterId } } } },
      ],
    },
  });
  return count > 0;
}
