import { beforeEach, describe, expect, it, vi } from "vitest";

class FakeAuthError extends Error {}
vi.mock("next-auth", () => ({ AuthError: FakeAuthError }));

const {
  prismaMock,
  requireCurrentUserMock,
  verifyPasswordMock,
  signInMock,
  redirectMock,
  revalidatePathMock,
  readPendingTicketMock,
  clearPendingTicketMock,
  completeChallengeMock,
  createEnrollmentTicketMock,
  readEnrollmentTicketMock,
  consumeEnrollmentTicketMock,
  clearEnrollmentTicketMock,
  buildOtpAuthUriMock,
  generateTotpSecretMock,
  verifyAndConsumeTotpMock,
  verifyEnrollmentCodeMock,
  encryptSecretMock,
  decryptSecretMock,
  generateRecoveryCodesMock,
  replaceRecoveryCodesMock,
  verifyAndConsumeRecoveryCodeMock,
  isLockedOutMock,
  recordFailedMfaAttemptMock,
  resetMfaAttemptsMock,
} = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn(), update: vi.fn() },
    mfaRecoveryCode: { deleteMany: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
  requireCurrentUserMock: vi.fn(),
  verifyPasswordMock: vi.fn(),
  signInMock: vi.fn(),
  redirectMock: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
  revalidatePathMock: vi.fn(),
  readPendingTicketMock: vi.fn(),
  clearPendingTicketMock: vi.fn(),
  completeChallengeMock: vi.fn(),
  createEnrollmentTicketMock: vi.fn(),
  readEnrollmentTicketMock: vi.fn(),
  consumeEnrollmentTicketMock: vi.fn(),
  clearEnrollmentTicketMock: vi.fn(),
  buildOtpAuthUriMock: vi.fn(() => "otpauth://totp/fake"),
  generateTotpSecretMock: vi.fn(() => "FAKESECRET"),
  verifyAndConsumeTotpMock: vi.fn(),
  verifyEnrollmentCodeMock: vi.fn(),
  encryptSecretMock: vi.fn((s: string) => `enc(${s})`),
  decryptSecretMock: vi.fn((s: string) => s.replace(/^enc\(/, "").replace(/\)$/, "")),
  generateRecoveryCodesMock: vi.fn(() => ["AAAA-BBBB-CCCC", "DDDD-EEEE-FFFF"]),
  replaceRecoveryCodesMock: vi.fn(),
  verifyAndConsumeRecoveryCodeMock: vi.fn(),
  isLockedOutMock: vi.fn(() => false),
  recordFailedMfaAttemptMock: vi.fn(),
  resetMfaAttemptsMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/config", () => ({ signIn: signInMock }));
vi.mock("@/lib/auth/session", () => ({ requireCurrentUser: requireCurrentUserMock }));
vi.mock("@/lib/auth/credentials", () => ({ verifyPassword: verifyPasswordMock }));
vi.mock("@/lib/auth/mfa/tickets", () => ({
  readPendingTicket: readPendingTicketMock,
  clearPendingTicket: clearPendingTicketMock,
  completeChallenge: completeChallengeMock,
  createEnrollmentTicket: createEnrollmentTicketMock,
  readEnrollmentTicket: readEnrollmentTicketMock,
  consumeEnrollmentTicket: consumeEnrollmentTicketMock,
  clearEnrollmentTicket: clearEnrollmentTicketMock,
}));
vi.mock("@/lib/auth/mfa/totp", () => ({
  buildOtpAuthUri: buildOtpAuthUriMock,
  generateTotpSecret: generateTotpSecretMock,
  verifyAndConsumeTotp: verifyAndConsumeTotpMock,
  verifyEnrollmentCode: verifyEnrollmentCodeMock,
}));
vi.mock("@/lib/auth/mfa/crypto", () => ({
  encryptSecret: encryptSecretMock,
  decryptSecret: decryptSecretMock,
}));
vi.mock("@/lib/auth/mfa/recovery-codes", () => ({
  generateRecoveryCodes: generateRecoveryCodesMock,
  replaceRecoveryCodes: replaceRecoveryCodesMock,
  verifyAndConsumeRecoveryCode: verifyAndConsumeRecoveryCodeMock,
}));
vi.mock("@/lib/auth/mfa/lockout", () => ({
  isLockedOut: isLockedOutMock,
  recordFailedMfaAttempt: recordFailedMfaAttemptMock,
  resetMfaAttempts: resetMfaAttemptsMock,
}));

const {
  adminResetMfa,
  confirmForcedEnrollment,
  confirmSelfEnrollment,
  disableMfa,
  finishForcedEnrollment,
  regenerateRecoveryCodes,
  verifyMfaChallenge,
} = await import("@/lib/auth/mfa/actions");

const mfaUser = {
  id: "user-1",
  email: "demo.user@fryelawgroup.example",
  active: true,
  mfaEnabled: true,
  totpSecretEncrypted: "enc(FAKESECRET)",
  totpLastUsedStep: null,
};

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  isLockedOutMock.mockResolvedValue(false);
});

