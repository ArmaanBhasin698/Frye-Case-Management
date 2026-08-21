import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUniqueUserMock, createFailedAttemptMock, findManyAttemptsMock, findFirstIncidentMock, createIncidentMock } =
  vi.hoisted(() => ({
    findUniqueUserMock: vi.fn(),
    createFailedAttemptMock: vi.fn(),
    findManyAttemptsMock: vi.fn(),
    findFirstIncidentMock: vi.fn(),
    createIncidentMock: vi.fn(),
  }));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: findUniqueUserMock },
    failedLoginAttempt: { create: createFailedAttemptMock, findMany: findManyAttemptsMock },
    securityIncident: { findFirst: findFirstIncidentMock, create: createIncidentMock },
  },
}));

const { recordFailedLoginAttempt, SUSPICIOUS_LOGIN_THRESHOLD } = await import("@/lib/security/detection");

function attemptsAt(times: string[]) {
  return times.map((t) => ({ occurredAt: new Date(t) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  findManyAttemptsMock.mockResolvedValue([]);
});

describe("recordFailedLoginAttempt", () => {
  it("records the attempt against the matching account, never touching the password", async () => {
    findUniqueUserMock.mockResolvedValueOnce({ id: "user-1" });

    await recordFailedLoginAttempt("Jane.Doe@Example.com");

    expect(createFailedAttemptMock).toHaveBeenCalledWith({
      data: { accountId: "user-1", emailAttempted: "jane.doe@example.com" },
    });
  });

  it("still records an attempt against an email with no matching account, without an accountId", async () => {
    findUniqueUserMock.mockResolvedValueOnce(null);

    await recordFailedLoginAttempt("nobody@example.com");

    expect(createFailedAttemptMock).toHaveBeenCalledWith({
      data: { accountId: null, emailAttempted: "nobody@example.com" },
    });
    expect(findManyAttemptsMock).not.toHaveBeenCalled();
    expect(createIncidentMock).not.toHaveBeenCalled();
  });

  it("does not open an incident below the threshold", async () => {
    findUniqueUserMock.mockResolvedValueOnce({ id: "user-1" });
    findManyAttemptsMock.mockResolvedValueOnce(attemptsAt(["2026-01-01T00:00:00Z", "2026-01-01T00:01:00Z"]));

    await recordFailedLoginAttempt("jane@example.com");

    expect(createIncidentMock).not.toHaveBeenCalled();
  });

  it(`opens a SecurityIncident once ${SUSPICIOUS_LOGIN_THRESHOLD} failures land inside the window`, async () => {
    findUniqueUserMock.mockResolvedValueOnce({ id: "user-1" });
    findFirstIncidentMock.mockResolvedValueOnce(null);
    findManyAttemptsMock.mockResolvedValueOnce(
      attemptsAt([
        "2026-01-01T00:00:00Z",
        "2026-01-01T00:01:00Z",
        "2026-01-01T00:02:00Z",
        "2026-01-01T00:03:00Z",
        "2026-01-01T00:04:00Z",
      ]),
    );

    await recordFailedLoginAttempt("jane@example.com");

    expect(createIncidentMock).toHaveBeenCalledWith({
      data: {
        category: "SUSPICIOUS_LOGIN",
        severity: "MEDIUM",
        accountId: "user-1",
        failedAttemptCount: 5,
        windowStart: new Date("2026-01-01T00:00:00Z"),
        windowEnd: new Date("2026-01-01T00:04:00Z"),
      },
    });
  });

  it("does not open a second incident while one is already OPEN or INVESTIGATING for the account", async () => {
    findUniqueUserMock.mockResolvedValueOnce({ id: "user-1" });
    findFirstIncidentMock.mockResolvedValueOnce({ id: "incident-1" });
    findManyAttemptsMock.mockResolvedValueOnce(
      attemptsAt([
        "2026-01-01T00:00:00Z",
        "2026-01-01T00:01:00Z",
        "2026-01-01T00:02:00Z",
        "2026-01-01T00:03:00Z",
        "2026-01-01T00:04:00Z",
      ]),
    );

    await recordFailedLoginAttempt("jane@example.com");

    expect(createIncidentMock).not.toHaveBeenCalled();
  });
});
