import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";

const { findUniqueUserMock, isPasswordCooldownActiveMock } = vi.hoisted(() => ({
  findUniqueUserMock: vi.fn(),
  isPasswordCooldownActiveMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { user: { findUnique: findUniqueUserMock } },
}));
vi.mock("@/lib/security/password-cooldown", () => ({
  isPasswordCooldownActive: isPasswordCooldownActiveMock,
}));

const { canCompleteCredentialsSignIn, verifyPassword } = await import("@/lib/auth/credentials");
import type { VerifiedCredentialsUser } from "@/lib/auth/credentials";

function dbUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "user-1",
    name: "Demo User",
    email: "demo.user@fryelawgroup.example",
    role: "STAFF",
    active: true,
    passwordHash: "",
    mfaEnabled: false,
    mfaRequired: false,
    mustChangePassword: false,
    ...overrides,
  };
}

function user(overrides: Partial<VerifiedCredentialsUser> = {}): VerifiedCredentialsUser {
  return {
    id: "user-1",
    name: "Demo User",
    email: "demo.user@fryelawgroup.example",
    role: "STAFF",
    mfaEnabled: false,
    mfaRequired: false,
    mustChangePassword: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("verifyPassword", () => {
  it("returns the verified user for a correct password on an active account", async () => {
    const passwordHash = await bcrypt.hash("correct-password", 10);
    findUniqueUserMock.mockResolvedValueOnce(dbUser({ passwordHash }));
    isPasswordCooldownActiveMock.mockResolvedValueOnce(false);

    const result = await verifyPassword("Demo.User@FryeLawGroup.example", "correct-password");

    expect(result).toEqual({
      id: "user-1",
      name: "Demo User",
      email: "demo.user@fryelawgroup.example",
      role: "STAFF",
      mfaEnabled: false,
      mfaRequired: false,
      mustChangePassword: false,
    });
    expect(findUniqueUserMock).toHaveBeenCalledWith({ where: { email: "demo.user@fryelawgroup.example" } });
  });

  it("returns null for a wrong password", async () => {
    const passwordHash = await bcrypt.hash("correct-password", 10);
    findUniqueUserMock.mockResolvedValueOnce(dbUser({ passwordHash }));
    isPasswordCooldownActiveMock.mockResolvedValueOnce(false);

    expect(await verifyPassword("demo.user@fryelawgroup.example", "wrong-password")).toBeNull();
  });

  it("returns null for an unknown email without checking the cooldown", async () => {
    findUniqueUserMock.mockResolvedValueOnce(null);

    expect(await verifyPassword("nobody@example.com", "anything")).toBeNull();
    expect(isPasswordCooldownActiveMock).not.toHaveBeenCalled();
  });

  it("returns null for a deactivated account without checking the cooldown", async () => {
    findUniqueUserMock.mockResolvedValueOnce(dbUser({ active: false }));

    expect(await verifyPassword("demo.user@fryelawgroup.example", "anything")).toBeNull();
    expect(isPasswordCooldownActiveMock).not.toHaveBeenCalled();
  });

  it("returns null while cooling down, even with the correct password — never distinguishable from a wrong password", async () => {
    const passwordHash = await bcrypt.hash("correct-password", 10);
    findUniqueUserMock.mockResolvedValueOnce(dbUser({ passwordHash }));
    isPasswordCooldownActiveMock.mockResolvedValueOnce(true);

    expect(await verifyPassword("demo.user@fryelawgroup.example", "correct-password")).toBeNull();
  });
});

describe("canCompleteCredentialsSignIn — the actual server-side bypass guard", () => {
  it("allows a plain account with no pending gates", () => {
    expect(canCompleteCredentialsSignIn(user())).toBe(true);
  });

  it("refuses an account with mfaEnabled — no direct-request bypass of MFA", () => {
    expect(canCompleteCredentialsSignIn(user({ mfaEnabled: true }))).toBe(false);
  });

  it("refuses an account with mfaRequired but not yet enrolled", () => {
    expect(canCompleteCredentialsSignIn(user({ mfaRequired: true }))).toBe(false);
  });

  it("refuses an account with mustChangePassword — no direct-request bypass of the password-change requirement", () => {
    expect(canCompleteCredentialsSignIn(user({ mustChangePassword: true }))).toBe(false);
  });

  it("refuses when multiple gates apply at once", () => {
    expect(canCompleteCredentialsSignIn(user({ mustChangePassword: true, mfaEnabled: true }))).toBe(false);
  });
});
