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