describe("verifyMfaChallenge (login-time second factor)", () => {
  it("redirects to /login when there is no pending ticket — no forging a challenge session out of thin air", async () => {
    readPendingTicketMock.mockResolvedValueOnce(null);
    await expect(verifyMfaChallenge(undefined, formData({ code: "123456" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/login");
  });

  it("rejects an invalid TOTP code and records the failed attempt", async () => {
    readPendingTicketMock.mockResolvedValueOnce({ id: "pending-1", userId: "user-1" });
    prismaMock.user.findUnique.mockResolvedValueOnce(mfaUser);
    verifyAndConsumeTotpMock.mockResolvedValueOnce(false);

    const result = await verifyMfaChallenge(undefined, formData({ code: "000000" }));
    expect(result).toMatch(/invalid/i);
    expect(recordFailedMfaAttemptMock).toHaveBeenCalledWith("user-1");
    expect(signInMock).not.toHaveBeenCalled();
  });

  it("completes sign-in on a valid TOTP code — the only path that reaches signIn", async () => {
    readPendingTicketMock.mockResolvedValueOnce({ id: "pending-1", userId: "user-1" });
    prismaMock.user.findUnique.mockResolvedValueOnce(mfaUser);
    verifyAndConsumeTotpMock.mockResolvedValueOnce(true);
    completeChallengeMock.mockResolvedValueOnce("verified-1");

    await verifyMfaChallenge(undefined, formData({ code: "123456", callbackUrl: "/matters" }));

    expect(resetMfaAttemptsMock).toHaveBeenCalledWith("user-1");
    expect(completeChallengeMock).toHaveBeenCalledWith("pending-1", "user-1");
    expect(clearPendingTicketMock).toHaveBeenCalled();
    expect(signInMock).toHaveBeenCalledWith("mfa-complete", { ticket: "verified-1", redirectTo: "/matters" });
  });

  it("routes a recovery-code-shaped submission to recovery-code verification, not TOTP", async () => {
    readPendingTicketMock.mockResolvedValueOnce({ id: "pending-1", userId: "user-1" });
    prismaMock.user.findUnique.mockResolvedValueOnce(mfaUser);
    verifyAndConsumeRecoveryCodeMock.mockResolvedValueOnce(true);
    completeChallengeMock.mockResolvedValueOnce("verified-1");

    await verifyMfaChallenge(undefined, formData({ code: "AAAA-BBBB-CCCC", callbackUrl: "/" }));

    expect(verifyAndConsumeTotpMock).not.toHaveBeenCalled();
    expect(verifyAndConsumeRecoveryCodeMock).toHaveBeenCalledWith("user-1", "AAAA-BBBB-CCCC");
    expect(signInMock).toHaveBeenCalled();
  });

  it("refuses to even attempt verification while locked out", async () => {
    readPendingTicketMock.mockResolvedValueOnce({ id: "pending-1", userId: "user-1" });
    prismaMock.user.findUnique.mockResolvedValueOnce(mfaUser);
    isLockedOutMock.mockResolvedValueOnce(true);

    const result = await verifyMfaChallenge(undefined, formData({ code: "123456" }));
    expect(result).toMatch(/too many/i);
    expect(verifyAndConsumeTotpMock).not.toHaveBeenCalled();
  });

  it("clears the pending ticket and bounces to /login if the account is no longer MFA-enabled", async () => {
    readPendingTicketMock.mockResolvedValueOnce({ id: "pending-1", userId: "user-1" });
    prismaMock.user.findUnique.mockResolvedValueOnce({ ...mfaUser, mfaEnabled: false });

    await expect(verifyMfaChallenge(undefined, formData({ code: "123456" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(clearPendingTicketMock).toHaveBeenCalled();
  });
});

describe("confirmSelfEnrollment (self-service, already authenticated)", () => {
  const sessionUser = { id: "user-1", role: "STAFF" as const };

  it("enables MFA and returns fresh recovery codes on a valid confirmation code", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(sessionUser);
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: "user-1", mfaEnabled: false });
    readEnrollmentTicketMock.mockResolvedValueOnce({ id: "enroll-1", encryptedSecret: "enc(FAKESECRET)" });
    verifyEnrollmentCodeMock.mockResolvedValueOnce(42);
    consumeEnrollmentTicketMock.mockResolvedValueOnce(true);

    const result = await confirmSelfEnrollment(undefined, formData({ code: "123456" }));

    expect(result).toEqual({ status: "success", recoveryCodes: ["AAAA-BBBB-CCCC", "DDDD-EEEE-FFFF"] });
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ mfaEnabled: true, totpLastUsedStep: 42 }) }),
    );
    expect(replaceRecoveryCodesMock).toHaveBeenCalledWith("user-1", ["AAAA-BBBB-CCCC", "DDDD-EEEE-FFFF"]);
  });

  it("rejects an invalid confirmation code and never enables MFA", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(sessionUser);
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: "user-1", mfaEnabled: false });
    readEnrollmentTicketMock.mockResolvedValueOnce({ id: "enroll-1", encryptedSecret: "enc(FAKESECRET)" });
    verifyEnrollmentCodeMock.mockResolvedValueOnce(null);

    const result = await confirmSelfEnrollment(undefined, formData({ code: "000000" }));

    expect(result).toEqual({ status: "error", message: expect.stringMatching(/invalid/i) });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(replaceRecoveryCodesMock).not.toHaveBeenCalled();
  });

  it("refuses to re-enroll an account that already has MFA enabled", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(sessionUser);
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: "user-1", mfaEnabled: true });

    const result = await confirmSelfEnrollment(undefined, formData({ code: "123456" }));
    expect(result).toEqual({ status: "error", message: expect.stringMatching(/already enabled/i) });
  });
});

