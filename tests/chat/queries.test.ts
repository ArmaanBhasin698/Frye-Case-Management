import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, readableIdsMock, getReadableConversationMock, getAssignedMatterIdsMock } = vi.hoisted(() => ({
  prismaMock: {
    chatConversation: { findMany: vi.fn() },
    chatMessage: { findMany: vi.fn(), count: vi.fn() },
  },
  readableIdsMock: vi.fn(),
  getReadableConversationMock: vi.fn(),
  getAssignedMatterIdsMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/access", () => ({ getAssignedMatterIds: getAssignedMatterIdsMock }));
vi.mock("@/lib/chat/access", () => ({
  readableConversationIds: readableIdsMock,
  getReadableConversation: getReadableConversationMock,
}));

const { getConversationMessages, getUnreadChatSummary, searchMessages, toMessageView } = await import("@/lib/chat/queries");

const staff = { id: "u-me", role: "STAFF" as const };

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg-1",
    conversationId: "conv-1",
    body: "Hello",
    authorId: "u-other",
    author: { name: "Pat Example" },
    createdAt: new Date("2026-10-01T12:00:00Z"),
    editedAt: null,
    deletedAt: null,
    matterRef: null,
    documentRef: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getAssignedMatterIdsMock.mockResolvedValue(["m-1"]);
});

describe("toMessageView", () => {
  it("never returns a deleted message's body or references", () => {
    const view = toMessageView(row({ deletedAt: new Date(), matterRef: { id: "m-1", caseNumber: "X" } }), "u-me", null);
    expect(view.body).toBeNull();
    expect(view.deleted).toBe(true);
    expect(view.matterRef).toBeNull();
  });

  it("masks matter and document references the viewer can't access", () => {
    const view = toMessageView(
      row({ matterRef: { id: "m-secret", caseNumber: "SECRET-1" }, documentRef: { id: "d", title: "Hidden memo", matterId: "m-secret" } }),
      "u-me",
      new Set(["m-1"]),
    );
    expect(view.matterRef).toBe("restricted");
    expect(view.documentRef).toBe("restricted");
    expect(JSON.stringify(view)).not.toContain("SECRET-1");
    expect(JSON.stringify(view)).not.toContain("Hidden memo");
  });

  it("shows references the viewer can access", () => {
    const view = toMessageView(row({ matterRef: { id: "m-1", caseNumber: "24-CR-1" } }), "u-me", new Set(["m-1"]));
    expect(view.matterRef).toEqual({ id: "m-1", caseNumber: "24-CR-1" });
  });
});

describe("getConversationMessages", () => {
  it("returns null without querying messages when the conversation isn't readable", async () => {
    getReadableConversationMock.mockResolvedValue(null);
    expect(await getConversationMessages(staff, "conv-x")).toBeNull();
    expect(prismaMock.chatMessage.findMany).not.toHaveBeenCalled();
  });

  it("returns oldest-first and reports older pages", async () => {
    getReadableConversationMock.mockResolvedValue({ id: "conv-1" });
    const rows = Array.from({ length: 51 }, (_, i) => row({ id: `m${i}`, createdAt: new Date(2026, 0, 1, 0, 51 - i) }));
    prismaMock.chatMessage.findMany.mockResolvedValue(rows);
    const result = await getConversationMessages(staff, "conv-1");
    expect(result?.hasOlder).toBe(true);
    expect(result?.messages).toHaveLength(50);
    expect(result?.messages[0]!.id).toBe("m49");
  });
});

describe("searchMessages", () => {
  it("searches only readable conversations and never deleted messages", async () => {
    readableIdsMock.mockResolvedValue(["conv-1"]);
    prismaMock.chatMessage.findMany.mockResolvedValue([]);
    await searchMessages(staff, "plea");
    expect(prismaMock.chatMessage.findMany.mock.calls[0]![0].where).toEqual({
      conversationId: { in: ["conv-1"] },
      deletedAt: null,
      body: { contains: "plea", mode: "insensitive" },
    });
  });

  it("returns nothing when the user can read no conversations, or the query is too short", async () => {
    readableIdsMock.mockResolvedValue([]);
    expect(await searchMessages(staff, "plea")).toEqual([]);
    expect(await searchMessages(staff, "p")).toEqual([]);
    expect(prismaMock.chatMessage.findMany).not.toHaveBeenCalled();
  });
});

describe("getUnreadChatSummary", () => {
  it("counts other people's undeleted messages since the user's last read", async () => {
    readableIdsMock.mockResolvedValue(["conv-1"]);
    const lastReadAt = new Date("2026-10-01T00:00:00Z");
    prismaMock.chatConversation.findMany.mockResolvedValue([
      {
        id: "conv-1",
        type: "DIRECT",
        name: null,
        matterId: null,
        lastMessageAt: new Date(),
        createdAt: new Date(),
        memberships: [
          { userId: "u-me", lastReadAt, joinedAt: new Date("2026-01-01"), user: { id: "u-me", name: "Me" } },
          { userId: "u-other", lastReadAt: null, joinedAt: new Date(), user: { id: "u-other", name: "Pat Example" } },
        ],
      },
    ]);
    prismaMock.chatMessage.count.mockResolvedValue(3);
    expect(await getUnreadChatSummary(staff)).toEqual({
      totalUnread: 3,
      conversations: [{ id: "conv-1", label: "Pat Example", unread: 3 }],
    });
    expect(prismaMock.chatMessage.count).toHaveBeenCalledWith({
      where: { conversationId: "conv-1", deletedAt: null, authorId: { not: "u-me" }, createdAt: { gt: lastReadAt } },
    });
  });

  it("is empty when nothing is readable", async () => {
    readableIdsMock.mockResolvedValue([]);
    expect(await getUnreadChatSummary(staff)).toEqual({ totalUnread: 0, conversations: [] });
  });
});
