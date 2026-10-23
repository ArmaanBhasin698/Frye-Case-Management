import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, hasMatterAccessMock, getAssignedMatterIdsMock } = vi.hoisted(() => ({
  prismaMock: {
    chatConversation: { findUnique: vi.fn() },
    chatMembership: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
  },
  hasMatterAccessMock: vi.fn(),
  getAssignedMatterIdsMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/access", () => ({ hasMatterAccess: hasMatterAccessMock, getAssignedMatterIds: getAssignedMatterIdsMock }));

const { canManageChannel, getReadableConversation, readableConversationIds, userHasMatterAccess } = await import("@/lib/chat/access");

const staff = { id: "u-staff", role: "STAFF" as const };
const admin = { id: "u-admin", role: "ADMIN" as const };
const membership = { id: "mem-1", isOwner: false, lastReadAt: null, joinedAt: new Date() };

function conversation(overrides: Record<string, unknown> = {}) {
  return {
    id: "conv-1",
    type: "CHANNEL",
    name: "trial-prep",
    description: null,
    channelKind: "MATTER",
    matterId: "m-1",
    createdById: "u-x",
    archivedAt: null,
    memberships: [membership],
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("getReadableConversation", () => {
  it("returns the conversation for an active member with matter access", async () => {
    prismaMock.chatConversation.findUnique.mockResolvedValue(conversation());
    hasMatterAccessMock.mockResolvedValue(true);
    expect(await getReadableConversation(staff, "conv-1")).toMatchObject({ id: "conv-1", membership });
  });

  it("denies a member whose matter access was revoked (membership row still present)", async () => {
    prismaMock.chatConversation.findUnique.mockResolvedValue(conversation());
    hasMatterAccessMock.mockResolvedValue(false);
    expect(await getReadableConversation(staff, "conv-1")).toBeNull();
  });

  it("re-checks matter access on every call — nothing is cached", async () => {
    prismaMock.chatConversation.findUnique.mockResolvedValue(conversation());
    hasMatterAccessMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await getReadableConversation(staff, "conv-1")).not.toBeNull();
    expect(await getReadableConversation(staff, "conv-1")).toBeNull();
  });

  it("denies non-members, including ADMIN reading someone else's DM", async () => {
    prismaMock.chatConversation.findUnique.mockResolvedValue(
      conversation({ type: "DIRECT", matterId: null, channelKind: null, memberships: [] }),
    );
    expect(await getReadableConversation(admin, "conv-1")).toBeNull();
    // Only the caller's own membership is ever loaded.
    expect(prismaMock.chatConversation.findUnique.mock.calls[0]![0].select.memberships.where).toEqual({
      userId: "u-admin",
      leftAt: null,
    });
  });

  it("treats forged / nonexistent ids and archived conversations the same as forbidden", async () => {
    prismaMock.chatConversation.findUnique.mockResolvedValue(null);
    expect(await getReadableConversation(staff, "forged")).toBeNull();
    prismaMock.chatConversation.findUnique.mockResolvedValue(conversation({ archivedAt: new Date() }));
    expect(await getReadableConversation(staff, "conv-1")).toBeNull();
  });
});

describe("canManageChannel", () => {
  it("lets ADMIN manage channel membership without being a member", async () => {
    prismaMock.chatConversation.findUnique.mockResolvedValue({ type: "CHANNEL", archivedAt: null, matterId: null, memberships: [] });
    expect(await canManageChannel(admin, "conv-1")).toBe(true);
  });

  it("lets an owner manage, but not a plain member", async () => {
    prismaMock.chatConversation.findUnique.mockResolvedValue({ type: "CHANNEL", archivedAt: null, matterId: null, memberships: [{ isOwner: true }] });
    expect(await canManageChannel(staff, "conv-1")).toBe(true);
    prismaMock.chatConversation.findUnique.mockResolvedValue({ type: "CHANNEL", archivedAt: null, matterId: null, memberships: [{ isOwner: false }] });
    expect(await canManageChannel(staff, "conv-1")).toBe(false);
  });

  it("never applies to DMs or group DMs", async () => {
    prismaMock.chatConversation.findUnique.mockResolvedValue({ type: "GROUP", archivedAt: null, matterId: null, memberships: [{ isOwner: true }] });
    expect(await canManageChannel(admin, "conv-1")).toBe(false);
  });

  it("an owner who lost matter access can no longer manage the matter channel", async () => {
    prismaMock.chatConversation.findUnique.mockResolvedValue({ type: "CHANNEL", archivedAt: null, matterId: "m-1", memberships: [{ isOwner: true }] });
    hasMatterAccessMock.mockResolvedValue(false);
    expect(await canManageChannel(staff, "conv-1")).toBe(false);
  });
});

describe("readableConversationIds", () => {
  it("drops matter channels for matters the user is no longer assigned to", async () => {
    prismaMock.chatMembership.findMany.mockResolvedValue([
      { conversationId: "dm", conversation: { matterId: null } },
      { conversationId: "mine", conversation: { matterId: "m-1" } },
      { conversationId: "revoked", conversation: { matterId: "m-2" } },
    ]);
    getAssignedMatterIdsMock.mockResolvedValue(["m-1"]);
    expect(await readableConversationIds(staff)).toEqual(["dm", "mine"]);
  });
});

describe("userHasMatterAccess", () => {
  it("is false for inactive or unknown accounts", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    expect(await userHasMatterAccess("ghost", "m-1")).toBe(false);
    prismaMock.user.findUnique.mockResolvedValue({ id: "u", role: "STAFF", status: "INACTIVE" });
    expect(await userHasMatterAccess("u", "m-1")).toBe(false);
    expect(hasMatterAccessMock).not.toHaveBeenCalled();
  });
});
