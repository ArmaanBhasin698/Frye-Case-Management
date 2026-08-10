import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUniqueMock, updateMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  updateMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: { user: { findUnique: findUniqueMock, update: updateMock } } }));

const { isLockedOut, recordFailedMfaAttempt, resetMfaAttempts } = await import("@/lib/auth/mfa/lockout");

beforeEach(() => {
  findUniqueMock.mockReset();
  updateMock.mockReset();
});

describe("isLockedOut", () => {
  it("is false when mfaLockedUntil is null", async () => {
    findUniqueMock.mockResolvedValueOnce({ mfaLockedUntil: null });
    expect(await isLockedOut("user-1")).toBe(false);
  });

  it("is true while mfaLockedUntil is in the future", async () => {
    findUniqueMock.mockResolvedValueOnce({ mfaLockedUntil: new Date(Date.now() + 60_000) });
    expect(await isLockedOut("user-1")).toBe(true);
  });

  it("is false once mfaLockedUntil is in the past", async () => {
    findUniqueMock.mockResolvedValueOnce({ mfaLockedUntil: new Date(Date.now() - 60_000) });
    expect(await isLockedOut("user-1")).toBe(false);
  });
});

describe("recordFailedMfaAttempt", () => {
  it("increments the counter without locking below the threshold", async () => {
    updateMock.mockResolvedValueOnce({ mfaFailedAttempts: 3 });
    await recordFailedMfaAttempt("user-1");
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  it("locks the account and resets the counter once the threshold is reached", async () => {
    updateMock.mockResolvedValueOnce({ mfaFailedAttempts: 5 });
    updateMock.mockResolvedValueOnce({});
    await recordFailedMfaAttempt("user-1");

    expect(updateMock).toHaveBeenCalledTimes(2);
    expect(updateMock.mock.calls[1]![0]).toMatchObject({
      data: expect.objectContaining({ mfaFailedAttempts: 0, mfaLockedUntil: expect.any(Date) }),
    });
  });
});

describe("resetMfaAttempts", () => {
  it("clears both the counter and the lockout", async () => {
    await resetMfaAttempts("user-1");
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { mfaFailedAttempts: 0, mfaLockedUntil: null },
    });
  });
});
