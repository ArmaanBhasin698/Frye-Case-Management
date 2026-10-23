import { beforeEach, describe, expect, it, vi } from "vitest";

type Config = {
  callbacks: {
    jwt: (args: { token: Record<string, unknown>; user?: Record<string, unknown> }) => Promise<Record<string, unknown>>;
    session: (args: { session: { user: Record<string, unknown> }; token: Record<string, unknown> }) => Promise<{
      user: Record<string, unknown>;
    }>;
  };
  events: { signOut: (message: { token: Record<string, unknown> | null }) => Promise<void> };
};

const { captured, startUserSessionMock, endUserSessionMock } = vi.hoisted(() => ({
  captured: { config: null as unknown },
  startUserSessionMock: vi.fn(),
  endUserSessionMock: vi.fn(),
}));

vi.mock("next-auth", () => ({
  default: (config: unknown) => {
    captured.config = config;
    return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
  },
}));
vi.mock("next-auth/providers/credentials", () => ({ default: (options: unknown) => options }));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/auth/credentials", () => ({ canCompleteCredentialsSignIn: vi.fn(), verifyPassword: vi.fn() }));
vi.mock("@/lib/auth/mfa/tickets", () => ({ consumeVerifiedTicket: vi.fn() }));
vi.mock("@/lib/usage/sessions", () => ({ startUserSession: startUserSessionMock, endUserSession: endUserSessionMock }));

await import("@/lib/auth/config");
const config = captured.config as Config;

beforeEach(() => vi.clearAllMocks());

describe("Auth.js callbacks — session analytics", () => {
  it("starts a UserSession only when a sign-in has just completed, and carries it as sid", async () => {
    startUserSessionMock.mockResolvedValue("s-new");
    const token = await config.callbacks.jwt({ token: {}, user: { id: "u-1", role: "STAFF", sessionStamp: 0 } });
    expect(startUserSessionMock).toHaveBeenCalledWith("u-1");
    expect(token).toMatchObject({ id: "u-1", role: "STAFF", sid: "s-new" });
  });

  it("does not start a new session on ordinary token refreshes", async () => {
    const token = await config.callbacks.jwt({ token: { id: "u-1", sid: "s-old" } });
    expect(startUserSessionMock).not.toHaveBeenCalled();
    expect(token.sid).toBe("s-old");
  });

  it("still signs the user in when analytics fails (no sid)", async () => {
    startUserSessionMock.mockResolvedValue(null);
    const token = await config.callbacks.jwt({ token: {}, user: { id: "u-1", role: "STAFF", sessionStamp: 0 } });
    expect(token).toMatchObject({ id: "u-1" });
    expect(token.sid).toBeUndefined();
  });

  it("copies sid into the session", async () => {
    const session = await config.callbacks.session({ session: { user: {} }, token: { id: "u-1", role: "STAFF", sessionStamp: 0, sid: "s-1" } });
    expect(session.user.sid).toBe("s-1");
  });

  it("ends the session on sign-out", async () => {
    await config.events.signOut({ token: { id: "u-1", sid: "s-1" } });
    expect(endUserSessionMock).toHaveBeenCalledWith("s-1", "u-1", "LOGOUT");
  });
});