describe("confirmForcedEnrollment / finishForcedEnrollment (pre-session, mfaRequired)", () => {
  it("enables MFA on valid confirmation but does not by itself complete sign-in", async () => {
    readPendingTicketMock.mockResolvedValueOnce({ id: "pending-1", userId: "user-1" });
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: "user-1", active: true, mfaEnabled: false });
    readEnrollmentTicketMock.mockResolvedValueOnce({ id: "enroll-1", encryptedSecret: "enc(FAKESECRET)" });
    verifyEnrollmentCodeMock.mockResolvedValueOnce(7);
    consumeEnrollmentTicketMock.mockResolvedValueOnce(true);

    const result = await confirmForcedEnrollment(undefined, formData({ code: "123456" }));

    expect(result.status).toBe("success");
    expect(signInMock).not.toHaveBeenCalled();
  });

  it("finishForcedEnrollment consumes the pending ticket to complete sign-in only after enrollment succeeded", async () => {
    readPendingTicketMock.mockResolvedValueOnce({ id: "pending-1", userId: "user-1" });
    completeChallengeMock.mockResolvedValueOnce("verified-1");

    await finishForcedEnrollment(formData({ callbackUrl: "/" }));

    expect(completeChallengeMock).toHaveBeenCalledWith("pending-1", "user-1");
    expect(signInMock).toHaveBeenCalledWith("mfa-complete", { ticket: "verified-1", redirectTo: "/" });
  });

  it("finishForcedEnrollment redirects to /login instead of completing sign-in with no pending ticket", async () => {
    readPendingTicketMock.mockResolvedValueOnce(null);
    await expect(finishForcedEnrollment(formData({ callbackUrl: "/" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(signInMock).not.toHaveBeenCalled();
  });
});

describe("disableMfa / regenerateRecoveryCodes (re-auth required)", () => {
  const sessionUser = { id: "user-1", role: "STAFF" as const };
  const enabledUser = {
    id: "user-1",
    email: "demo.user@fryelawgroup.example",
    active: true,
    mfaEnabled: true,
    totpSecretEncrypted: "enc(FAKESECRET)",
    totpLastUsedStep: null,
  };

  it("rejects disable with the wrong password, without ever checking the code", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(sessionUser);
    prismaMock.user.findUnique.mockResolvedValueOnce(enabledUser);
    verifyPasswordMock.mockResolvedValueOnce(null);

    const result = await disableMfa(undefined, formData({ password: "wrong", code: "123456" }));
    expect(result).toMatch(/incorrect password/i);
    expect(verifyAndConsumeTotpMock).not.toHaveBeenCalled();
  });

  it("disables MFA and wipes recovery codes on correct password + valid code", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(sessionUser);
    prismaMock.user.findUnique.mockResolvedValueOnce(enabledUser);
    verifyPasswordMock.mockResolvedValueOnce({ id: "user-1" });
    verifyAndConsumeTotpMock.mockResolvedValueOnce(true);

    await disableMfa(undefined, formData({ password: "correct", code: "123456" }));

    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { mfaEnabled: false, totpSecretEncrypted: null, totpLastUsedStep: null },
      }),
    );
    expect(prismaMock.mfaRecoveryCode.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-1" } });
  });

  it("regenerates recovery codes only after re-verifying password and code", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(sessionUser);
    prismaMock.user.findUnique.mockResolvedValueOnce(enabledUser);
    verifyPasswordMock.mockResolvedValueOnce({ id: "user-1" });
    verifyAndConsumeTotpMock.mockResolvedValueOnce(true);

    const result = await regenerateRecoveryCodes(undefined, formData({ password: "correct", code: "123456" }));

    expect(result).toEqual({ status: "success", recoveryCodes: ["AAAA-BBBB-CCCC", "DDDD-EEEE-FFFF"] });
    expect(replaceRecoveryCodesMock).toHaveBeenCalledWith("user-1", ["AAAA-BBBB-CCCC", "DDDD-EEEE-FFFF"]);
  });
});

