import { prisma } from "@/lib/db";
import { getAssignedMatterIds, hasMatterAccess } from "@/lib/auth/access";
import { isAdmin, type AuthorizableUser } from "@/lib/auth/authorization";
import { canReadConversationFrom } from "@/lib/chat/rules";

/**
 * Prisma-backed chat authorization. Every chat read and write goes through
 * `getReadableConversation` (re-evaluated on every call — nothing is
 * cached), so a matter channel stops being readable the moment the user's
 * matter access is removed, even though their membership row remains.
 */

export type ReadableConversation = {
  id: string;
  type: "CHANNEL" | "DIRECT" | "GROUP";
  name: string | null;
  description: string | null;
  channelKind: "MATTER" | "TEAM" | "DEPARTMENT" | "GENERAL" | "TOPIC" | null;
  matterId: string | null;
  createdById: string | null;
  membership: { id: string; isOwner: boolean; lastReadAt: Date | null; joinedAt: Date };
};

/** The conversation if `user` may read it right now, otherwise null (nonexistent and forbidden look identical). */
export async function getReadableConversation(
  user: AuthorizableUser,
  conversationId: string,
): Promise<ReadableConversation | null> {
  const conversation = await prisma.chatConversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      type: true,
      name: true,
      description: true,
      channelKind: true,
      matterId: true,
      createdById: true,
      archivedAt: true,
      memberships: {
        where: { userId: user.id, leftAt: null },
        select: { id: true, isOwner: true, lastReadAt: true, joinedAt: true },
      },
    },
  });
  if (!conversation || conversation.archivedAt) return null;
  const membership = conversation.memberships[0];
  const allowed = canReadConversationFrom({
    activeMember: Boolean(membership),
    matterId: conversation.matterId,
    hasMatterAccess: conversation.matterId ? await hasMatterAccess(user, conversation.matterId) : true,
  });
  if (!allowed || !membership) return null;
  return {
    id: conversation.id,
    type: conversation.type,
    name: conversation.name,
    description: conversation.description,
    channelKind: conversation.channelKind,
    matterId: conversation.matterId,
    createdById: conversation.createdById,
    membership,
  };
}

/**
 * Who may add/remove channel members: the channel's owner(s) or ADMIN.
 * ADMIN manages membership without thereby gaining read access — reading
 * still requires their own active membership.
 */
export async function canManageChannel(user: AuthorizableUser, conversationId: string): Promise<boolean> {
  const conversation = await prisma.chatConversation.findUnique({
    where: { id: conversationId },
    select: { type: true, archivedAt: true, matterId: true, memberships: { where: { userId: user.id, leftAt: null }, select: { isOwner: true } } },
  });
  if (!conversation || conversation.type !== "CHANNEL" || conversation.archivedAt) return false;
  if (isAdmin(user)) return true;
  if (conversation.matterId && !(await hasMatterAccess(user, conversation.matterId))) return false;
  return conversation.memberships[0]?.isOwner === true;
}

/** Whether another (active) staff account may access a matter — used when adding people to a matter channel. */
export async function userHasMatterAccess(userId: string, matterId: string): Promise<boolean> {
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, status: true } });
  if (!target || target.status !== "ACTIVE") return false;
  return hasMatterAccess(target, matterId);
}

/**
 * Ids of every conversation `user` can currently read — used for the
 * sidebar, search, and unread counts so none of them can surface a
 * conversation the per-conversation check would refuse.
 */
export async function readableConversationIds(user: AuthorizableUser): Promise<string[]> {
  const memberships = await prisma.chatMembership.findMany({
    where: { userId: user.id, leftAt: null, conversation: { archivedAt: null } },
    select: { conversationId: true, conversation: { select: { matterId: true } } },
  });
  const assigned = isAdmin(user) ? null : new Set(await getAssignedMatterIds(user.id));
  return memberships
    .filter((m) => !m.conversation.matterId || assigned === null || assigned.has(m.conversation.matterId))
    .map((m) => m.conversationId);
}
