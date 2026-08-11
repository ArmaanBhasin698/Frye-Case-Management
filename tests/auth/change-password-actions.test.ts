import { beforeEach, describe, expect, it, vi } from "vitest";

class FakeAuthError extends Error {}
vi.mock("next-auth", () => ({ AuthError: FakeAuthError }));

const { prismaMock, verifyPasswordMock, routeAfterPasswordVerifiedMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { update: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
  verifyPasswordMock: vi.fn(),
  routeAfterPasswordVerifiedMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/credentials", () => ({ verifyPassword: verifyPasswordMock }));
vi.mock("@/lib/auth/login-flow", () => ({ routeAfterPasswordVerified: routeAfterPasswordVerifiedMock }));

const { changePassword } = await import("@/app/(auth)/login/change-password/actions");

const verifiedUser = {
  id: "user-1",
  name: "Demo User",
  email: "demo.user@fryelawgroup.example",
  role: "STAFF" as const,
  mfaEnabled: false,
  mfaRequired: false,
  mustChangePassword: true,
};

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("changePassword", () => {
  it("rejects an incorrect current password without touching the database", async () => {
    verifyPasswordMock.mockResolvedValueOnce(null);

    const result = await changePassword(
      undefined,
      formData({
        email: "demo.user@fryelawgroup.example",
        currentPassword: "wrong-temp-password",
        newPassword: "a-strong-new-password-123",
        confirmNewPassword: "a-strong-new-password-123",
      }),
    );

    expect(result).toMatch(/incorrect email or current password/i);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(routeAfterPasswordVerifiedMock).not.toHaveBeenCalled();
  });

  it("rejects mismatched new-password confirmation", async () => {
    const result = await changePassword(
      undefined,
      formData({
        email: "demo.user@fryelawgroup.example",
        currentPassword: "temp-password",
        newPassword: "a-strong-new-password-123",
        confirmNewPassword: "does-not-match-456789",
      }),
    );

    expect(result).toMatch(/don't match/i);
    expect(verifyPasswordMock).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("rejects a new password shorter than the minimum", async () => {
    const result = await changePassword(
      undefined,
      formData({
        email: "demo.user@fryelawgroup.example",
        currentPassword: "temp-password",
        newPassword: "short",
        confirmNewPassword: "short",
      }),
    );

    expect(result).toMatch(/at least 12 characters/i);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("rejects reusing the current password as the new one", async () => {
    verifyPasswordMock.mockResolvedValueOnce(verifiedUser);

    const result = await changePassword(
      undefined,
      formData({
        email: "demo.user@fryelawgroup.example",
        currentPassword: "temp-password-123",
        newPassword: "temp-password-123",
        confirmNewPassword: "temp-password-123",
      }),
    );

    expect(result).toMatch(/different password/i);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("on success: updates the hash, clears mustChangePassword, audits without the password, and routes onward", async () => {
    verifyPasswordMock.mockResolvedValueOnce(verifiedUser);

    await changePassword(
      undefined,
      formData({
        email: "demo.user@fryelawgroup.example",
        currentPassword: "temp-password-123",
        newPassword: "a-brand-new-password-999",
        confirmNewPassword: "a-brand-new-password-999",
        callbackUrl: "/matters",
      }),
    );

    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { passwordHash: expect.any(String), mustChangePassword: false },
    });
    const passwordHash = prismaMock.user.update.mock.calls[0]![0].data.passwordHash;
    expect(passwordHash).not.toContain("a-brand-new-password-999");

    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: {
        actorId: "user-1",
        action: "UPDATE",
        entityType: "User",
        entityId: "user-1",
        metadata: { event: "password_changed_first_login" },
      },
    });
    const auditPayload = JSON.stringify(prismaMock.auditEvent.create.mock.calls[0]![0]);
    expect(auditPayload).not.toContain("a-brand-new-password-999");

    expect(routeAfterPasswordVerifiedMock).toHaveBeenCalledWith(
      { ...verifiedUser, mustChangePassword: false },
      "a-brand-new-password-999",
      "/matters",
    );
  });

  it("surfaces a downstream AuthError as a generic message rather than throwing", async () => {
    verifyPasswordMock.mockResolvedValueOnce(verifiedUser);
    routeAfterPasswordVerifiedMock.mockRejectedValueOnce(new FakeAuthError("boom"));

    const result = await changePassword(
      undefined,
      formData({
        email: "demo.user@fryelawgroup.example",
        currentPassword: "temp-password-123",
        newPassword: "a-brand-new-password-999",
        confirmNewPassword: "a-brand-new-password-999",
      }),
    );

    expect(result).toMatch(/went wrong/i);
  });

  it("lets a genuine redirect (the success path) propagate rather than swallowing it", async () => {
    verifyPasswordMock.mockResolvedValueOnce(verifiedUser);
    routeAfterPasswordVerifiedMock.mockRejectedValueOnce(new Error("NEXT_REDIRECT:/login/mfa"));

    await expect(
      changePassword(
        undefined,
        formData({
          email: "demo.user@fryelawgroup.example",
          currentPassword: "temp-password-123",
          newPassword: "a-brand-new-password-999",
          confirmNewPassword: "a-brand-new-password-999",
        }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT:/login/mfa");
  });
});
