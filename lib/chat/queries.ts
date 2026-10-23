import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { getAssignedMatterIds } from "@/lib/auth/access";
import { isAdmin, type AuthorizableUser } from "@/lib/auth/authorization";
import { getReadableConversation, readableConversationIds } from "@/lib/chat/access";
import { unreadSince } from "@/lib/chat/rules";

/**
 * Team-chat reads. Each one starts from `readableConversationIds` or
 * `getReadableConversation` (lib/chat/access.ts), so the sidebar, history,
 * search, and unread counts can never reach a conversation the user isn't
 * an active member of, or a matter channel whose matter they can no longer
 * access.
 */

export type MessageView = {
  id: string;
  conversationId: string;
  /** Set on thread replies; top-level messages have null. */
  parentId: string | null;
  /** Top-level messages only: live (non-deleted) replies, and those unread by the viewer. */
  replyCount: number;
  unreadReplies: number;
  body: string | null;
  deleted: boolean;
  edited: boolean;
  authorId: string | null;
  authorName: string;
  createdAt: string;
  isOwn: boolean;
  matterRef: { id: string; caseNumber: string } | "restricted" | null;
  documentRef: { id: string; title: string; matterId: string } | "restricted" | null;
};

const messageSelect = {
  id: true,
  conversationId: true,
  parentId: true,
  body: true,
  authorId: true,
  author: { select: { name: true } },
  createdAt: true,
  editedAt: true,
  deletedAt: true,
  matterRef: { select: { id: true, caseNumber: true } },
  documentRef: { select: { id: true, title: true, matterId: true } },
} satisfies Prisma.ChatMessageSelect;

type MessageRow = Prisma.ChatMessageGetPayload<{ select: typeof messageSelect }>;

/** `null` = admin (every matter); otherwise the set of accessible matter ids. */
async function accessibleMatterSet(user: AuthorizableUser): Promise<Set<string> | null> {
  return isAdmin(user) ? null : new Set(await getAssignedMatterIds(user.id));
}

/**
 * Shapes a row for the client. Deleted bodies are dropped here, and
 * matter/document references are re-authorized for *this viewer* — a
 * reference posted by someone else never discloses a matter or document
 * the viewer can't access.
 */
export function toMessageView(
  row: MessageRow,
  viewerId: string,
  matters: Set<string> | null,
  replies: { count: number; unread: number } = { count: 0, unread: 0 },
): MessageView {
  const canSee = (matterId: string) => matters === null || matters.has(matterId);
  return {
    id: row.id,
    conversationId: row.conversationId,
    parentId: row.parentId,
    replyCount: replies.count,
    unreadReplies: replies.unread,
    body: row.deletedAt ? null : row.body,
    deleted: Boolean(row.deletedAt),
    edited: Boolean(row.editedAt),
    authorId: row.authorId,
    authorName: row.author?.name ?? "Former staff member",
    createdAt: row.createdAt.toISOString(),
    isOwn: row.authorId === viewerId,
    matterRef: row.deletedAt || !row.matterRef ? null : canSee(row.matterRef.id) ? row.matterRef : "restricted",
    documentRef:
      row.deletedAt || !row.documentRef ? null : canSee(row.documentRef.matterId) ? row.documentRef : "restricted",
  };
}

export const MESSAGE_PAGE_SIZE = 50;
export const THREAD_PAGE_SIZE = 50;

/**
 * Live reply counts per parent, plus how many of those replies are unread
 * by the viewer (written by others after the viewer's last read). Deleted
 * replies never count.
 */
