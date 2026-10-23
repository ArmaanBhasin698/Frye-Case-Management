import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireCurrentUserMock, prismaMock, revalidatePathMock } = vi.hoisted(() => ({
  requireCurrentUserMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  prismaMock: {
    userActivityEvent: { deleteMany: vi.fn(), count: vi.fn() },
    userActivityMinute: { deleteMany: vi.fn(), count: vi.fn() },
    userSession: { deleteMany: vi.fn(), count: vi.fn() },
    auditEvent: { create: vi.fn() },
    $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/auth/session", () => ({ requireCurrentUser: requireCurrentUserMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

const { isRetentionHoldActive, purgeExpiredUsage, retentionCutoff, PURGE_CONFIRMATION_PHRASE, USAGE_RETENTION_DAYS } =
  await import("@/lib/usage/retention");
const { purgeUsageData } = await import("@/lib/usage/actions");

const admin = { id: "u-admin", role: "ADMIN" as const };

function confirmForm(text = PURGE_CONFIRMATION_PHRASE) {
  const fd = new FormData();
  fd.set("confirm", text);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  requireCurrentUserMock.mockResolvedValue(admin);
  prismaMock.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
  for (const model of [prismaMock.userActivityEvent, prismaMock.userActivityMinute, prismaMock.userSession]) {
    model.deleteMany.mockResolvedValue({ count: 2 });
  }
});

describe("retention policy", () => {
  it("is 365 days", () => {
    expect(USAGE_RETENTION_DAYS).toBe(365);
    expect(retentionCutoff(new Date("2026-10-23T00:00:00Z"))).toEqual(new Date("2025-10-23T00:00:00Z"));
  });

  it("recognizes the preservation hold flag", () => {
    expect(isRetentionHoldActive({ USAGE_RETENTION_HOLD: "true" })).toBe(true);
    expect(isRetentionHoldActive({ USAGE_RETENTION_HOLD: "false" })).toBe(false);
    expect(isRetentionHoldActive({})).toBe(false);
  });

  it("purges only usage rows older than the cutoff, and never open sessions", async () => {
    const now = new Date("2026-10-23T00:00:00Z");
    await purgeExpiredUsage(now);
    const cutoff = retentionCutoff(now);
    expect(prismaMock.userActivityEvent.deleteMany).toHaveBeenCalledWith({ where: { occurredAt: { lt: cutoff } } });
    expect(prismaMock.userActivityMinute.deleteMany).toHaveBeenCalledWith({ where: { minute: { lt: cutoff } } });
    expect(prismaMock.userSession.deleteMany).toHaveBeenCalledWith({ where: { endedAt: { not: null, lt: cutoff } } });
  });
});

describe("purgeUsageData action", () => {
  it("is ADMIN only", async () => {
    requireCurrentUserMock.mockResolvedValue({ id: "u-att", role: "ATTORNEY" });
    const result = await purgeUsageData({ error: null, message: null }, confirmForm());
    expect(result.error).toBe("Not found or access denied.");
    expect(prismaMock.userActivityEvent.deleteMany).not.toHaveBeenCalled();
  });

  it("requires the exact confirmation phrase", async () => {
    const result = await purgeUsageData({ error: null, message: null }, confirmForm("yes"));
    expect(result.error).toMatch(/to confirm/);
    expect(prismaMock.userActivityEvent.deleteMany).not.toHaveBeenCalled();
  });

  it("refuses while a preservation hold is active", async () => {
    vi.stubEnv("USAGE_RETENTION_HOLD", "true");
    const result = await purgeUsageData({ error: null, message: null }, confirmForm());
    expect(result.error).toMatch(/preservation hold/);
    expect(prismaMock.userActivityEvent.deleteMany).not.toHaveBeenCalled();
  });

  it("purges and audits counts only", async () => {
    const result = await purgeUsageData({ error: null, message: null }, confirmForm());
    expect(result.error).toBeNull();
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: "u-admin",
        action: "DELETE",
        entityType: "UsageRetention",
        metadata: expect.objectContaining({ events: 2, minutes: 2, sessions: 2, retentionDays: 365 }),
      }),
    });
  });
});
