import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { generate, generateSecret } from "otplib";

beforeAll(() => {
  process.env.MFA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

const { updateManyMock } = vi.hoisted(() => ({ updateManyMock: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { user: { updateMany: updateManyMock } } }));

const { buildOtpAuthUri, generateTotpSecret, verifyAndConsumeTotp, verifyEnrollmentCode } = await import(
  "@/lib/auth/mfa/totp"
);
const { encryptSecret } = await import("@/lib/auth/mfa/crypto");

beforeEach(() => {
  updateManyMock.mockReset();
});

describe("generateTotpSecret / buildOtpAuthUri", () => {
  it("generates a base32-looking secret", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+=*$/);
  });

  it("builds an otpauth:// URI naming the issuer and carrying the secret", () => {
    const secret = generateTotpSecret();
    const uri = buildOtpAuthUri(secret, "demo.user@fryelawgroup.example");
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain(encodeURIComponent("Frye Case Management"));
    expect(uri).toContain(secret);
  });
});

describe("verifyEnrollmentCode", () => {
  it("accepts a freshly generated valid code", async () => {
    const secret = generateSecret();
    const code = await generate({ secret });
    expect(await verifyEnrollmentCode(secret, code)).not.toBeNull();
  });

  it("rejects an invalid code", async () => {
    const secret = generateSecret();
    expect(await verifyEnrollmentCode(secret, "000000")).toBeNull();
  });
});

describe("verifyAndConsumeTotp", () => {
  it("accepts a valid code and atomically records the consumed step", async () => {
    updateManyMock.mockResolvedValueOnce({ count: 1 });
    const secret = generateSecret();
    const code = await generate({ secret });
    const encrypted = encryptSecret(secret);

    const result = await verifyAndConsumeTotp("user-1", encrypted, null, code);
    expect(result).toBe(true);
    expect(updateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "user-1" }) }),
    );
  });

  it("rejects an invalid code without touching the database", async () => {
    const secret = generateSecret();
    const encrypted = encryptSecret(secret);

    const result = await verifyAndConsumeTotp("user-1", encrypted, null, "000000");
    expect(result).toBe(false);
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it("rejects replay of an already-consumed step via the atomic guard, even if verify() would allow it", async () => {
    const secret = generateSecret();
    const code = await generate({ secret });
    const encrypted = encryptSecret(secret);

    // Simulates a concurrent request that already consumed this exact time
    // step a moment earlier — the conditional UPDATE affects zero rows.
    updateManyMock.mockResolvedValueOnce({ count: 0 });
    const result = await verifyAndConsumeTotp("user-1", encrypted, null, code);
    expect(result).toBe(false);
  });

  it("rejects a code whose time step is at or before the last used step", async () => {
    const secret = generateSecret();
    const code = await generate({ secret });
    const encrypted = encryptSecret(secret);
    // One step ahead of "now" — still within the verification window, but
    // afterTimeStep should reject it as no later than the last used step.
    const alreadyUsedStep = Math.floor(Date.now() / 1000 / 30) + 1;

    const result = await verifyAndConsumeTotp("user-1", encrypted, alreadyUsedStep, code);
    expect(result).toBe(false);
    expect(updateManyMock).not.toHaveBeenCalled();
  });
});
