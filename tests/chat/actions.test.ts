import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireCurrentUserMock,
  hasMatterAccessMock,
  getReadableConversationMock,
  canManageChannelMock,
  userHasMatterAccessMock,
  prismaMock,
  redirectMock,
} = vi.hoisted(() => ({
  requireCurrentUserMock: vi.fn(),
  hasMatterAccessMock: vi.fn(),
  getReadableConversationMock: vi.fn(),
  canManageChannelMock: vi.fn(),
  userHasMatterAccessMock: vi.fn(),
  redirectMock: vi.fn((): never => {
    throw new Error("NEXT_REDIRECT");
  }),
  prismaMock: {
    user: { findMany: vi.fn() },
    chatConversation: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    chatMembership: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
    chatMessage: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    document: { findUnique: vi.fn() },
    auditEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/auth/session", () => ({ requireCurrentUser: requireCurrentUserMock }));
vi.mock("@/lib/auth/access", () => ({ hasMatterAccess: hasMatterAccessMock }));
vi.mock("@/lib/chat/access", () => ({
  getReadableConversation: getReadableConversationMock,
  canManageChannel: canManageChannelMock,
  userHasMatterAccess: userHasMatterAccessMock,
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

const {
  addChannelMember,
  createChannel,
  deleteMessage,
  editMessage,
  joinMatterChannel,
  removeChannelMember,
  sendMessage,
  startDirectConversation,
} = await import("@/lib/chat/actions");

const me = { id: "u-me", role: "ATTORNEY" as const };
const admin = { id: "u-admin", role: "ADMIN" as const };
const NOT_FOUND = "Not found or access denied.";
const readable = { id: "conv-1", type: "CHANNEL", matterId: null, membership: { id: "mem-1" } };

function fd(fields: Record<string, string | string[]>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const v of Array.isArray(value) ? value : [value]) formData.append(key, v);
  }
  return formData;
}

const audit = () => prismaMock.auditEvent.create.mock.calls.map((c) => c[0].data);

beforeEach(() => {
  vi.clearAllMocks();
  requireCurrentUserMock.mockResolvedValue(me);
  hasMatterAccessMock.mockResolvedValue(true);
  userHasMatterAccessMock.mockResolvedValue(true);
  canManageChannelMock.mockResolvedValue(true);
  getReadableConversationMock.mockResolvedValue(readable);
  prismaMock.user.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
    where.id.in.map((id) => ({ id })),
  );
  prismaMock.$transaction.mockImplementation((arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: unknown) => unknown)(prismaMock) : Promise.all(arg as Promise<unknown>[]),
  );
  redirectMock.mockImplementation(() => {
    throw new Error("NEXT_REDIRECT");
  });
});

describe("startDirectConversation", () => {
  it("rejects a group of more than five people in total, before touching the database", async () => {
    const result = await startDirectConversation({ error: null }, fd({ participantIds: ["a", "b", "c", "d", "e"] }));
    expect(result.error).toMatch(/limited to 5/);
    expect(prismaMock.chatConversation.create).not.toHaveBeenCalled();
  });

  it("creates a five-person group DM with fixed membership and a stable participant key", async () => {
    prismaMock.chatConversation.findUnique.mockResolvedValue(null);
    prismaMock.chatConversation.create.mockResolvedValue({ id: "g-1" });
    await expect(startDirectConversation({ error: null }, fd({ participantIds: ["d", "a", "c", "b"] }))).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    const data = prismaMock.chatConversation.create.mock.calls[0]![0].data;
    expect(data.type).toBe("GROUP");
    expect(data.participantKey).toBe("GROUP:a,b,c,d,u-me");
    expect(data.memberships.create).toHaveLength(5);
    expect(redirectMock).toHaveBeenCalledWith("/chat/g-1");
  });

  it("reuses the existing conversation for the same set of people", async () => {
    prismaMock.chatConversation.findUnique.mockResolvedValue({ id: "dm-existing" });
    await expect(startDirectConversation({ error: null }, fd({ participantIds: ["x"] }))).rejects.toThrow("NEXT_REDIRECT");
    expect(prismaMock.chatConversation.findUnique).toHaveBeenCalledWith({
      where: { participantKey: "DIRECT:u-me,x" },
      select: { id: true },
    });
    expect(prismaMock.chatConversation.create).not.toHaveBeenCalled();
    expect(redirectMock).toHaveBeenCalledWith("/chat/dm-existing");
  });

  it("refuses inactive or nonexistent participants", async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: "u-me" }]);
    expect((await startDirectConversation({ error: null }, fd({ participantIds: ["ghost"] }))).error).toMatch(/active staff/);
  });
});

