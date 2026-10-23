import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, authMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    userSession: { create: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
    userActivityEvent: { create: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/config", () => ({ auth: authMock }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const { endUserSession, expireStaleSessions, SESSION_MAX_AGE_MS, startUserSession } = await import("@/lib/usage/sessions");
const { getCurrentUser } = await import("@/lib/auth/session");

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.userActivityEvent.create.mockResolvedValue({});
  prismaMock.userSession.updateMany.mockResolvedValue({ count: 1 });
});

describe("session lifecycle", () => {
  it("starts a session at sign-in and records login + session-start events", async () => {
    prismaMock.userSession.create.mockResolvedValue({ id: "s-1" });
    expect(await startUserSession("u-1")).toBe("s-1");
    const types = prismaMock.userActivityEvent.create.mock.calls.map((c) => c[0].data.type);
    expect(types).toEqual(["LOGIN_SUCCESS", "SESSION_START"]);
  });

  it("never lets an analytics failure break sign-in", async () => {
    prismaMock.userSession.create.mockRejectedValue(new Error("db down"));
    await expect(startUserSession("u-1")).resolves.toBeNull();
  });

  it("ends a session on logout, scoped to its owner, and records LOGOUT once", async () => {
    await endUserSession("s-1", "u-1", "LOGOUT");
    expect(prismaMock.userSession.updateMany).toHaveBeenCalledWith({
      where: { id: "s-1", userId: "u-1", endedAt: null },
      data: expect.objectContaining({ endReason: "LOGOUT" }),
    });
    expect(prismaMock.userActivityEvent.create.mock.calls[0]![0].data.type).toBe("LOGOUT");

    vi.clearAllMocks();
    prismaMock.userSession.updateMany.mockResolvedValue({ count: 0 }); // already ended
    await endUserSession("s-1", "u-1", "LOGOUT");
    expect(prismaMock.userActivityEvent.create).not.toHaveBeenCalled();
  });

  it("does nothing without a session id (tokens issued before analytics existed)", async () => {
    await endUserSession(undefined, "u-1", "LOGOUT");
    expect(prismaMock.userSession.updateMany).not.toHaveBeenCalled();
  });

  it("expires sessions unseen for the JWT lifetime, ending them at their last activity", async () => {
    const now = new Date("2026-10-23T12:00:00Z");
    const lastSeenAt = new Date(now.getTime() - SESSION_MAX_AGE_MS - 60_000);
    prismaMock.userSession.findMany.mockResolvedValue([{ id: "s-old", userId: "u-1", lastSeenAt }]);
    expect(await expireStaleSessions(now)).toBe(1);
    expect(prismaMock.userSession.findMany.mock.calls[0]![0].where).toEqual({
      endedAt: null,
      lastSeenAt: { lt: new Date(now.getTime() - SESSION_MAX_AGE_MS) },
    });
    expect(prismaMock.userSession.updateMany).toHaveBeenCalledWith({
      where: { id: "s-old", endedAt: null },
      data: { endedAt: lastSeenAt, endReason: "EXPIRED" },
    });
    expect(prismaMock.userActivityEvent.create.mock.calls[0]![0].data.type).toBe("SESSION_EXPIRED");
  });
});

describe("getCurrentUser + sessions", () => {
  it("exposes the session id for analytics", async () => {
    authMock.mockResolvedValue({ user: { id: "u-1", sessionStamp: 0, sid: "s-1" } });
    prismaMock.user.findUnique.mockResolvedValue({ role: "STAFF", status: "ACTIVE", sessionInvalidatedAt: null });
    expect(await getCurrentUser()).toMatchObject({ id: "u-1", sessionId: "s-1" });
  });

  it("still refuses a revoked JWT, and closes its analytics session as REVOKED", async () => {
    authMock.mockResolvedValue({ user: { id: "u-1", sessionStamp: 1000, sid: "s-1" } });
    prismaMock.user.findUnique.mockResolvedValue({ role: "STAFF", status: "ACTIVE", sessionInvalidatedAt: new Date(5000) });
    expect(await getCurrentUser()).toBeNull();
    expect(prismaMock.userSession.updateMany).toHaveBeenCalledWith({
      where: { id: "s-1", userId: "u-1", endedAt: null },
      data: expect.objectContaining({ endReason: "REVOKED" }),
    });
  });

  it("still refuses a revoked JWT even if recording the revocation fails", async () => {
    authMock.mockResolvedValue({ user: { id: "u-1", sessionStamp: 1000, sid: "s-1" } });
    prismaMock.user.findUnique.mockResolvedValue({ role: "STAFF", status: "ACTIVE", sessionInvalidatedAt: new Date(5000) });
    prismaMock.userSession.updateMany.mockRejectedValue(new Error("db down"));
    expect(await getCurrentUser()).toBeNull();
  });
});
