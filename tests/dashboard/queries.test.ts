import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  matterCountMock,
  taskCountMock,
  deadlineCountMock,
  calendarEventCountMock,
  callCountMock,
  callFindManyMock,
  matterAssignmentFindManyMock,
} = vi.hoisted(() => ({
  matterCountMock: vi.fn(),
  taskCountMock: vi.fn(),
  deadlineCountMock: vi.fn(),
  calendarEventCountMock: vi.fn(),
  callCountMock: vi.fn(),
  callFindManyMock: vi.fn(),
  matterAssignmentFindManyMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    matter: { count: matterCountMock },
    task: { count: taskCountMock },
    deadline: { count: deadlineCountMock },
    calendarEvent: { count: calendarEventCountMock },
    call: { count: callCountMock, findMany: callFindManyMock },
    matterAssignment: { findMany: matterAssignmentFindManyMock },
  },
}));

const { getDashboardStats, getRecentCallsAcrossMatters } = await import("@/lib/dashboard/queries");

const admin = { id: "user-admin", role: "ADMIN" as const };
const attorney = { id: "user-attorney", role: "ATTORNEY" as const };
const paralegal = { id: "user-paralegal", role: "PARALEGAL" as const };
const staff = { id: "user-staff", role: "STAFF" as const };

/** First call's first argument, typed at the call site. */
function firstArg<T>(mock: { mock: { calls: unknown[][] } }): T {
  const call = mock.mock.calls[0];
  if (!call) throw new Error("Mock was never called.");
  return call[0] as T;
}

beforeEach(() => {
  vi.clearAllMocks();
  matterCountMock.mockResolvedValue(0);
  taskCountMock.mockResolvedValue(0);
  deadlineCountMock.mockResolvedValue(0);
  calendarEventCountMock.mockResolvedValue(0);
  callCountMock.mockResolvedValue(0);
  callFindManyMock.mockResolvedValue([]);
  matterAssignmentFindManyMock.mockResolvedValue([]);
});

// Regression coverage for a real gap this pass fixed: unfiled calls carry
// phone numbers, contact names, and call notes, and are only ever meant to
// be visible to ADMIN/ATTORNEY (see lib/communications/queries.ts —
// PARALEGAL/STAFF never see an unfiled call). The Dashboard home page used
// to derive its own ad hoc scoping and missed that rule entirely.
describe("getDashboardStats — unfiled call count respects call visibility", () => {
  it("counts unfiled calls for an ADMIN", async () => {
    callCountMock.mockResolvedValueOnce(3);
    const stats = await getDashboardStats(admin);
    expect(stats.unfiledCalls).toBe(3);
    expect(callCountMock).toHaveBeenCalledWith({ where: { matterId: null } });
  });

  it("counts unfiled calls for an ATTORNEY", async () => {
    callCountMock.mockResolvedValueOnce(2);
    const stats = await getDashboardStats(attorney);
    expect(stats.unfiledCalls).toBe(2);
  });

  it("reports zero unfiled calls for PARALEGAL/STAFF without ever querying the count", async () => {
    const paralegalStats = await getDashboardStats(paralegal);
    const staffStats = await getDashboardStats(staff);
    expect(paralegalStats.unfiledCalls).toBe(0);
    expect(staffStats.unfiledCalls).toBe(0);
    expect(callCountMock).not.toHaveBeenCalled();
  });
});

describe("getRecentCallsAcrossMatters — reuses the shared call-visibility rule", () => {
  it("gives an ADMIN an unrestricted query", async () => {
    await getRecentCallsAcrossMatters(admin);
    expect(firstArg<{ where: unknown }>(callFindManyMock).where).toEqual({});
  });

  it("includes unfiled calls for an ATTORNEY alongside their assigned matters", async () => {
    matterAssignmentFindManyMock.mockResolvedValueOnce([{ matterId: "matter-1" }]);
    await getRecentCallsAcrossMatters(attorney);
    expect(firstArg<{ where: { OR: unknown[] } }>(callFindManyMock).where).toEqual({
      OR: [{ matterId: null }, { matterId: { in: ["matter-1"] } }],
    });
  });

  it("never includes unfiled calls for PARALEGAL/STAFF, even ones on their own assigned matters' scope", async () => {
    matterAssignmentFindManyMock.mockResolvedValueOnce([{ matterId: "matter-1" }]);
    await getRecentCallsAcrossMatters(staff);
    expect(firstArg<{ where: unknown }>(callFindManyMock).where).toEqual({
      matterId: { in: ["matter-1"] },
    });
  });
});