describe("no MFA secrets/codes/tickets ever appear in an audit event", () => {
  it("keeps enrollment audit metadata to booleans/counts only", async () => {
    requireCurrentUserMock.mockResolvedValueOnce({ id: "user-1", role: "STAFF" as const });
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: "user-1", mfaEnabled: false });
    readEnrollmentTicketMock.mockResolvedValueOnce({ id: "enroll-1", encryptedSecret: "enc(FAKESECRET)" });
    verifyEnrollmentCodeMock.mockResolvedValueOnce(1);
    consumeEnrollmentTicketMock.mockResolvedValueOnce(true);

    await confirmSelfEnrollment(undefined, formData({ code: "123456" }));

    expect(prismaMock.auditEvent.create).toHaveBeenCalledTimes(1);
    const metadata = prismaMock.auditEvent.create.mock.calls[0]![0].data.metadata;
    expect(JSON.stringify(metadata)).not.toContain("FAKESECRET");
    for (const value of Object.values(metadata)) {
      expect(["string", "number", "boolean"]).toContain(typeof value);
    }
  });
});

// Sanity check that this suite's own AuthError catch branches are reachable
// with a real AuthError instance, not just a generic Error.
describe("signIn failures surface as a generic message, never an internal error", () => {
  it("verifyMfaChallenge", async () => {
    readPendingTicketMock.mockResolvedValueOnce({ id: "pending-1", userId: "user-1" });
    prismaMock.user.findUnique.mockResolvedValueOnce(mfaUser);
    verifyAndConsumeTotpMock.mockResolvedValueOnce(true);
    completeChallengeMock.mockResolvedValueOnce("verified-1");
    signInMock.mockRejectedValueOnce(new FakeAuthError("boom"));

    const result = await verifyMfaChallenge(undefined, formData({ code: "123456" }));
    expect(result).toMatch(/went wrong/i);
  });
});

