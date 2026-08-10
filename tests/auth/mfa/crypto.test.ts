import { beforeAll, describe, expect, it, vi } from "vitest";

// Fictional, deterministic, 32+ byte key — not a real secret, only used to
// exercise the encryption/signing logic in this test file.
const TEST_KEY = Buffer.alloc(32, 7).toString("base64");

beforeAll(() => {
  process.env.MFA_ENCRYPTION_KEY = TEST_KEY;
});

const { encryptSecret, decryptSecret, signTicketId, verifyTicketSignature } = await import("@/lib/auth/mfa/crypto");

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a TOTP secret", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const encrypted = encryptSecret(secret);
    expect(encrypted).not.toContain(secret);
    expect(decryptSecret(encrypted)).toBe(secret);
  });

  it("uses a random IV, so encrypting the same secret twice differs", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    expect(encryptSecret(secret)).not.toBe(encryptSecret(secret));
  });

  it("rejects a tampered ciphertext instead of returning corrupted plaintext", () => {
    const encrypted = encryptSecret("JBSWY3DPEHPK3PXP");
    const [iv, tag] = encrypted.split(":");
    const tampered = [iv, tag, Buffer.from("not-the-real-ciphertext").toString("base64")].join(":");
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("rejects a malformed stored value", () => {
    expect(() => decryptSecret("not-even-three-parts")).toThrow();
  });
});

describe("signTicketId / verifyTicketSignature", () => {
  it("verifies a signature it produced for the same ticket id", () => {
    const signature = signTicketId("ticket-123");
    expect(verifyTicketSignature("ticket-123", signature)).toBe(true);
  });

  it("rejects that signature against a different ticket id", () => {
    const signature = signTicketId("ticket-123");
    expect(verifyTicketSignature("ticket-456", signature)).toBe(false);
  });

  it("rejects a forged/garbage signature", () => {
    expect(verifyTicketSignature("ticket-123", "not-a-real-signature")).toBe(false);
  });
});

describe("MFA_ENCRYPTION_KEY handling", () => {
  it("throws a clear, non-leaking error when the key is missing", async () => {
    const original = process.env.MFA_ENCRYPTION_KEY;
    delete process.env.MFA_ENCRYPTION_KEY;
    vi.resetModules();

    const fresh = await import("@/lib/auth/mfa/crypto");
    expect(() => fresh.encryptSecret("x")).toThrow(/MFA_ENCRYPTION_KEY/);

    process.env.MFA_ENCRYPTION_KEY = original;
    vi.resetModules();
  });
});
