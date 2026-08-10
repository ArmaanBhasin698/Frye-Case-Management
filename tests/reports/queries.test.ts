import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  matterAssignmentFindManyMock,
  matterCountMock,
  matterFindManyMock,
  taskCountMock,
  taskGroupByMock,
  deadlineCountMock,
  deadlineGroupByMock,
  documentCountMock,
  discoveryProductionCountMock,
  discoveryProductionGroupByMock,
  discoveryFileCountMock,
  discoveryFileGroupByMock,
  callCountMock,
  callGroupByMock,
  userFindManyMock,
  noteCountMock,
} = vi.hoisted(() => ({
  matterAssignmentFindManyMock: vi.fn(),
  matterCountMock: vi.fn(),
  matterFindManyMock: vi.fn(),
  taskCountMock: vi.fn(),
  taskGroupByMock: vi.fn(),
  deadlineCountMock: vi.fn(),
  deadlineGroupByMock: vi.fn(),
  documentCountMock: vi.fn(),
  discoveryProductionCountMock: vi.fn(),
  discoveryProductionGroupByMock: vi.fn(),
  discoveryFileCountMock: vi.fn(),
  discoveryFileGroupByMock: vi.fn(),
  callCountMock: vi.fn(),
  callGroupByMock: vi.fn(),
  userFindManyMock: vi.fn(),
  noteCountMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    matterAssignment: { findMany: matterAssignmentFindManyMock },
    matter: { count: matterCountMock, findMany: matterFindManyMock },
    task: { count: taskCountMock, groupBy: taskGroupByMock },
    deadline: { count: deadlineCountMock, groupBy: deadlineGroupByMock },
    document: { count: documentCountMock },
    discoveryProduction: { count: discoveryProductionCountMock, groupBy: discoveryProductionGroupByMock },
    discoveryFile: { count: discoveryFileCountMock, groupBy: discoveryFileGroupByMock },
    call: { count: callCountMock, groupBy: callGroupByMock },
    user: { findMany: userFindManyMock },
    note: { count: noteCountMock },
  },
}));

const { getFirmReportSummary } = await import("@/lib/reports/queries");

const admin = { id: "user-admin", role: "ADMIN" as const };
const attorney = { id: "user-attorney", role: "ATTORNEY" as const };
const paralegal = { id: "user-paralegal", role: "PARALEGAL" as const };
const staff = { id: "user-staff", role: "STAFF" as const };

/** `where` of a mock's Nth call (0-indexed), typed at the call site. */
function whereAt<T>(mock: { mock: { calls: unknown[][] } }, index = 0): T {
  const call = mock.mock.calls[index];
  if (!call) throw new Error(`Mock was never called a ${index + 1}th time.`);
  return (call[0] as { where: T }).where;
}

beforeEach(() => {
  vi.clearAllMocks();
  matterAssignmentFindManyMock.mockResolvedValue([]);
  matterCountMock.mockResolvedValue(0);
  matterFindManyMock.mockResolvedValue([]);
  taskCountMock.mockResolvedValue(0);
  taskGroupByMock.mockResolvedValue([]);
  deadlineCountMock.mockResolvedValue(0);
  deadlineGroupByMock.mockResolvedValue([]);
  documentCountMock.mockResolvedValue(0);
  discoveryProductionCountMock.mockResolvedValue(0);
  discoveryProductionGroupByMock.mockResolvedValue([]);
  discoveryFileCountMock.mockResolvedValue(0);
  discoveryFileGroupByMock.mockResolvedValue([]);
  callCountMock.mockResolvedValue(0);
  callGroupByMock.mockResolvedValue([]);
  userFindManyMock.mockResolvedValue([]);
  noteCountMock.mockResolvedValue(0);
});

describe("getFirmReportSummary — ADMIN gets firm-wide metrics", () => {
  it("never queries matter assignments for an ADMIN", async () => {
    await getFirmReportSummary(admin);
    expect(matterAssignmentFindManyMock).not.toHaveBeenCalled();
  });

  it("leaves every section's scope unrestricted ({}) for an ADMIN", async () => {
    await getFirmReportSummary(admin);
    expect(whereAt(taskCountMock, 0)).toEqual({});
    expect(whereAt(deadlineCountMock, 0)).toEqual({});
    expect(whereAt(documentCountMock)).toEqual({});
    expect(whereAt(discoveryProductionCountMock, 0)).toEqual({});
    // DiscoveryFile has no matterId column — an ADMIN's unrestricted {} must
    // stay top-level, never nested as { production: {} } (see
    // lib/discovery/queries.ts's identical regression guard).
    expect(whereAt(discoveryFileCountMock, 0)).toEqual({});
    expect(whereAt(callCountMock, 0)).toEqual({});
  });

  it("scopes active matters to OPEN/PENDING status with no matter restriction", async () => {
    await getFirmReportSummary(admin);
    // An ADMIN's unrestricted matter scope is `{}`, ANDed with the status
    // filter — functionally "no restriction AND OPEN/PENDING," same as
    // every other section's `combine()` output once more than one
    // condition applies (see the "matter filter... via AND" tests below).
    expect(whereAt(matterCountMock, 0)).toEqual({ AND: [{}, { status: { in: ["OPEN", "PENDING"] } }] });
  });

  it("lets an ADMIN see the unfiled-call count (not null)", async () => {
    const summary = await getFirmReportSummary(admin);
    expect(summary.calls.unfiled).not.toBeNull();
  });
});

