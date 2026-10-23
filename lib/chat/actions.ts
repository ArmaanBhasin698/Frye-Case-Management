"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { hasMatterAccess } from "@/lib/auth/access";
import { isAdmin } from "@/lib/auth/authorization";
import { requireCurrentUser } from "@/lib/auth/session";
import type { ActionResult } from "@/lib/matters/actions";
import { canManageChannel, getReadableConversation, userHasMatterAccess } from "@/lib/chat/access";
import {
  GROUP_DM_MAX_PARTICIPANTS,
  MESSAGE_MAX_LENGTH,
  membershipIsFixed,
  participantKey,
  participantsFor,
  validateDirectParticipants,
} from "@/lib/chat/rules";

/**
 * Team-chat Server Actions. Every action re-resolves the session and
 * re-checks conversation access (membership + matter access) itself.
 * Denials share one generic message so forged ids can't probe for
 * conversations. Audit events cover channel creation, membership changes,
 * and message deletion/edits — and never include a message body.
 */

const NOT_FOUND = "Not found or access denied.";
const id = z.string().trim().min(1).max(100);

export type ChatFormState = { error: string | null };

function value(formData: FormData, key: string): string | undefined {
  const v = formData.get(key);
  return v === null ? undefined : String(v);
}

async function activeUserIds(ids: string[]): Promise<string[]> {
  const users = await prisma.user.findMany({ where: { id: { in: ids }, status: "ACTIVE" }, select: { id: true } });
  return users.map((u) => u.id);
}

// --- Channels -----------------------------------------------------------------

const channelSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Channel name is required.")
      .max(80, "Channel name is too long."),
    description: z.string().trim().max(500, "Description is too long.").optional().transform((v) => (v ? v : undefined)),
    channelKind: z.enum(["MATTER", "TEAM", "DEPARTMENT", "GENERAL", "TOPIC"]),
    matterId: id.optional(),
    memberIds: z.array(id).max(100),
  })
  .refine((d) => (d.channelKind === "MATTER") === Boolean(d.matterId), {
    message: "Matter channels must be linked to a matter (and only matter channels can be).",
  });

