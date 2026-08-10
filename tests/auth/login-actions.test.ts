import { beforeEach, describe, expect, it, vi } from "vitest";

class FakeAuthError extends Error {
  type: string;
  constructor(type: string) {
    super(type);
    this.type = type;
  }
}
vi.mock("next-auth", () => ({ AuthError: FakeAuthError }));

const { verifyPasswordMock, signInMock, createPendingTicketMock, redirectMock } = vi.hoisted(() => ({
  verifyPasswordMock: vi.fn(),
  signInMock: vi.fn(),
  createPendingTicketMock: vi.fn(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/auth/config", () => ({ signIn: signInMock }));
vi.mock("@/lib/auth/credentials", () => ({ verifyPassword: verifyPasswordMock }));
vi.mock("@/lib/auth/mfa/tickets", () => ({ createPendingTicket: createPendingTicketMock }));

const { authenticate } = await import("@/app/(auth)/login/actions");

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("authenticate — password step routing", () => {
  it("returns a generic error for a wrong password, without creating any MFA state", async () => {
    verifyPasswordMock.mockResolvedValueOnce(null);
    const result = await authenticate(undefined, formData({ email: "x@example.com", password: "wrong" }));
    expect(result).toMatch(/invalid email or password/i);
    expect(createPendingTicketMock).not.toHaveBeenCalled();
    expect(signInMock).not.toHaveBeenCalled();
  });

  it("signs in directly for a correct password with no MFA in play — unchanged for non-MFA users", async () => {
    verifyPasswordMock.mockResolvedValueOnce({
      id: "user-1",
      email: "x@example.com",
      role: "STAFF",
      mfaEnabled: false,
      mfaRequired: false,
    });

    await authenticate(undefined, formData({ email: "x@example.com", password: "correct", callbackUrl: "/matters" }));

    expect(signInMock).toHaveBeenCalledWith("credentials", {
      email: "x@example.com",
      password: "correct",
      redirectTo: "/matters",
    });
    expect(createPendingTicketMock).not.toHaveBeenCalled();
  });

  it("never calls signIn for an MFA-enabled account — no password-only session is created", async () => {
    verifyPasswordMock.mockResolvedValueOnce({
      id: "user-1",
      email: "x@example.com",
      role: "STAFF",
      mfaEnabled: true,
      mfaRequired: false,
    });

    await expect(
      authenticate(undefined, formData({ email: "x@example.com", password: "correct", callbackUrl: "/matters" })),
    ).rejects.toThrow("NEXT_REDIRECT:/login/mfa?callbackUrl=%2Fmatters");

    expect(createPendingTicketMock).toHaveBeenCalledWith("user-1");
    expect(signInMock).not.toHaveBeenCalled();
  });

  it("routes a required-but-unenrolled account to forced setup, still without calling signIn", async () => {
    verifyPasswordMock.mockResolvedValueOnce({
      id: "user-2",
      email: "y@example.com",
      role: "STAFF",
      mfaEnabled: false,
      mfaRequired: true,
    });

    await expect(authenticate(undefined, formData({ email: "y@example.com", password: "correct" }))).rejects.toThrow(
      "NEXT_REDIRECT:/login/mfa/setup?callbackUrl=%2F",
    );

    expect(createPendingTicketMock).toHaveBeenCalledWith("user-2");
    expect(signInMock).not.toHaveBeenCalled();
  });

  it("surfaces a CredentialsSignin AuthError as the same generic message", async () => {
    verifyPasswordMock.mockResolvedValueOnce({
      id: "user-1",
      email: "x@example.com",
      role: "STAFF",
      mfaEnabled: false,
      mfaRequired: false,
    });
    signInMock.mockRejectedValueOnce(new FakeAuthError("CredentialsSignin"));

    const result = await authenticate(undefined, formData({ email: "x@example.com", password: "correct" }));
    expect(result).toMatch(/invalid email or password/i);
  });
});