describe("getFirmReportSummary — restricted non-admin metrics use only assigned matters", () => {
  it("scopes every matterId-column section to exactly the caller's assigned matters", async () => {
    matterAssignmentFindManyMock.mockResolvedValue([{ matterId: "matter-1" }, { matterId: "matter-2" }]);
    const expectedScope = { matterId: { in: ["matter-1", "matter-2"] } };

    await getFirmReportSummary(staff);

    expect(whereAt(taskCountMock, 0)).toEqual(expectedScope);
    expect(whereAt(deadlineCountMock, 0)).toEqual(expectedScope);
    expect(whereAt(documentCountMock)).toEqual(expectedScope);
    expect(whereAt(discoveryProductionCountMock, 0)).toEqual(expectedScope);
    expect(whereAt(discoveryFileCountMock, 0)).toEqual({ production: expectedScope });
    // STAFF may not see unfiled calls, so visibility is the plain matter scope.
    expect(whereAt(callCountMock, 0)).toEqual(expectedScope);
  });

  it("never queries matter assignments more than the authorization primitives already would", async () => {
    matterAssignmentFindManyMock.mockResolvedValue([{ matterId: "matter-1" }]);
    await getFirmReportSummary(staff);
    // Once for getMatterScopes, once inside getCallVisibilityFilter's own
    // matterScopeFilterFor call — no additional per-section refetching.
    expect(matterAssignmentFindManyMock).toHaveBeenCalledTimes(2);
  });

  it("hides the unfiled-call count entirely (null, not 0) for STAFF/PARALEGAL", async () => {
    matterAssignmentFindManyMock.mockResolvedValue([{ matterId: "matter-1" }]);
    const staffSummary = await getFirmReportSummary(staff);
    const paralegalSummary = await getFirmReportSummary(paralegal);
    expect(staffSummary.calls.unfiled).toBeNull();
    expect(paralegalSummary.calls.unfiled).toBeNull();
  });

  it("includes unfiled calls in an ATTORNEY's visibility clause (same rule as Communications)", async () => {
    matterAssignmentFindManyMock.mockResolvedValue([{ matterId: "matter-1" }]);
    await getFirmReportSummary(attorney);
    const where = whereAt<{ OR: unknown[] }>(callCountMock, 0);
    expect(where.OR).toEqual([{ matterId: null }, { matterId: { in: ["matter-1"] } }]);
  });
});

describe("getFirmReportSummary — matter filter cannot override scope", () => {
  it("combines an explicit matterId filter with an ADMIN's unrestricted scope via AND", async () => {
    await getFirmReportSummary(admin, { matterId: "matter-9" });
    expect(whereAt(taskCountMock, 0)).toEqual({ AND: [{}, { matterId: "matter-9" }] });
  });

  it("combines an explicit matterId filter with a restricted scope via AND, never replacing it", async () => {
    matterAssignmentFindManyMock.mockResolvedValue([{ matterId: "matter-1" }]);
    await getFirmReportSummary(staff, { matterId: "matter-1" });
    expect(whereAt(taskCountMock, 0)).toEqual({
      AND: [{ matterId: { in: ["matter-1"] } }, { matterId: "matter-1" }],
    });
  });

  it("still ANDs in a matterId filter for a matter the caller isn't assigned to (Postgres, not this layer, yields zero rows)", async () => {
    matterAssignmentFindManyMock.mockResolvedValue([{ matterId: "matter-1" }]);
    await getFirmReportSummary(staff, { matterId: "matter-99" });
    const where = whereAt<{ AND: unknown[] }>(taskCountMock, 0);
    expect(where.AND).toContainEqual({ matterId: { in: ["matter-1"] } });
    expect(where.AND).toContainEqual({ matterId: "matter-99" });
  });
});

