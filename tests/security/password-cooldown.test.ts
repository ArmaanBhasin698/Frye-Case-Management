import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { findManyAttemptsMock } = vi.hoisted(() => ({
  findManyAttemptsMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    failedLoginAttempt: { findMany: findManyAttemptsMock },
  },
}));

const {
  isPasswordCooldownActive,
  PASSWORD_COOLDOWN_ATTEMPT_THRESHOLD,
  PASSWORD_COOLDOWN_DURATION_MS,
} = await import("@/lib/security/password-cooldown");

const NOW = new Date("2026-01-01T00:10:00Z");

function attemptsAt(times: string[]) {
  return times.map((t) => ({ occurredAt: new Date(t) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("isPasswordCooldownActive", () => {
  it("is not active below the attempt threshold", async () => {
    findManyAttemptsMock.mockResolvedValueOnce(attemptsAt(["2026-01-01T00:09:00Z"]));

    expect(await isPasswordCooldownActive("user-1")).toBe(false);
  });

  it(`is active once ${PASSWORD_COOLDOWN_ATTEMPT_THRESHOLD} attempts land inside the window and the most recent is fresh`, async () => {
    findManyAttemptsMock.mockResolvedValueOnce(
      attemptsAt(
        Array.from({ length: PASSWORD_COOLDOWN_ATTEMPT_THRESHOLD }, (_, i) =>
          new Date(NOW.getTime() - i * 1000).toISOString(),
        ),
      ),
    );

    expect(await isPasswordCooldownActive("user-1")).toBe(true);
  });

  it("clears once the cooldown duration has elapsed since the most recent attempt", async () => {
    const mostRecent = new Date(NOW.getTime() - PASSWORD_COOLDOWN_DURATION_MS - 1);
    findManyAttemptsMock.mockResolvedValueOnce(
      attemptsAt(
        Array.from({ length: PASSWORD_COOLDOWN_ATTEMPT_THRESHOLD }, (_, i) =>
          new Date(mostRecent.getTime() - i * 1000).toISOString(),
        ),
      ),
    );

    expect(await isPasswordCooldownActive("user-1")).toBe(false);
  });

  it("queries only the account's own attempts, most-recent-first, capped at the threshold", async () => {
    findManyAttemptsMock.mockResolvedValueOnce([]);

    await isPasswordCooldownActive("user-1");

    expect(findManyAttemptsMock).toHaveBeenCalledWith({
      where: { accountId: "user-1", occurredAt: { gte: expect.any(Date) } },
      orderBy: { occurredAt: "desc" },
      take: PASSWORD_COOLDOWN_ATTEMPT_THRESHOLD,
      select: { occurredAt: true },
    });
  });
});
