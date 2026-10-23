import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { getAssignedMatterIds, hasMatterAccess } from "@/lib/auth/access";
import { canManageClientsAndMatters, isAdmin, type AuthorizableUser } from "@/lib/auth/authorization";
import { contactVisibilityFilterFor } from "@/lib/contacts/visibility";
import { readableConversationIds } from "@/lib/chat/access";
import { buildObservationFilter, buildRulingFilter } from "@/lib/history/visibility";
import { RULING_ISSUE_LABELS, RULING_RESULT_LABELS, OBSERVATION_KIND_LABELS } from "@/lib/history/labels";
import { timeCategoryLabel } from "@/lib/time/labels";
import { formatHours } from "@/lib/time/math";
import {
  SEARCH_PAGE_SIZE,
  SEARCH_PREVIEW_SIZE,
  SEARCH_TYPES,
  buildSnippet,
  splitPage,
  type SearchParams,
  type SearchType,
} from "@/lib/search/params";
import { buildTypeQuery, type SearchScope } from "@/lib/search/scope";

/**
 * Application-wide search. The authorization scope is resolved from the
 * same helpers each module uses; every count, page, and snippet comes from
 * queries that already include that scope (lib/search/scope.ts). The
 * query text is never logged or audited.
 */

export type SearchResult = {
  id: string;
  title: string;
  subtitle: string | null;
  snippet: string | null;
  href: string;
  date: Date | null;
};

export type TypeResults = { type: SearchType; total: number; page: number; items: SearchResult[] };

export async function resolveSearchScope(user: AuthorizableUser): Promise<SearchScope> {
  const admin = isAdmin(user);
  const assignedMatterIds = admin ? [] : await getAssignedMatterIds(user.id);
  const [contactVisibility, conversationIds] = await Promise.all([
    contactVisibilityFilterFor(user),
    readableConversationIds(user),
  ]);
  return {
    isAdmin: admin,
    canSeeClients: canManageClientsAndMatters(user),
    assignedMatterIds,
    contactVisibility,
    readableConversationIds: conversationIds,
    rulingFilter: buildRulingFilter(user, assignedMatterIds),
    observationFilter: buildObservationFilter(user, assignedMatterIds),
  };
}

type Where = Record<string, unknown>;
type Finder = {
  count: (where: Where) => Promise<number>;
  find: (where: Where, skip: number, take: number, q: string) => Promise<SearchResult[]>;
};

const matterRef = { select: { id: true, caseNumber: true, client: { select: { lastName: true } } } } as const;
const matterLabel = (m: { caseNumber: string; client: { lastName: string } }) => `State v. ${m.client.lastName} (${m.caseNumber})`;