describe("getFirmReportSummary — inaccessible matters cannot influence totals or breakdown labels", () => {
  it("drops a task-breakdown group whose matter isn't returned by the re-intersected matter lookup", async () => {
    matterAssignmentFindManyMock.mockResolvedValue([{ matterId: "matter-1" }]);
    taskGroupByMock.mockImplementation(async ({ by }: { by: string[] }) => {
      if (by[0] === "matterId") {
        return [
          { matterId: "matter-1", _count: 3 },
          // A defensive scenario: a group somehow named an inaccessible
          // matter. resolveMatterBreakdown's own matterWhere re-query
          // (simulated below) must never resolve or leak its title.
          { matterId: "matter-2", _count: 5 },
        ];
      }
      return [];
    });
    matterFindManyMock.mockImplementation(async ({ where }: { where: unknown }) => {
      const w = where as { AND: [{ id: { in: string[] } }, { id: { in: string[] } }] };
      const allowedIds = new Set(w.AND[0].id.in);
      const requestedIds = new Set(w.AND[1].id.in);
      const allMatters = [
        {
          id: "matter-1",
          caseNumber: "CR-1",
          client: { firstName: "Jane", lastName: "Doe" },
        },
        {
          id: "matter-2",
          caseNumber: "CR-2-CONFIDENTIAL",
          client: { firstName: "John", lastName: "Roe" },
        },
      ];
      return allMatters.filter((m) => allowedIds.has(m.id) && requestedIds.has(m.id));
    });

    const summary = await getFirmReportSummary(staff);

    expect(summary.tasks.byMatter).toHaveLength(1);
    expect(summary.tasks.byMatter[0]?.matterId).toBe("matter-1");
    expect(JSON.stringify(summary)).not.toContain("CONFIDENTIAL");
  });

  it("re-intersects the breakdown's matter lookup with the caller's own scope, not just the group's ids", async () => {
    matterAssignmentFindManyMock.mockResolvedValue([{ matterId: "matter-1" }]);
    taskGroupByMock.mockImplementation(async ({ by }: { by: string[] }) =>
      by[0] === "matterId" ? [{ matterId: "matter-1", _count: 1 }] : [],
    );
    await getFirmReportSummary(staff);
    const call = matterFindManyMock.mock.calls[0]?.[0] as { where: { AND: unknown[] } };
    expect(call.where.AND).toContainEqual({ id: { in: ["matter-1"] } });
    expect(call.where.AND).toContainEqual({ id: { in: ["matter-1"] } });
  });
});

describe("getFirmReportSummary — empty states", () => {
  it("resolves cleanly with zeroed totals and empty breakdowns when the caller has no assigned matters", async () => {
    matterAssignmentFindManyMock.mockResolvedValue([]);
    const summary = await getFirmReportSummary(staff);

    expect(summary.matters.active).toBe(0);
    expect(summary.tasks.total).toBe(0);
    expect(summary.tasks.byMatter).toEqual([]);
    expect(summary.tasks.byAssignee).toEqual([]);
    expect(summary.deadlines.total).toBe(0);
    expect(summary.documents.total).toBe(0);
    expect(summary.discovery.productions).toBe(0);
    expect(summary.discovery.files).toBe(0);
    expect(summary.calls.total).toBe(0);
    expect(whereAt(taskCountMock, 0)).toEqual({ matterId: { in: [] } });
  });

  it("zero-fills every enum bucket (status/priority/type/reviewStatus/fileType/direction) even with no rows", async () => {
    const summary = await getFirmReportSummary(admin);
    expect(summary.tasks.byStatus).toEqual({ OPEN: 0, IN_PROGRESS: 0, DONE: 0, CANCELLED: 0 });
    expect(summary.tasks.byPriority).toEqual({ LOW: 0, NORMAL: 0, HIGH: 0 });
    expect(summary.deadlines.byType).toEqual({
      STATUTE_OF_LIMITATIONS: 0,
      SPEEDY_TRIAL: 0,
      FILING: 0,
      OTHER: 0,
    });
    expect(summary.discovery.byReviewStatus).toEqual({ NOT_STARTED: 0, IN_REVIEW: 0, COMPLETE: 0 });
    expect(summary.discovery.byFileType).toEqual({ PDF: 0, VIDEO: 0, AUDIO: 0, PHOTO: 0, OTHER: 0 });
    expect(summary.calls.byDirection).toEqual({ INBOUND: 0, OUTBOUND: 0 });
  });
});