describe("adminResetMfa (ADMIN-only, admin re-auth required)", () => {
  const admin = { id: "admin-1", role: "ADMIN" as const };
  const staff = { id: "staff-1", role: "STAFF" as const };
  const adminRecordNoMfa = {
    id: "admin-1",
    email: "admin@fryelawgroup.example",
    active: true,
    mfaEnabled: false,
    totpSecretEncrypted: null,
    totpLastUsedStep: null,
  };
  const adminRecordWithMfa = {
    ...adminRecordNoMfa,
    mfaEnabled: true,
    totpSecretEncrypted: "enc(ADMINSECRET)",
  };
  const targetUser = { id: "target-1", email: "target@fryelawgroup.example" };

  it("rejects a non-ADMIN caller outright, before touching any credentials", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(staff);

    const result = await adminResetMfa(undefined, formData({ userId: "target-1", adminPassword: "whatever" }));

    expect(result).toMatch(/not found or access denied/i);
    expect(verifyPasswordMock).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("rejects when the admin's own password is missing — an open session alone is not enough", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(admin);

    const result = await adminResetMfa(undefined, formData({ userId: "target-1" }));

    expect(result).toBeTruthy();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("rejects an incorrect admin password", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(admin);
    prismaMock.user.findUnique.mockResolvedValueOnce(adminRecordNoMfa);
    verifyPasswordMock.mockResolvedValueOnce(null);

    const result = await adminResetMfa(
      undefined,
      formData({ userId: "target-1", adminPassword: "wrong" }),
    );

    expect(result).toMatch(/incorrect password/i);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("refuses to let an admin reset their own MFA through this path", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(admin);

    const result = await adminResetMfa(undefined, formData({ userId: "admin-1", adminPassword: "correct" }));

    expect(result).toMatch(/account security/i);
    expect(verifyPasswordMock).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("requires the admin's own current code when the admin has MFA enabled", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(admin);
    prismaMock.user.findUnique.mockResolvedValueOnce(adminRecordWithMfa);
    verifyPasswordMock.mockResolvedValueOnce({ id: admin.id });

    const result = await adminResetMfa(
      undefined,
      formData({ userId: "target-1", adminPassword: "correct" }),
    );

    expect(result).toMatch(/current authenticator or recovery code/i);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("rejects an invalid admin MFA code and never touches the target account", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(admin);
    prismaMock.user.findUnique.mockResolvedValueOnce(adminRecordWithMfa);
    verifyPasswordMock.mockResolvedValueOnce({ id: admin.id });
    verifyAndConsumeTotpMock.mockResolvedValueOnce(false);

    const result = await adminResetMfa(
      undefined,
      formData({ userId: "target-1", adminPassword: "correct", adminCode: "000000" }),
    );

    expect(result).toMatch(/invalid or already-used code/i);
    expect(recordFailedMfaAttemptMock).toHaveBeenCalledWith(admin.id);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("succeeds when the admin has no MFA of their own, clearing the target's MFA and forcing re-enrollment", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(admin);
    prismaMock.user.findUnique.mockResolvedValueOnce(adminRecordNoMfa);
    verifyPasswordMock.mockResolvedValueOnce({ id: admin.id });
    prismaMock.user.findUnique.mockResolvedValueOnce(targetUser);

    const result = await adminResetMfa(
      undefined,
      formData({ userId: "target-1", adminPassword: "correct" }),
    );

    expect(result).toBeUndefined();
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: "target-1" },
      data: {
        mfaEnabled: false,
        mfaRequired: true,
        totpSecretEncrypted: null,
        totpLastUsedStep: null,
        mfaFailedAttempts: 0,
        mfaLockedUntil: null,
      },
    });
    expect(prismaMock.mfaRecoveryCode.deleteMany).toHaveBeenCalledWith({ where: { userId: "target-1" } });
  });

  it("succeeds when the admin has MFA enabled and supplies a valid code", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(admin);
    prismaMock.user.findUnique.mockResolvedValueOnce(adminRecordWithMfa);
    verifyPasswordMock.mockResolvedValueOnce({ id: admin.id });
    verifyAndConsumeTotpMock.mockResolvedValueOnce(true);
    prismaMock.user.findUnique.mockResolvedValueOnce(targetUser);

    const result = await adminResetMfa(
      undefined,
      formData({ userId: "target-1", adminPassword: "correct", adminCode: "123456" }),
    );

    expect(result).toBeUndefined();
    expect(resetMfaAttemptsMock).toHaveBeenCalledWith(admin.id);
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ mfaEnabled: false, mfaRequired: true }) }),
    );
  });

  it("never returns the target's previous secret or recovery codes in the response", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(admin);
    prismaMock.user.findUnique.mockResolvedValueOnce(adminRecordNoMfa);
    verifyPasswordMock.mockResolvedValueOnce({ id: admin.id });
    prismaMock.user.findUnique.mockResolvedValueOnce(targetUser);

    const result = await adminResetMfa(undefined, formData({ userId: "target-1", adminPassword: "correct" }));

    // Success returns undefined (no message at all) — there is no code
    // path by which this action can hand back TOTP/recovery-code material.
    expect(result).toBeUndefined();
  });

  it("audits the reset with the admin as actor and the target as entity, no secrets in metadata", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(admin);
    prismaMock.user.findUnique.mockResolvedValueOnce(adminRecordNoMfa);
    verifyPasswordMock.mockResolvedValueOnce({ id: admin.id });
    prismaMock.user.findUnique.mockResolvedValueOnce(targetUser);

    await adminResetMfa(undefined, formData({ userId: "target-1", adminPassword: "correct" }));

    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: {
        actorId: "admin-1",
        action: "UPDATE",
        entityType: "User",
        entityId: "target-1",
        metadata: { event: "admin_mfa_reset" },
      },
    });
  });

  it("rejects a target that doesn't exist, same generic message as unauthorized", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(admin);
    prismaMock.user.findUnique.mockResolvedValueOnce(adminRecordNoMfa);
    verifyPasswordMock.mockResolvedValueOnce({ id: admin.id });
    prismaMock.user.findUnique.mockResolvedValueOnce(null);

    const result = await adminResetMfa(undefined, formData({ userId: "does-not-exist", adminPassword: "correct" }));

    expect(result).toMatch(/not found or access denied/i);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});
