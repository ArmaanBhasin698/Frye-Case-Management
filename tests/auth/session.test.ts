import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, prismaMock, redirectMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: { user: { findUnique: vi.fn() } },
  redirectMock: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/auth/config", () => ({ auth: authMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

const { getCurrentUser, requireCurrentUser } = await import("@/lib/auth/session");

function session(overrides: Partial<{ id: string; name: string; email: string; sessionStamp: number }> = {}) {
  return {
    user: {
      id: "user-1",
      name: "Demo User",
      email: "demo.user@fryelawgroup.example",
      sessionStamp: 0,
      ...overrides,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getCurrentUser", () => {
  it("returns null when there is no session at all", async () => {
    authMock.mockResolvedValueOnce(null);
    expect(await getCurrentUser()).toBeNull();
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it("returns null when the session's own user id no longer resolves in the database", async () => {
    authMock.mockResolvedValueOnce(session());
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    expect(await getCurrentUser()).toBeNull();
  });

  it("returns null for a deactivated account, even with an otherwise-valid, unexpired JWT session", async () => {
    authMock.mockResolvedValueOnce(session());
    prismaMock.user.findUnique.mockResolvedValueOnce({ role: "STAFF", status: "INACTIVE", sessionInvalidatedAt: null });
    expect(await getCurrentUser()).toBeNull();
  });

  it("returns null for a PENDING account", async () => {
    authMock.mockResolvedValueOnce(session());
    prismaMock.user.findUnique.mockResolvedValueOnce({ role: "STAFF", status: "PENDING", sessionInvalidatedAt: null });
    expect(await getCurrentUser()).toBeNull();
  });

  it("returns null when the account was invalidated (deactivated/password reset) after this session was issued", async () => {
    authMock.mockResolvedValueOnce(session({ sessionStamp: 1000 }));
    prismaMock.user.findUnique.mockResolvedValueOnce({
      role: "STAFF",
      status: "ACTIVE",
      sessionInvalidatedAt: new Date(2000), // newer than the session's own stamp
    });
    expect(await getCurrentUser()).toBeNull();
  });

  it("returns the user when the session's stamp is at or after the account's last invalidation", async () => {
    authMock.mockResolvedValueOnce(session({ sessionStamp: 5000 }));
    prismaMock.user.findUnique.mockResolvedValueOnce({
      role: "STAFF",
      status: "ACTIVE",
      sessionInvalidatedAt: new Date(1000),
    });
    const result = await getCurrentUser();
    expect(result).toEqual({
      id: "user-1",
      name: "Demo User",
      email: "demo.user@fryelawgroup.example",
      role: "STAFF",
    });
  });

  it("does not fail open for a pre-existing session with no sessionStamp claim at all (issued before this feature shipped)", async () => {
    // A session cookie minted before this mechanism existed has no
    // `sessionStamp` in its JWT — `session.user.sessionStamp` is
    // `undefined` at runtime despite the type. Without treating that as
    // 0, `invalidatedAt > undefined` is always false in JS, silently
    // defeating any later invalidation for that session's whole
    // remaining lifetime.
    authMock.mockResolvedValueOnce({
      user: { id: "user-1", name: "Demo User", email: "demo.user@fryelawgroup.example", sessionStamp: undefined },
    });
    prismaMock.user.findUnique.mockResolvedValueOnce({
      role: "STAFF",
      status: "ACTIVE",
      sessionInvalidatedAt: new Date(1000),
    });
    expect(await getCurrentUser()).toBeNull();
  });

  it("still trusts a stampless session on an account that has never been invalidated", async () => {
    authMock.mockResolvedValueOnce({
      user: { id: "user-1", name: "Demo User", email: "demo.user@fryelawgroup.example", sessionStamp: undefined },
    });
    prismaMock.user.findUnique.mockResolvedValueOnce({ role: "STAFF", status: "ACTIVE", sessionInvalidatedAt: null });
    expect(await getCurrentUser()).not.toBeNull();
  });

  it("returns the user when the account has never been invalidated (sessionInvalidatedAt is null)", async () => {
    authMock.mockResolvedValueOnce(session({ sessionStamp: 0 }));
    prismaMock.user.findUnique.mockResolvedValueOnce({ role: "ADMIN", status: "ACTIVE", sessionInvalidatedAt: null });
    const result = await getCurrentUser();
    expect(result?.role).toBe("ADMIN");
  });

  it("reflects the account's CURRENT role from the database, not whatever role the JWT was issued with — a promotion/demotion takes effect on the very next request", async () => {
    authMock.mockResolvedValueOnce(session({ sessionStamp: 100 }));
    prismaMock.user.findUnique.mockResolvedValueOnce({
      role: "ADMIN", // changed since sign-in; the stale JWT claim (not exposed here) would have said STAFF
      status: "ACTIVE",
      sessionInvalidatedAt: null,
    });
    const result = await getCurrentUser();
    expect(result?.role).toBe("ADMIN");
  });
});

describe("requireCurrentUser", () => {
  it("redirects to /login when there is no valid current user", async () => {
    authMock.mockResolvedValueOnce(null);
    await expect(requireCurrentUser()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/login");
  });

  it("redirects to /login for a since-deactivated account, not just a missing session", async () => {
    authMock.mockResolvedValueOnce(session());
    prismaMock.user.findUnique.mockResolvedValueOnce({ role: "STAFF", status: "INACTIVE", sessionInvalidatedAt: null });
    await expect(requireCurrentUser()).rejects.toThrow("NEXT_REDIRECT");
  });

  it("returns the user when valid", async () => {
    authMock.mockResolvedValueOnce(session());
    prismaMock.user.findUnique.mockResolvedValueOnce({ role: "STAFF", status: "ACTIVE", sessionInvalidatedAt: null });
    const result = await requireCurrentUser();
    expect(result.id).toBe("user-1");
  });
});