const FINDERS: Record<SearchType, Finder> = {
  matters: {
    count: (where) => prisma.matter.count({ where: where as Prisma.MatterWhereInput }),
    find: async (where, skip, take) =>
      (
        await prisma.matter.findMany({
          where: where as Prisma.MatterWhereInput,
          orderBy: [{ openedDate: "desc" }, { id: "asc" }],
          skip,
          take,
          select: { id: true, caseNumber: true, court: true, charges: true, status: true, archived: true, openedDate: true, client: { select: { lastName: true } } },
        })
      ).map((m) => ({
        id: m.id,
        title: matterLabel(m),
        subtitle: `${m.charges} · ${m.court} · ${m.status.toLowerCase()}${m.archived ? " · archived" : ""}`,
        snippet: null,
        href: `/matters/${m.id}`,
        date: m.openedDate,
      })),
  },
  clients: {
    count: (where) => prisma.client.count({ where: where as Prisma.ClientWhereInput }),
    find: async (where, skip, take) =>
      (
        await prisma.client.findMany({
          where: where as Prisma.ClientWhereInput,
          orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
          skip,
          take,
          select: { id: true, firstName: true, lastName: true, email: true, archived: true, createdAt: true },
        })
      ).map((c) => ({
        id: c.id,
        title: `${c.firstName} ${c.lastName}`,
        subtitle: [c.email, c.archived ? "archived" : null].filter(Boolean).join(" · ") || null,
        snippet: null,
        href: `/clients/${c.id}`,
        date: c.createdAt,
      })),
  },
  contacts: {
    count: (where) => prisma.contact.count({ where: where as Prisma.ContactWhereInput }),
    find: async (where, skip, take) =>
      (
        await prisma.contact.findMany({
          where: where as Prisma.ContactWhereInput,
          orderBy: [{ displayName: "asc" }, { id: "asc" }],
          skip,
          take,
          select: { id: true, displayName: true, jobTitle: true, archived: true, createdAt: true },
        })
      ).map((c) => ({
        id: c.id,
        title: c.displayName,
        subtitle: [c.jobTitle, c.archived ? "archived" : null].filter(Boolean).join(" · ") || null,
        snippet: null,
        href: `/contacts/${c.id}`,
        date: c.createdAt,
      })),
  },
  tasks: {
    count: (where) => prisma.task.count({ where: where as Prisma.TaskWhereInput }),
    find: async (where, skip, take) =>
      (
        await prisma.task.findMany({
          where: where as Prisma.TaskWhereInput,
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          skip,
          take,
          select: { id: true, title: true, status: true, dueDate: true, matterId: true, matter: matterRef },
        })
      ).map((t) => ({
        id: t.id,
        title: t.title,
        subtitle: `${matterLabel(t.matter)} · ${t.status.toLowerCase().replace("_", " ")}`,
        snippet: null,
        href: `/matters/${t.matterId}/tasks`,
        date: t.dueDate,
      })),
  },
  documents: {
    count: (where) => prisma.document.count({ where: where as Prisma.DocumentWhereInput }),
    find: async (where, skip, take) =>
      (
        await prisma.document.findMany({
          where: where as Prisma.DocumentWhereInput,
          orderBy: [{ uploadedAt: "desc" }, { id: "asc" }],
          skip,
          take,
          select: { id: true, title: true, originalFilename: true, tags: true, uploadedAt: true, matterId: true, matter: matterRef },
        })
      ).map((d) => ({
        id: d.id,
        title: d.title,
        subtitle: [matterLabel(d.matter), d.originalFilename, d.tags.length ? `tags: ${d.tags.join(", ")}` : null].filter(Boolean).join(" · "),
        snippet: null,
        href: `/matters/${d.matterId}/documents`,
        date: d.uploadedAt,
      })),
  },
  time: {
    count: (where) => prisma.timeEntry.count({ where: where as Prisma.TimeEntryWhereInput }),
    find: async (where, skip, take, q) =>
      (
        await prisma.timeEntry.findMany({
          where: where as Prisma.TimeEntryWhereInput,
          orderBy: [{ workDate: "desc" }, { id: "asc" }],
          skip,
          take,
          select: { id: true, description: true, durationMinutes: true, category: true, workDate: true, matterId: true, matter: matterRef, user: { select: { name: true } } },
        })
      ).map((e) => ({
        id: e.id,
        title: `${formatHours(e.durationMinutes)} h · ${timeCategoryLabel(e.category)}`,
        subtitle: `${matterLabel(e.matter)} · ${e.user.name}`,
        snippet: buildSnippet(e.description, q),
        href: `/matters/${e.matterId}/time`,
        date: e.workDate,
      })),
  },
  notes: {
    count: (where) => prisma.note.count({ where: where as Prisma.NoteWhereInput }),
    find: async (where, skip, take, q) =>
      (
        await prisma.note.findMany({
          where: where as Prisma.NoteWhereInput,
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          skip,
          take,
          select: { id: true, body: true, createdAt: true, matterId: true, matter: matterRef, author: { select: { name: true } } },
        })
      ).map((n) => ({
        id: n.id,
        title: `Note on ${matterLabel(n.matter)}`,
        subtitle: n.author.name,
        snippet: buildSnippet(n.body, q),
        href: `/matters/${n.matterId}/notes`,
        date: n.createdAt,
      })),
  },
  chat: {
    count: (where) => prisma.chatMessage.count({ where: where as Prisma.ChatMessageWhereInput }),
    find: async (where, skip, take, q) =>
      (
        await prisma.chatMessage.findMany({
          where: where as Prisma.ChatMessageWhereInput,
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          skip,
          take,
          select: {
            id: true,
            body: true,
            createdAt: true,
            conversationId: true,
            author: { select: { name: true } },
            conversation: { select: { type: true, name: true } },
          },
        })
      ).map((m) => ({
        id: m.id,
        title: m.conversation.type === "CHANNEL" ? `#${m.conversation.name ?? "channel"}` : m.conversation.type === "DIRECT" ? "Direct message" : "Group message",
        subtitle: m.author?.name ?? "Former staff",
        snippet: buildSnippet(m.body, q),
        href: `/chat/${m.conversationId}`,
        date: m.createdAt,
      })),
  },
  rulings: {
    count: (where) => prisma.judicialRuling.count({ where: where as Prisma.JudicialRulingWhereInput }),
    find: async (where, skip, take, q) =>
      (
        await prisma.judicialRuling.findMany({
          where: where as Prisma.JudicialRulingWhereInput,
          orderBy: [{ rulingDate: "desc" }, { id: "asc" }],
          skip,
          take,
          select: { id: true, issueType: true, result: true, issueDetail: true, context: true, court: true, rulingDate: true, matterId: true, matter: matterRef, judge: { select: { displayName: true } } },
        })
      ).map((r) => ({
        id: r.id,
        title: `${RULING_ISSUE_LABELS[r.issueType]} — ${RULING_RESULT_LABELS[r.result]}`,
        subtitle: `${matterLabel(r.matter)} · Judge ${r.judge.displayName} · ${r.court}`,
        snippet: buildSnippet(r.issueDetail ?? r.context, q),
        href: `/matters/${r.matterId}/outcome`,
        date: r.rulingDate,
      })),
  },
  observations: {
    count: (where) => prisma.professionalObservation.count({ where: where as Prisma.ProfessionalObservationWhereInput }),
    find: async (where, skip, take, q) =>
      (
        await prisma.professionalObservation.findMany({
          where: where as Prisma.ProfessionalObservationWhereInput,
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          skip,
          take,
          select: { id: true, body: true, kind: true, createdAt: true, matterId: true, subject: { select: { id: true, displayName: true } } },
        })
      ).map((o) => ({
        id: o.id,
        title: `${OBSERVATION_KIND_LABELS[o.kind]} about ${o.subject.displayName}`,
        subtitle: o.matterId ? "Matter-restricted" : "Firm-wide reference note",
        snippet: buildSnippet(o.body, q),
        href: o.matterId ? `/matters/${o.matterId}/outcome` : `/contacts/${o.subject.id}`,
        date: o.createdAt,
      })),
  },
};