export async function createChannel(_prev: ChatFormState, formData: FormData): Promise<ChatFormState> {
  const user = await requireCurrentUser();
  const parsed = channelSchema.safeParse({
    name: value(formData, "name"),
    description: value(formData, "description"),
    channelKind: value(formData, "channelKind"),
    matterId: value(formData, "matterId") || undefined,
    memberIds: formData.getAll("memberIds").map(String).filter(Boolean),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const { name, description, channelKind, matterId } = parsed.data;

  if (matterId && !(await hasMatterAccess(user, matterId))) return { error: NOT_FOUND };

  const requested = [...new Set(parsed.data.memberIds.filter((m) => m !== user.id))];
  const active = await activeUserIds(requested);
  if (active.length !== requested.length) return { error: "Choose active staff members only." };
  if (matterId) {
    for (const memberId of requested) {
      if (!(await userHasMatterAccess(memberId, matterId))) {
        return { error: "Everyone in a matter channel must have access to that matter." };
      }
    }
  }

  let conversationId: string;
  try {
    conversationId = await prisma.$transaction(async (tx) => {
      const conversation = await tx.chatConversation.create({
        data: {
          type: "CHANNEL",
          name,
          description: description ?? null,
          channelKind,
          matterId: matterId ?? null,
          createdById: user.id,
          memberships: {
            create: [
              { userId: user.id, isOwner: true },
              ...requested.map((userId) => ({ userId })),
            ],
          },
        },
      });
      await tx.auditEvent.create({
        data: {
          actorId: user.id,
          action: "CREATE",
          entityType: "ChatConversation",
          entityId: conversation.id,
          matterId: matterId ?? null,
          metadata: { type: "CHANNEL", channelKind, memberCount: requested.length + 1 },
        },
      });
      return conversation.id;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") return { error: NOT_FOUND };
    throw error;
  }

  revalidatePath("/chat");
  if (matterId) revalidatePath(`/matters/${matterId}/chat`);
  redirect(`/chat/${conversationId}`);
}

export async function addChannelMember(_prev: ChatFormState, formData: FormData): Promise<ChatFormState> {
  const user = await requireCurrentUser();
  const parsed = z.object({ conversationId: id, userId: id }).safeParse({
    conversationId: value(formData, "conversationId"),
    userId: value(formData, "userId"),
  });
  if (!parsed.success) return { error: NOT_FOUND };
  const { conversationId, userId } = parsed.data;

  const conversation = await prisma.chatConversation.findUnique({
    where: { id: conversationId },
    select: { type: true, matterId: true },
  });
  if (!conversation) return { error: NOT_FOUND };
  if (membershipIsFixed(conversation.type)) {
    return { error: "Direct and group message membership is fixed. Start a new conversation instead." };
  }
  if (!(await canManageChannel(user, conversationId))) return { error: NOT_FOUND };
  if ((await activeUserIds([userId])).length === 0) return { error: "Choose an active staff member." };
  if (conversation.matterId && !(await userHasMatterAccess(userId, conversation.matterId))) {
    return { error: "That person doesn't have access to this channel's matter." };
  }

  const existing = await prisma.chatMembership.findUnique({ where: { conversationId_userId: { conversationId, userId } } });
  if (existing && !existing.leftAt) return { error: "Already a member." };
  await prisma.$transaction([
    existing
      ? prisma.chatMembership.update({ where: { id: existing.id }, data: { leftAt: null, joinedAt: new Date(), lastReadAt: null } })
      : prisma.chatMembership.create({ data: { conversationId, userId } }),
    prisma.auditEvent.create({
      data: {
        actorId: user.id,
        action: "UPDATE",
        entityType: "ChatConversation",
        entityId: conversationId,
        matterId: conversation.matterId,
        metadata: { memberAdded: userId },
      },
    }),
  ]);
  revalidatePath(`/chat/${conversationId}`);
  return { error: null };
}

export async function removeChannelMember(input: { conversationId: string; userId: string }): Promise<ActionResult> {
  const user = await requireCurrentUser();
  const parsed = z.object({ conversationId: id, userId: id }).safeParse(input);
  if (!parsed.success) return { ok: false, error: NOT_FOUND };
  const { conversationId, userId } = parsed.data;

  const conversation = await prisma.chatConversation.findUnique({ where: { id: conversationId }, select: { type: true, matterId: true } });
  if (!conversation) return { ok: false, error: NOT_FOUND };
  if (membershipIsFixed(conversation.type)) {
    return { ok: false, error: "Direct and group message membership is fixed." };
  }
  const self = userId === user.id;
  if (!self && !(await canManageChannel(user, conversationId))) return { ok: false, error: NOT_FOUND };

  const membership = await prisma.chatMembership.findUnique({ where: { conversationId_userId: { conversationId, userId } } });
  if (!membership || membership.leftAt) return { ok: false, error: NOT_FOUND };

  await prisma.$transaction([
    prisma.chatMembership.update({ where: { id: membership.id }, data: { leftAt: new Date(), isOwner: false } }),
    prisma.auditEvent.create({
      data: {
        actorId: user.id,
        action: "UPDATE",
        entityType: "ChatConversation",
        entityId: conversationId,
        matterId: conversation.matterId,
        metadata: self ? { memberLeft: userId } : { memberRemoved: userId },
      },
    }),
  ]);
  revalidatePath("/chat");
  revalidatePath(`/chat/${conversationId}`);
  return { ok: true, data: undefined };
}

/** Self-join is only for matter channels, and only with current access to that matter. */
export async function joinMatterChannel(input: { conversationId: string }): Promise<ActionResult> {
  const user = await requireCurrentUser();
  const parsed = z.object({ conversationId: id }).safeParse(input);
  if (!parsed.success) return { ok: false, error: NOT_FOUND };
  const { conversationId } = parsed.data;

  const conversation = await prisma.chatConversation.findUnique({
    where: { id: conversationId },
    select: { type: true, matterId: true, archivedAt: true },
  });
  if (!conversation || conversation.type !== "CHANNEL" || !conversation.matterId || conversation.archivedAt) {
    return { ok: false, error: NOT_FOUND };
  }
  if (!(await hasMatterAccess(user, conversation.matterId))) return { ok: false, error: NOT_FOUND };

  await prisma.$transaction([
    prisma.chatMembership.upsert({
      where: { conversationId_userId: { conversationId, userId: user.id } },
      create: { conversationId, userId: user.id },
      update: { leftAt: null, joinedAt: new Date(), lastReadAt: null },
    }),
    prisma.auditEvent.create({
      data: {
        actorId: user.id,
        action: "UPDATE",
        entityType: "ChatConversation",
        entityId: conversationId,
        matterId: conversation.matterId,
        metadata: { memberJoined: user.id },
      },
    }),
  ]);
  revalidatePath(`/matters/${conversation.matterId}/chat`);
  return { ok: true, data: undefined };
}

// --- Direct & group messages -------------------------------------------------

/**
 * Opens (or reuses) the DM/group DM for exactly this set of people. The
 * participant set is fixed forever: `participantKey @unique` means the same
 * people always land in the same conversation, and nothing can add to it.
 */
export async function startDirectConversation(_prev: ChatFormState, formData: FormData): Promise<ChatFormState> {
  const user = await requireCurrentUser();
  const parsed = z.array(id).max(GROUP_DM_MAX_PARTICIPANTS + 5).safeParse(formData.getAll("participantIds").map(String).filter(Boolean));
  if (!parsed.success) return { error: "Choose who to message." };

  const participants = participantsFor(user.id, parsed.data);
  const type = participants.length === 2 ? "DIRECT" : "GROUP";
  const invalid = validateDirectParticipants(type, participants);
  if (invalid) return { error: invalid };
  if ((await activeUserIds(participants)).length !== participants.length) return { error: "Choose active staff members only." };

  const key = participantKey(type, participants);
  let conversation = await prisma.chatConversation.findUnique({ where: { participantKey: key }, select: { id: true } });
  if (!conversation) {
    try {
      conversation = await prisma.chatConversation.create({
        data: {
          type,
          participantKey: key,
          createdById: user.id,
          memberships: { create: participants.map((userId) => ({ userId })) },
        },
        select: { id: true },
      });
      await prisma.auditEvent.create({
        data: {
          actorId: user.id,
          action: "CREATE",
          entityType: "ChatConversation",
          entityId: conversation.id,
          metadata: { type, participantCount: participants.length },
        },
      });
    } catch (error) {
      // A concurrent request created the same participant set first — reuse it.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
      conversation = await prisma.chatConversation.findUnique({ where: { participantKey: key }, select: { id: true } });
      if (!conversation) throw error;
    }
  }

  revalidatePath("/chat");
  redirect(`/chat/${conversation.id}`);
}

// --- Messages --------------------------------------------------------------------

const sendSchema = z.object({
  conversationId: id,
  body: z.string().trim().min(1, "Write a message first.").max(MESSAGE_MAX_LENGTH, "Message is too long."),
  matterRefId: id.optional(),
  documentRefId: id.optional(),
  parentId: id.optional(),
});

export async function sendMessage(_prev: ChatFormState, formData: FormData): Promise<ChatFormState> {
  const user = await requireCurrentUser();
  const parsed = sendSchema.safeParse({
    conversationId: value(formData, "conversationId"),
    body: value(formData, "body"),
    matterRefId: value(formData, "matterRefId") || undefined,
    documentRefId: value(formData, "documentRefId") || undefined,
    parentId: value(formData, "parentId") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const { conversationId, body, matterRefId, documentRefId, parentId } = parsed.data;

  const conversation = await getReadableConversation(user, conversationId);
  if (!conversation) return { error: NOT_FOUND };

  // A reference never grants access — the sender must already have it.
  if (matterRefId && !(await hasMatterAccess(user, matterRefId))) return { error: NOT_FOUND };
  if (documentRefId) {
    const document = await prisma.document.findUnique({ where: { id: documentRefId }, select: { matterId: true } });
    if (!document || !(await hasMatterAccess(user, document.matterId))) return { error: NOT_FOUND };
  }
  // Threads are one level deep: a reply's parent must be a top-level
  // message of this same conversation. Replying under a soft-deleted parent
  // is allowed — the thread stays readable and shows "message deleted".
  if (parentId) {
    const parent = await prisma.chatMessage.findUnique({
      where: { id: parentId },
      select: { conversationId: true, parentId: true },
    });
    if (!parent || parent.conversationId !== conversationId || parent.parentId !== null) return { error: NOT_FOUND };
  }

  const now = new Date();
  try {
    await prisma.$transaction([
      prisma.chatMessage.create({
        data: {
          conversationId,
          authorId: user.id,
          body,
          matterRefId: matterRefId ?? null,
          documentRefId: documentRefId ?? null,
          parentId: parentId ?? null,
          createdAt: now,
        },
      }),
      prisma.chatConversation.update({ where: { id: conversationId }, data: { lastMessageAt: now } }),
      prisma.chatMembership.update({ where: { id: conversation.membership.id }, data: { lastReadAt: now } }),
    ]);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") return { error: NOT_FOUND };
    throw error;
  }
  return { error: null };
}

async function loadMessage(messageId: string) {
  return prisma.chatMessage.findUnique({
    where: { id: messageId },
    select: { id: true, authorId: true, conversationId: true, deletedAt: true, conversation: { select: { type: true, matterId: true } } },
  });
}

export async function editMessage(input: { messageId: string; body: string }): Promise<ActionResult> {
  const user = await requireCurrentUser();
  const parsed = z
    .object({ messageId: id, body: z.string().trim().min(1).max(MESSAGE_MAX_LENGTH) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid message." };

  const message = await loadMessage(parsed.data.messageId);
  if (!message || message.deletedAt || message.authorId !== user.id) return { ok: false, error: NOT_FOUND };
  if (!(await getReadableConversation(user, message.conversationId))) return { ok: false, error: NOT_FOUND };

  await prisma.$transaction([
    prisma.chatMessage.update({ where: { id: message.id }, data: { body: parsed.data.body, editedAt: new Date() } }),
    prisma.auditEvent.create({
      data: {
        actorId: user.id,
        action: "UPDATE",
        entityType: "ChatMessage",
        entityId: message.id,
        matterId: message.conversation.matterId,
        metadata: { conversationId: message.conversationId, edited: true },
      },
    }),
  ]);
  return { ok: true, data: undefined };
}

/**
 * Soft delete: the row stays (thread and audit history intact) but the body
 * is never returned again. Authors may delete their own messages; ADMIN may
 * also remove messages in channels they can read (moderation) — never in
 * someone else's DM.
 */
export async function deleteMessage(input: { messageId: string }): Promise<ActionResult> {
  const user = await requireCurrentUser();
  const parsed = z.object({ messageId: id }).safeParse(input);
  if (!parsed.success) return { ok: false, error: NOT_FOUND };

  const message = await loadMessage(parsed.data.messageId);
  if (!message || message.deletedAt) return { ok: false, error: NOT_FOUND };
  if (!(await getReadableConversation(user, message.conversationId))) return { ok: false, error: NOT_FOUND };
  const moderating = message.authorId !== user.id;
  if (moderating && !(isAdmin(user) && message.conversation.type === "CHANNEL")) return { ok: false, error: NOT_FOUND };

  await prisma.$transaction([
    prisma.chatMessage.update({ where: { id: message.id }, data: { deletedAt: new Date() } }),
    prisma.auditEvent.create({
      data: {
        actorId: user.id,
        action: "DELETE",
        entityType: "ChatMessage",
        entityId: message.id,
        matterId: message.conversation.matterId,
        metadata: { conversationId: message.conversationId, moderated: moderating },
      },
    }),
  ]);
  return { ok: true, data: undefined };
}

export async function markConversationRead(input: { conversationId: string }): Promise<ActionResult> {
  const user = await requireCurrentUser();
  const parsed = z.object({ conversationId: id }).safeParse(input);
  if (!parsed.success) return { ok: false, error: NOT_FOUND };
  const conversation = await getReadableConversation(user, parsed.data.conversationId);
  if (!conversation) return { ok: false, error: NOT_FOUND };
  await prisma.chatMembership.update({ where: { id: conversation.membership.id }, data: { lastReadAt: new Date() } });
  return { ok: true, data: undefined };
}