describe("getFirmReportSummary — KPI calculations", () => {
  it("counts overdue tasks as open/in-progress tasks past their due date", async () => {
    await getFirmReportSummary(admin);
    const overdueWhere = whereAt<{ AND: [unknown, { dueDate: { lt: Date }; status: { in: string[] } }] }>(
      taskCountMock,
      1,
    );
    expect(overdueWhere.AND[1].dueDate.lt).toBeInstanceOf(Date);
    expect(overdueWhere.AND[1].status).toEqual({ in: ["OPEN", "IN_PROGRESS"] });
  });

  it("counts upcoming deadlines as unsatisfied with a future date", async () => {
    await getFirmReportSummary(admin);
    // deadline.count is called 3 times: total, satisfied, upcoming, overdue — upcoming is call index 2.
    const upcomingWhere = whereAt<{ AND: [unknown, { satisfied: boolean; date: { gte: Date } }] }>(
      deadlineCountMock,
      2,
    );
    expect(upcomingWhere.AND[1]).toEqual({ satisfied: false, date: { gte: expect.any(Date) } });
  });

  it("counts overdue deadlines as unsatisfied with a past date", async () => {
    await getFirmReportSummary(admin);
    const overdueWhere = whereAt<{ AND: [unknown, { satisfied: boolean; date: { lt: Date } }] }>(
      deadlineCountMock,
      3,
    );
    expect(overdueWhere.AND[1]).toEqual({ satisfied: false, date: { lt: expect.any(Date) } });
  });

  it("counts satisfied deadlines directly", async () => {
    await getFirmReportSummary(admin);
    const satisfiedWhere = whereAt<{ AND: [unknown, { satisfied: boolean }] }>(deadlineCountMock, 1);
    expect(satisfiedWhere.AND[1]).toEqual({ satisfied: true });
  });

  it("buckets a groupBy result's counts into the matching enum key", async () => {
    discoveryProductionGroupByMock.mockResolvedValueOnce([
      { reviewStatus: "COMPLETE", _count: 4 },
      { reviewStatus: "IN_REVIEW", _count: 2 },
    ]);
    const summary = await getFirmReportSummary(admin);
    expect(summary.discovery.byReviewStatus).toEqual({ NOT_STARTED: 0, IN_REVIEW: 2, COMPLETE: 4, });
  });
});

describe("getFirmReportSummary — activity window", () => {
  it("defaults to a 30-day window and applies createdAt/uploadedAt cutoffs", async () => {
    const summary = await getFirmReportSummary(admin);
    expect(summary.activity.window).toBe("30d");
    expect(summary.activity.since).toBeInstanceOf(Date);
  });

  it("applies no createdAt cutoff for the 'all' window", async () => {
    const summary = await getFirmReportSummary(admin, { window: "all" });
    expect(summary.activity.since).toBeNull();
  });
});

describe("getFirmReportSummary — no sensitive fields are returned by the report query layer", () => {
  it("never surfaces raw client PII (phone/notes) through a matter breakdown", async () => {
    matterAssignmentFindManyMock.mockResolvedValue([{ matterId: "matter-1" }]);
    taskGroupByMock.mockImplementation(async ({ by }: { by: string[] }) =>
      by[0] === "matterId" ? [{ matterId: "matter-1", _count: 2 }] : [],
    );
    matterFindManyMock.mockResolvedValueOnce([
      {
        id: "matter-1",
        caseNumber: "CR-1",
        client: {
          firstName: "Jane",
          lastName: "Doe",
          phone: "555-0100",
          notes: "Sensitive client intake notes",
        },
      },
    ]);

    const summary = await getFirmReportSummary(staff);

    expect(summary.tasks.byMatter).toEqual([
      { matterId: "matter-1", label: "State v. Doe", caseNumber: "CR-1", count: 2 },
    ]);
    expect(JSON.stringify(summary)).not.toContain("555-0100");
    expect(JSON.stringify(summary)).not.toContain("Sensitive client intake notes");
  });

  it("never surfaces raw user credentials/email through an assignee breakdown", async () => {
    taskGroupByMock.mockImplementation(async ({ by }: { by: string[] }) =>
      by[0] === "assignedToId" ? [{ assignedToId: "user-1", _count: 3 }] : [],
    );
    userFindManyMock.mockResolvedValueOnce([
      { id: "user-1", name: "Pat Attorney", email: "pat@example.test", passwordHash: "hash", role: "ATTORNEY" },
    ]);

    const summary = await getFirmReportSummary(admin);

    expect(summary.tasks.byAssignee).toEqual([{ userId: "user-1", name: "Pat Attorney", count: 3 }]);
    expect(JSON.stringify(summary)).not.toContain("hash");
    expect(JSON.stringify(summary)).not.toContain("pat@example.test");
  });

  it("labels an unassigned-tasks group as 'Unassigned' rather than a null/empty name", async () => {
    taskGroupByMock.mockImplementation(async ({ by }: { by: string[] }) =>
      by[0] === "assignedToId" ? [{ assignedToId: null, _count: 7 }] : [],
    );
    const summary = await getFirmReportSummary(admin);
    expect(summary.tasks.byAssignee).toEqual([{ userId: null, name: "Unassigned", count: 7 }]);
  });

  it("returns only count-shaped data — no note bodies, call notes, phone numbers, or document contents anywhere in the summary", async () => {
    const summary = await getFirmReportSummary(admin);
    const json = JSON.stringify(summary);
    for (const forbidden of ["phone", "storageKey", "contentHash", "fromNumber", "toNumber", "vonage"]) {
      expect(json.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});