async function replyStats(
  parentIds: string[],
  viewerId: string,
  readSince: Date,
): Promise<Map<string, { count: number; unread: number }>> {
  const stats = new Map<string, { count: number; unread: number }>();
  if (parentIds.length === 0) return stats;
  const [all, unread] = await Promise.all([
    prisma.chatMessage.groupBy({
      by: ["parentId"],
      where: { parentId: { in: parentIds }, deletedAt: null },
      _count: { _all: true },
    }),
    prisma.chatMessage.groupBy({
      by: ["parentId"],
      where: { parentId: { in: parentIds }, deletedAt: null, authorId: { not: viewerId }, createdAt: { gt: readSince } },
      _count: { _all: true },
    }),
  ]);
  for (const row of all) if (row.parentId) stats.set(row.parentId, { count: row._count._all, unread: 0 });
  for (const row of unread) {
    if (!row.parentId) continue;
    const entry = stats.get(row.parentId) ?? { count: 0, unread: 0 };
    entry.unread = row._count._all;
    stats.set(row.parentId, entry);
  }
  return stats;
}

/**
 * Newest `MESSAGE_PAGE_SIZE` top-level messages (or those before
 * `before`), oldest first, each with its reply counts. Thread replies are
 * deliberately kept out of the main timeline — they're read through
 * `getThreadMessages`. Returns null when the conversation isn't readable.
 */
export async function getConversationMessages(
  user: AuthorizableUser,
  conversationId: string,
  options: { before?: Date } = {},
): Promise<{ messages: MessageView[]; hasOlder: boolean } | null> {
  const conversation = await getReadableConversation(user, conversationId);
  if (!conversation) return null;

  const rows = await prisma.chatMessage.findMany({
    where: { conversationId, parentId: null, ...(options.before ? { createdAt: { lt: options.before } } : {}) },
    select: messageSelect,
    orderBy: { createdAt: "desc" },
    take: MESSAGE_PAGE_SIZE + 1,
  });
  const matters = await accessibleMatterSet(user);
  const page = rows.slice(0, MESSAGE_PAGE_SIZE).reverse();
  const stats = await replyStats(
    page.map((r) => r.id),
    user.id,
    unreadSince(conversation.membership),
  );
  return {
    messages: page.map((r) => toMessageView(r, user.id, matters, stats.get(r.id))),
    hasOlder: rows.length > MESSAGE_PAGE_SIZE,
  };
}

/**
 * One thread: its parent (always shown for context — "message deleted" if
 * it was soft-deleted) and its replies oldest first, paged forward with an
 * `(createdAt, id)` cursor so equal timestamps are never skipped. Runs the
 * same full conversation access check (membership + current matter access)
 * as the main timeline, and the parent must be a top-level message of
 * *this* conversation — a forged or cross-conversation parent id returns
 * null exactly like an unreadable conversation.
 */
export async function getThreadMessages(
  user: AuthorizableUser,
  conversationId: string,
  parentId: string,
  options: { after?: { createdAt: Date; id: string } } = {},
): Promise<{ parent: MessageView; replies: MessageView[]; hasMore: boolean } | null> {
  const conversation = await getReadableConversation(user, conversationId);
  if (!conversation) return null;

  const parent = await prisma.chatMessage.findFirst({
    where: { id: parentId, conversationId, parentId: null },
    select: messageSelect,
  });
  if (!parent) return null;

  const after = options.after;
  const rows = await prisma.chatMessage.findMany({
    where: {
      conversationId,
      parentId,
      ...(after
        ? { OR: [{ createdAt: { gt: after.createdAt } }, { createdAt: after.createdAt, id: { gt: after.id } }] }
        : {}),
    },
    select: messageSelect,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: THREAD_PAGE_SIZE + 1,
  });
  const matters = await accessibleMatterSet(user);
  const stats = await replyStats([parent.id], user.id, unreadSince(conversation.membership));
  return {
    parent: toMessageView(parent, user.id, matters, stats.get(parent.id)),
    replies: rows.slice(0, THREAD_PAGE_SIZE).map((r) => toMessageView(r, user.id, matters)),
    hasMore: rows.length > THREAD_PAGE_SIZE,
  };
}

function conversationLabel(
  conversation: { type: string; name: string | null; memberships: { user: { id: string; name: string } }[] },
  viewerId: string,
): string {
  if (conversation.type === "CHANNEL") return `# ${conversation.name ?? "channel"}`;
  const others = conversation.memberships.map((m) => m.user).filter((u) => u.id !== viewerId);
  return others.map((u) => u.name).join(", ") || "Just you";
}

