import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";

const { findManyMock, updateManyMock, transactionMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  updateManyMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    mfaRecoveryCode: {
      findMany: findManyMock,
      updateMany: updateManyMock,
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    $transaction: transactionMock,
  },
}));

const { generateRecoveryCodes, replaceRecoveryCodes, verifyAndConsumeRecoveryCode } = await import(
  "@/lib/auth/mfa/recovery-codes"
);

beforeEach(() => {
  findManyMock.mockReset();
  updateManyMock.mockReset();
  transactionMock.mockReset();
});

describe("generateRecoveryCodes", () => {
  it("generates the requested number of distinct, well-formed codes", () => {
    const codes = generateRecoveryCodes(10);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    }
  });
});

describe("replaceRecoveryCodes", () => {
  it("replaces all codes for a user in one transaction, never storing plaintext", async () => {
    transactionMock.mockResolvedValueOnce(undefined);
    await replaceRecoveryCodes("user-1", ["AAAA-BBBB-CCCC"]);

    expect(transactionMock).toHaveBeenCalledTimes(1);
    const persistedCall = transactionMock.mock.calls[0]![0];
    expect(JSON.stringify(persistedCall)).not.toContain("AAAA-BBBB-CCCC");
  });
});

describe("verifyAndConsumeRecoveryCode", () => {
  it("accepts a code matching a stored hash and atomically marks it used", async () => {
    const hash = await bcrypt.hash("AAAA-BBBB-CCCC", 10);
    findManyMock.mockResolvedValueOnce([{ id: "code-1", codeHash: hash }]);
    updateManyMock.mockResolvedValueOnce({ count: 1 });

    // Case/whitespace-insensitive, matching how a user might retype it.
    const result = await verifyAndConsumeRecoveryCode("user-1", "aaaa-bbbb-cccc");
    expect(result).toBe(true);
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: "code-1", used: false },
      data: { used: true, usedAt: expect.any(Date) },
    });
  });

  it("rejects a code that matches no stored hash", async () => {
    findManyMock.mockResolvedValueOnce([]);
    const result = await verifyAndConsumeRecoveryCode("user-1", "ZZZZ-ZZZZ-ZZZZ");
    expect(result).toBe(false);
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it("rejects the same code once it's no longer in the unused set (single-use)", async () => {
    const hash = await bcrypt.hash("AAAA-BBBB-CCCC", 10);
    findManyMock.mockResolvedValueOnce([{ id: "code-1", codeHash: hash }]);
    updateManyMock.mockResolvedValueOnce({ count: 1 });
    expect(await verifyAndConsumeRecoveryCode("user-1", "AAAA-BBBB-CCCC")).toBe(true);

    // A real second attempt would query with `used: false` and no longer see
    // this row — simulated here by an empty result.
    findManyMock.mockResolvedValueOnce([]);
    expect(await verifyAndConsumeRecoveryCode("user-1", "AAAA-BBBB-CCCC")).toBe(false);
  });

  it("treats a concurrent double-spend race as a rejection via the atomic guard", async () => {
    const hash = await bcrypt.hash("AAAA-BBBB-CCCC", 10);
    findManyMock.mockResolvedValueOnce([{ id: "code-1", codeHash: hash }]);
    // Simulates another request having already flipped `used` moments earlier.
    updateManyMock.mockResolvedValueOnce({ count: 0 });

    const result = await verifyAndConsumeRecoveryCode("user-1", "AAAA-BBBB-CCCC");
    expect(result).toBe(false);
  });
});
