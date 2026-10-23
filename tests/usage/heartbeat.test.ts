import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentUserMock, hasMatterAccessMock, prismaMock } = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  hasMatterAccessMock: vi.fn(),
  prismaMock: {
    userActivityMinute: { upsert: vi.fn() },
    userSession: { updateMany: vi.fn() },
    userActivityEvent: { create: vi.fn() },
  },
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: getCurrentUserMock }));
vi.mock("@/lib/auth/access", () => ({ hasMatterAccess: hasMatterAccessMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

const { POST } = await import("@/app/api/activity/heartbeat/route");

const user = { id: "u-staff", role: "STAFF" as const, sessionId: "s-1" };

function beat(body: unknown, headers: Record<string, string> = { origin: "http://localhost", host: "localhost" }) {
  return POST(
    new NextRequest("http://localhost/api/activity/heartbeat", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUserMock.mockResolvedValue(user);
  hasMatterAccessMock.mockResolvedValue(true);
  prismaMock.userActivityMinute.upsert.mockResolvedValue({});
  prismaMock.userSession.updateMany.mockResolvedValue({ count: 1 });
});

describe("activity heartbeat", () => {
  it("answers 401 without a session and writes nothing", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    expect((await beat({ module: "matters" })).status).toBe(401);
    expect(prismaMock.userActivityMinute.upsert).not.toHaveBeenCalled();
  });

  it("rejects cross-origin requests", async () => {
    expect((await beat({ module: "matters" }, { origin: "https://evil.example", host: "localhost" })).status).toBe(403);
    expect((await beat({ module: "matters" }, { "sec-fetch-site": "cross-site", host: "localhost" })).status).toBe(403);
    expect(prismaMock.userActivityMinute.upsert).not.toHaveBeenCalled();
  });

  it("rejects malformed or unexpected bodies", async () => {
    expect((await beat("not json")).status).toBe(400);
    expect((await beat({ module: "keystrokes" })).status).toBe(400);
    expect((await beat({ module: "matters", matterId: "x'; drop table" })).status).toBe(400);
  });

  it("upserts one row per user-minute, so multiple tabs never double count", async () => {
    expect((await beat({ module: "contacts" })).status).toBe(200);
    const call = prismaMock.userActivityMinute.upsert.mock.calls[0]![0];
    expect(call.where.userId_minute.userId).toBe("u-staff");
    expect(call.where.userId_minute.minute.getUTCSeconds()).toBe(0);
    expect(call.create).toMatchObject({ module: "contacts", matterId: null, sessionId: "s-1" });
    expect(prismaMock.userSession.updateMany).toHaveBeenCalledWith({
      where: { id: "s-1", userId: "u-staff", endedAt: null },
      data: { lastSeenAt: expect.any(Date) },
    });
  });

  it("drops a matter id the user can't access", async () => {
    hasMatterAccessMock.mockResolvedValue(false);
    await beat({ module: "matters", matterId: "m-secret" });
    expect(prismaMock.userActivityMinute.upsert.mock.calls[0]![0].create.matterId).toBeNull();
  });

  it("keeps an accessible matter id for matter-focused estimates", async () => {
    await beat({ module: "matters", matterId: "m-1" });
    expect(hasMatterAccessMock).toHaveBeenCalledWith(user, "m-1");
    expect(prismaMock.userActivityMinute.upsert.mock.calls[0]![0].create.matterId).toBe("m-1");
  });
});