export type SidebarConversation = {
  id: string;
  type: "CHANNEL" | "DIRECT" | "GROUP";
  label: string;
  matterId: string | null;
  unread: number;
  lastMessageAt: string | null;
};

export async function listSidebarConversations(user: AuthorizableUser): Promise<SidebarConversation[]> {
  const ids = await readableConversationIds(user);
  if (ids.length === 0) return [];
  const conversations = await prisma.chatConversation.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      type: true,
      name: true,
      matterId: true,
      lastMessageAt: true,
      createdAt: true,
      memberships: { where: { leftAt: null }, select: { userId: true, lastReadAt: true, joinedAt: true, user: { select: { id: true, name: true } } } },
    },
    orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
  });

  return Promise.all(
    conversations.map(async (c) => {
      const mine = c.memberships.find((m) => m.userId === user.id);
      const unread = mine
        ? await prisma.chatMessage.count({
            where: {
              conversationId: c.id,
              deletedAt: null,
              authorId: { not: user.id },
              createdAt: { gt: unreadSince(mine) },
            },
          })
        : 0;
      return {
        id: c.id,
        type: c.type,
        label: conversationLabel(c, user.id),
        matterId: c.matterId,
        unread,
        lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
      };
    }),
  );
}

/** Dashboard / navigation summary: total unread and the conversations carrying it. */
export async function getUnreadChatSummary(user: AuthorizableUser) {
  const conversations = await listSidebarConversations(user);
  const withUnread = conversations.filter((c) => c.unread > 0);
  return {
    totalUnread: withUnread.reduce((sum, c) => sum + c.unread, 0),
    conversations: withUnread.slice(0, 5).map((c) => ({ id: c.id, label: c.label, unread: c.unread })),
  };
}

export async function getConversationMembers(conversationId: string) {
  return prisma.chatMembership.findMany({
    where: { conversationId, leftAt: null },
    select: { id: true, isOwner: true, user: { select: { id: true, name: true, role: true } } },
    orderBy: { joinedAt: "asc" },
  });
}

/** Search only within conversations the user can currently read; deleted messages never match. */
export async function searchMessages(user: AuthorizableUser, query: string) {
  const q = query.trim();
  if (q.length < 2) return [];
  const ids = await readableConversationIds(user);
  if (ids.length === 0) return [];
  const rows = await prisma.chatMessage.findMany({
    where: { conversationId: { in: ids }, deletedAt: null, body: { contains: q, mode: "insensitive" } },
    select: { ...messageSelect, conversation: { select: { type: true, name: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const matters = await accessibleMatterSet(user);
  return rows.map((r) => ({
    ...toMessageView(r, user.id, matters),
    conversationLabel: r.conversation.type === "CHANNEL" ? `# ${r.conversation.name}` : "Direct message",
  }));
}

/** Active staff for the DM / member pickers. */
export function listChatUserOptions() {
  return prisma.user.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/**
 * A matter's channels, for its Chat tab. Callers must already have
 * asserted matter access; channel names are visible to the matter team,
 * message contents still require membership.
 */
export async function listMatterChannels(user: AuthorizableUser, matterId: string) {
  const channels = await prisma.chatConversation.findMany({
    where: { matterId, type: "CHANNEL", archivedAt: null },
    select: {
      id: true,
      name: true,
      description: true,
      createdAt: true,
      memberships: { where: { leftAt: null }, select: { userId: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return channels.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    memberCount: c.memberships.length,
    isMember: c.memberships.some((m) => m.userId === user.id),
  }));
}

/** Documents the user may reference in a matter channel message (that matter's documents only). */
export function listMatterDocumentOptions(matterId: string) {
  return prisma.document.findMany({
    where: { matterId },
    select: { id: true, title: true },
    orderBy: { uploadedAt: "desc" },
    take: 200,
  });
}
