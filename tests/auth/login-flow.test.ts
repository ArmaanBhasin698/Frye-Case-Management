import { beforeEach, describe, expect, it, vi } from "vitest";

const { signInMock, createPendingTicketMock, redirectMock } = vi.hoisted(() => ({
  signInMock: vi.fn(),
  createPendingTicketMock: vi.fn(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/auth/config", () => ({ signIn: signInMock }));
vi.mock("@/lib/auth/mfa/tickets", () => ({ createPendingTicket: createPendingTicketMock }));

const { routeAfterPasswordVerified } = await import("@/lib/auth/login-flow");
import type { VerifiedCredentialsUser } from "@/lib/auth/credentials";

function user(overrides: Partial<VerifiedCredentialsUser> = {}): VerifiedCredentialsUser {
  return {
    id: "user-1",
    name: "Demo User",
    email: "demo.user@fryelawgroup.example",
    role: "STAFF",
    mfaEnabled: false,
    mfaRequired: false,
    mustChangePassword: false,
    sessionStamp: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("routeAfterPasswordVerified — gate ordering", () => {
  it("signs in directly when no gate applies — unaffected accounts keep working exactly as before", async () => {
    await routeAfterPasswordVerified(user(), "correct-password", "/matters");

    expect(signInMock).toHaveBeenCalledWith("credentials", {
      email: "demo.user@fryelawgroup.example",
      password: "correct-password",
      redirectTo: "/matters",
    });
    expect(createPendingTicketMock).not.toHaveBeenCalled();
  });

  it("routes to change-password BEFORE the MFA gate when both apply", async () => {
    await expect(
      routeAfterPasswordVerified(user({ mustChangePassword: true, mfaEnabled: true }), "temp-password", "/"),
    ).rejects.toThrow(/NEXT_REDIRECT:\/login\/change-password/);

    // Neither MFA branch nor signIn should have run — password change wins the race.
    expect(createPendingTicketMock).not.toHaveBeenCalled();
    expect(signInMock).not.toHaveBeenCalled();
  });

  it("routes to change-password alone when only that gate applies, never calling signIn", async () => {
    await expect(
      routeAfterPasswordVerified(user({ mustChangePassword: true }), "temp-password", "/"),
    ).rejects.toThrow("NEXT_REDIRECT:/login/change-password?email=demo.user%40fryelawgroup.example&callbackUrl=%2F");

    expect(signInMock).not.toHaveBeenCalled();
  });

  it("routes to the MFA challenge once password-change is satisfied", async () => {
    await expect(routeAfterPasswordVerified(user({ mfaEnabled: true }), "password", "/")).rejects.toThrow(
      "NEXT_REDIRECT:/login/mfa?callbackUrl=%2F",
    );

    expect(createPendingTicketMock).toHaveBeenCalledWith("user-1");
    expect(signInMock).not.toHaveBeenCalled();
  });

  it("routes to forced MFA setup when required but not yet enrolled", async () => {
    await expect(routeAfterPasswordVerified(user({ mfaRequired: true }), "password", "/")).rejects.toThrow(
      "NEXT_REDIRECT:/login/mfa/setup?callbackUrl=%2F",
    );
  });

  it("never establishes a session by itself — signIn is the only call that can, and only on the no-gate path", async () => {
    await routeAfterPasswordVerified(user(), "password", "/");
    expect(signInMock).toHaveBeenCalledTimes(1);
  });
});