describe("group DM membership is fixed", () => {
  it("rejects adding anyone to a group DM, even for ADMIN", async () => {
    requireCurrentUserMock.mockResolvedValue(admin);
    prismaMock.chatConversation.findUnique.mockResolvedValue({ type: "GROUP", matterId: null });
    const result = await addChannelMember({ error: null }, fd({ conversationId: "g-1", userId: "new" }));
    expect(result.error).toMatch(/fixed/);
    expect(prismaMock.chatMembership.create).not.toHaveBeenCalled();
  });

  it("rejects removing anyone from a DM", async () => {
    prismaMock.chatConversation.findUnique.mockResolvedValue({ type: "DIRECT", matterId: null });
    expect((await removeChannelMember({ conversationId: "dm", userId: "u-me" })).ok).toBe(false);
    expect(prismaMock.chatMembership.update).not.toHaveBeenCalled();
  });
});

describe("channels", () => {
  it("requires matter access to create a matter channel", async () => {
    hasMatterAccessMock.mockResolvedValue(false);
    const result = await createChannel({ error: null }, fd({ name: "Trial prep", channelKind: "MATTER", matterId: "m-x" }));
    expect(result.error).toBe(NOT_FOUND);
    expect(prismaMock.chatConversation.create).not.toHaveBeenCalled();
  });

  it("refuses matter-channel members who can't access the matter", async () => {
    userHasMatterAccessMock.mockResolvedValue(false);
    const result = await createChannel(
      { error: null },
      fd({ name: "Trial prep", channelKind: "MATTER", matterId: "m-1", memberIds: ["outsider"] }),
    );
    expect(result.error).toMatch(/access to that matter/);
  });

  it("creates the channel with the creator as owner and audits without content", async () => {
    prismaMock.chatConversation.create.mockResolvedValue({ id: "ch-1" });
    await expect(
      createChannel({ error: null }, fd({ name: "General", channelKind: "GENERAL", memberIds: ["u-2"], description: "Private plans" })),
    ).rejects.toThrow("NEXT_REDIRECT");
    const data = prismaMock.chatConversation.create.mock.calls[0]![0].data;
    expect(data.memberships.create).toEqual([{ userId: "u-me", isOwner: true }, { userId: "u-2" }]);
    expect(audit()[0]).toMatchObject({ action: "CREATE", entityType: "ChatConversation", metadata: { type: "CHANNEL", channelKind: "GENERAL", memberCount: 2 } });
    expect(JSON.stringify(audit())).not.toContain("Private plans");
  });

  it("rejects a matter id on a non-matter channel", async () => {
    const result = await createChannel({ error: null }, fd({ name: "x", channelKind: "TEAM", matterId: "m-1" }));
    expect(result.error).toMatch(/Matter channels/);
  });

  it("only owners/ADMIN can add members, and new members of a matter channel need matter access", async () => {
    prismaMock.chatConversation.findUnique.mockResolvedValue({ type: "CHANNEL", matterId: "m-1" });
    canManageChannelMock.mockResolvedValue(false);
    expect((await addChannelMember({ error: null }, fd({ conversationId: "ch", userId: "u-2" }))).error).toBe(NOT_FOUND);
    canManageChannelMock.mockResolvedValue(true);
    userHasMatterAccessMock.mockResolvedValue(false);
    expect((await addChannelMember({ error: null }, fd({ conversationId: "ch", userId: "u-2" }))).error).toMatch(/doesn't have access/);
    expect(prismaMock.chatMembership.create).not.toHaveBeenCalled();
  });

  it("lets a member leave, but not remove others without manage rights", async () => {
    prismaMock.chatConversation.findUnique.mockResolvedValue({ type: "CHANNEL", matterId: null });
    canManageChannelMock.mockResolvedValue(false);
    expect((await removeChannelMember({ conversationId: "ch", userId: "u-other" })).ok).toBe(false);
    prismaMock.chatMembership.findUnique.mockResolvedValue({ id: "mem", leftAt: null });
    expect((await removeChannelMember({ conversationId: "ch", userId: "u-me" })).ok).toBe(true);
    expect(prismaMock.chatMembership.update).toHaveBeenCalledWith({ where: { id: "mem" }, data: { leftAt: expect.any(Date), isOwner: false } });
  });

  it("self-join works only for matter channels and only with matter access", async () => {
    prismaMock.chatConversation.findUnique.mockResolvedValue({ type: "CHANNEL", matterId: null, archivedAt: null });
    expect((await joinMatterChannel({ conversationId: "general" })).ok).toBe(false);
    prismaMock.chatConversation.findUnique.mockResolvedValue({ type: "CHANNEL", matterId: "m-1", archivedAt: null });
    hasMatterAccessMock.mockResolvedValue(false);
    expect((await joinMatterChannel({ conversationId: "mc" })).ok).toBe(false);
    expect(prismaMock.chatMembership.upsert).not.toHaveBeenCalled();
  });
});

describe("sendMessage", () => {
  it("refuses a conversation the user can't read (forged id or revoked matter access)", async () => {
    getReadableConversationMock.mockResolvedValue(null);
    expect((await sendMessage({ error: null }, fd({ conversationId: "forged", body: "hi" }))).error).toBe(NOT_FOUND);
    expect(prismaMock.chatMessage.create).not.toHaveBeenCalled();
  });

  it("refuses a matter reference the sender can't access", async () => {
    hasMatterAccessMock.mockResolvedValue(false);
    expect((await sendMessage({ error: null }, fd({ conversationId: "conv-1", body: "hi", matterRefId: "m-x" }))).error).toBe(NOT_FOUND);
  });

  it("refuses a document reference on an inaccessible matter", async () => {
    prismaMock.document.findUnique.mockResolvedValue({ matterId: "m-x" });
    hasMatterAccessMock.mockResolvedValue(false);
    expect((await sendMessage({ error: null }, fd({ conversationId: "conv-1", body: "hi", documentRefId: "d-1" }))).error).toBe(NOT_FOUND);
    expect(prismaMock.chatMessage.create).not.toHaveBeenCalled();
  });

  it("rejects empty and over-long messages", async () => {
    expect((await sendMessage({ error: null }, fd({ conversationId: "conv-1", body: "   " }))).error).toBeTruthy();
    expect((await sendMessage({ error: null }, fd({ conversationId: "conv-1", body: "x".repeat(4_001) }))).error).toMatch(/too long/);
  });

  it("rejects a reply whose parent is in another conversation (forged parent id)", async () => {
    prismaMock.chatMessage.findUnique.mockResolvedValue({ conversationId: "conv-other", parentId: null });
    expect((await sendMessage({ error: null }, fd({ conversationId: "conv-1", body: "hi", parentId: "msg-x" }))).error).toBe(NOT_FOUND);
    expect(prismaMock.chatMessage.create).not.toHaveBeenCalled();
  });

  it("rejects a reply to a reply — threads are one level deep", async () => {
    prismaMock.chatMessage.findUnique.mockResolvedValue({ conversationId: "conv-1", parentId: "top-1" });
    expect((await sendMessage({ error: null }, fd({ conversationId: "conv-1", body: "hi", parentId: "reply-1" }))).error).toBe(NOT_FOUND);
    expect(prismaMock.chatMessage.create).not.toHaveBeenCalled();
  });

  it("rejects a reply in a conversation the user can't read, even with a valid parent", async () => {
    getReadableConversationMock.mockResolvedValue(null);
    prismaMock.chatMessage.findUnique.mockResolvedValue({ conversationId: "conv-1", parentId: null });
    expect((await sendMessage({ error: null }, fd({ conversationId: "conv-1", body: "hi", parentId: "top-1" }))).error).toBe(NOT_FOUND);
    expect(prismaMock.chatMessage.create).not.toHaveBeenCalled();
  });

  it("accepts a reply to a top-level message of the same conversation (deleted parents allowed)", async () => {
    prismaMock.chatMessage.findUnique.mockResolvedValue({ conversationId: "conv-1", parentId: null });
    expect((await sendMessage({ error: null }, fd({ conversationId: "conv-1", body: "reply", parentId: "top-1" }))).error).toBeNull();
    expect(prismaMock.chatMessage.create).toHaveBeenCalledWith({ data: expect.objectContaining({ parentId: "top-1" }) });
  });

  it("persists the message, bumps the conversation, marks it read for the sender, and writes no audit body", async () => {
    expect((await sendMessage({ error: null }, fd({ conversationId: "conv-1", body: "  Privileged strategy note  " }))).error).toBeNull();
    expect(prismaMock.chatMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ conversationId: "conv-1", authorId: "u-me", body: "Privileged strategy note" }),
    });
    expect(prismaMock.chatConversation.update).toHaveBeenCalled();
    expect(prismaMock.chatMembership.update).toHaveBeenCalledWith({ where: { id: "mem-1" }, data: { lastReadAt: expect.any(Date) } });
    expect(JSON.stringify(audit())).not.toContain("Privileged");
  });
});

