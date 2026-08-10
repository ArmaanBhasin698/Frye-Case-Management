import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  matterCountMock,
  taskCountMock,
  deadlineCountMock,
  deadlineFindManyMock,
  calendarEventCountMock,
  calendarEventFindManyMock,
  callCountMock,
  callFindManyMock,
  matterAssignmentFindManyMock,
} = vi.hoisted(() => ({
  matterCountMock: vi.fn(),
  taskCountMock: vi.fn(),
  deadlineCountMock: vi.fn(),
  deadlineFindManyMock: vi.fn(),
  calendarEventCountMock: vi.fn(),
  calendarEventFindManyMock: vi.fn(),
  callCountMock: vi.fn(),
  callFindManyMock: vi.fn(),
  matterAssignmentFindManyMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    matter: { count: matterCountMock },
    task: { count: taskCountMock },
    deadline: { count: deadlineCountMock, findMany: deadlineFindManyMock },
    calendarEvent: { count: calendarEventCountMock, findMany: calendarEventFindManyMock },
    call: { count: callCountMock, findMany: callFindManyMock },
    matterAssignment: { findMany: matterAssignmentFindManyMock },
  },
}));

const { getDashboardStats, getRecentCallsAcrossMatters, getUpcomingKeyDates } = await import("@/lib/dashboard/queries");

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
  deadlineFindManyMock.mockResolvedValue([]);
  calendarEventCountMock.mockResolvedValue(0);
  calendarEventFindManyMock.mockResolvedValue([]);
  callCountMock.mockResolvedValue(0);
  callFindManyMock.mockResolvedValue([]);
  matterAssignmentFindManyMock.mockResolvedValue([]);
});

const matterStub = (id: string) => ({
  id,
  caseNumber: `CASE-${id}`,
  client: { firstName: "Jane", lastName: "Doe" },
});

// Regression coverage: Deadline.date is a date-only column stored as UTC
// midnight of the selected day (see lib/matters/format.ts#todayAsStoredDate).
// The old `date: { gte: new Date() }` compared that stored instant against
// the current instant, which had already advanced hours into the UTC day —
// wrongly dropping a deadline due *today* from "upcoming" for most of the
// local day in any US time zone. This forces the clock to a time-of-day
// that exposed the bug (9 AM Eastern, well past UTC midnight) and asserts
// real Prisma-style filtering no longer excludes today's deadline.
describe("upcoming-deadline queries do not drop a deadline due today", () => {
  const originalTZ = process.env.TZ;

  beforeEach(() => {
    process.env.TZ = "America/New_York";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T13:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env.TZ = originalTZ;
  });

  it("getDashboardStats counts a deadline due today as upcoming", async () => {
    deadlineCountMock.mockImplementationOnce(async ({ where }: { where: { date?: { gte: Date } } }) => {
      const threshold = where.date?.gte;
      if (!threshold) throw new Error("Expected an upcoming date condition.");
      const deadlines = [new Date("2026-08-10"), new Date("2026-08-09")];
      return deadlines.filter((d) => d >= threshold).length;
    });

    const stats = await getDashboardStats(admin);
    expect(stats.upcomingDeadlines).toBe(1);
  });

  it("getUpcomingKeyDates includes a deadline due today", async () => {
    deadlineFindManyMock.mockImplementationOnce(async ({ where }: { where: { date?: { gte: Date } } }) => {
      const threshold = where.date?.gte;
      if (!threshold) throw new Error("Expected an upcoming date condition.");
      const deadlines = [
        { id: "deadline-today", date: new Date("2026-08-10"), description: "Due today", type: "FILING", matter: matterStub("matter-1") },
        { id: "deadline-yesterday", date: new Date("2026-08-09"), description: "Due yesterday", type: "FILING", matter: matterStub("matter-1") },
      ];
      return deadlines.filter((d) => d.date >= threshold);
    });

    const result = await getUpcomingKeyDates(admin);
    expect(result.map((r) => r.id)).toEqual(["deadline-today"]);
  });
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