async function runType(type: SearchType, scope: SearchScope, params: SearchParams, pageSize: number, page: number): Promise<TypeResults | null> {
  const tq = buildTypeQuery(type, scope, params);
  if (!tq) return null;
  const finder = FINDERS[type];
  const total = await finder.count(tq.where);
  if (total === 0) return { type, total, page, items: [] };

  if (!tq.exact) {
    const items = await finder.find(tq.where, (page - 1) * pageSize, pageSize, params.q);
    return { type, total, page, items };
  }
  const exactWhere = { AND: [tq.where, tq.exact] };
  const restWhere = { AND: [tq.where, { NOT: tq.exact }] };
  const exactCount = await finder.count(exactWhere);
  const split = splitPage(page, pageSize, exactCount);
  const [exact, rest] = await Promise.all([
    split.exact.take > 0 ? finder.find(exactWhere, split.exact.skip, split.exact.take, params.q) : Promise.resolve([]),
    split.rest.take > 0 ? finder.find(restWhere, split.rest.skip, split.rest.take, params.q) : Promise.resolve([]),
  ]);
  return { type, total, page, items: [...exact, ...rest] };
}

/**
 * For CSV export: up to `cap` results per type (the selected type, or every
 * type), under exactly the same scope as the results page.
 */
export async function collectSearchResults(user: AuthorizableUser, params: SearchParams, cap: number): Promise<TypeResults[]> {
  if (params.matterId && !(await hasMatterAccess(user, params.matterId))) return [];
  const scope = await resolveSearchScope(user);
  const types = params.type ? [params.type] : [...SEARCH_TYPES];
  const results = await Promise.all(types.map((t) => runType(t, scope, params, cap, 1)));
  return results.filter((r): r is TypeResults => r !== null);
}

export type SearchOutcome = { results: TypeResults[]; matterFilterDenied: boolean };

/**
 * One type (paginated) when `params.type` is set, otherwise a preview of
 * every type the user can search. A matter filter the user can't access
 * yields no results at all — it never widens or reveals anything.
 */
export async function runGlobalSearch(user: AuthorizableUser, params: SearchParams): Promise<SearchOutcome> {
  if (params.matterId && !(await hasMatterAccess(user, params.matterId))) {
    return { results: [], matterFilterDenied: true };
  }
  const scope = await resolveSearchScope(user);
  const types = params.type ? [params.type] : [...SEARCH_TYPES];
  const pageSize = params.type ? SEARCH_PAGE_SIZE : SEARCH_PREVIEW_SIZE;
  const page = params.type ? params.page : 1;
  const results = await Promise.all(types.map((t) => runType(t, scope, params, pageSize, page)));
  return { results: results.filter((r): r is TypeResults => r !== null), matterFilterDenied: false };
}