describe("editMessage / deleteMessage", () => {
  const message = { id: "msg-1", authorId: "u-other", conversationId: "conv-1", deletedAt: null, conversation: { type: "DIRECT", matterId: null } };

  it("only the author can edit", async () => {
    prismaMock.chatMessage.findUnique.mockResolvedValue(message);
    expect((await editMessage({ messageId: "msg-1", body: "changed" })).ok).toBe(false);
    expect(prismaMock.chatMessage.update).not.toHaveBeenCalled();
  });

  it("refuses to delete someone else's DM message, even as ADMIN", async () => {
    requireCurrentUserMock.mockResolvedValue(admin);
    prismaMock.chatMessage.findUnique.mockResolvedValue(message);
    expect((await deleteMessage({ messageId: "msg-1" })).ok).toBe(false);
  });

  it("lets ADMIN moderate a channel message they can read; soft delete, audited without body", async () => {
    requireCurrentUserMock.mockResolvedValue(admin);
    prismaMock.chatMessage.findUnique.mockResolvedValue({ ...message, conversation: { type: "CHANNEL", matterId: "m-1" } });
    expect((await deleteMessage({ messageId: "msg-1" })).ok).toBe(true);
    expect(prismaMock.chatMessage.update).toHaveBeenCalledWith({ where: { id: "msg-1" }, data: { deletedAt: expect.any(Date) } });
    expect(audit()[0]).toMatchObject({ action: "DELETE", entityType: "ChatMessage", matterId: "m-1", metadata: { conversationId: "conv-1", moderated: true } });
  });

  it("refuses edit/delete when the conversation is no longer readable", async () => {
    prismaMock.chatMessage.findUnique.mockResolvedValue({ ...message, authorId: "u-me" });
    getReadableConversationMock.mockResolvedValue(null);
    expect((await editMessage({ messageId: "msg-1", body: "x" })).ok).toBe(false);
    expect((await deleteMessage({ messageId: "msg-1" })).ok).toBe(false);
  });

  it("treats a forged message id as not found", async () => {
    prismaMock.chatMessage.findUnique.mockResolvedValue(null);
    expect(await deleteMessage({ messageId: "forged" })).toEqual({ ok: false, error: NOT_FOUND });
  });
});
