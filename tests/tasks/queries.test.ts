import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { taskFindManyMock, matterAssignmentFindManyMock } = vi.hoisted(() => ({
  taskFindManyMock: vi.fn(),
  matterAssignmentFindManyMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    task: { findMany: taskFindManyMock },
    matterAssignment: { findMany: matterAssignmentFindManyMock },
  },
}));

const { getFirmWideTasks } = await import("@/lib/tasks/queries");

const admin = { id: "user-admin", role: "ADMIN" as const };
const staff = { id: "user-staff", role: "STAFF" as const };

/** First call's first argument, typed at the call site — avoids repeating non-null assertions under `noUncheckedIndexedAccess`. */
function firstArg<T>(mock: { mock: { calls: unknown[][] } }): T {
  const call = mock.mock.calls[0];
  if (!call) throw new Error("Mock was never called.");
  return call[0] as T;
}

beforeEach(() => {
  vi.clearAllMocks();
  taskFindManyMock.mockResolvedValue([]);
});

describe("getFirmWideTasks — authorization scoping", () => {
  it("gives an ADMIN an unrestricted matter scope without querying assignments", async () => {
    await getFirmWideTasks(admin, {});
    expect(matterAssignmentFindManyMock).not.toHaveBeenCalled();
    expect(firstArg<{ where: unknown }>(taskFindManyMock).where).toEqual({});
  });

  it("scopes a non-admin's query to exactly their assigned matters", async () => {
    matterAssignmentFindManyMock.mockResolvedValueOnce([{ matterId: "matter-1" }, { matterId: "matter-2" }]);
    await getFirmWideTasks(staff, {});
    expect(firstArg<{ where: unknown }>(taskFindManyMock).where).toEqual({
      matterId: { in: ["matter-1", "matter-2"] },
    });
  });

  it("combines the matter scope with extra filters via AND, never replacing it", async () => {
    matterAssignmentFindManyMock.mockResolvedValueOnce([{ matterId: "matter-1" }]);
    await getFirmWideTasks(staff, { status: "OPEN", priority: "HIGH", matterId: "matter-1" });
    expect(firstArg<{ where: unknown }>(taskFindManyMock).where).toEqual({
      AND: [
        { matterId: { in: ["matter-1"] } },
        { status: "OPEN" },
        { priority: "HIGH" },
        { matterId: "matter-1" },
      ],
    });
  });

  it("resolves to an empty list cleanly when the caller has no assigned matters at all", async () => {
    matterAssignmentFindManyMock.mockResolvedValueOnce([]);
    const result = await getFirmWideTasks(staff, {});
    expect(result).toEqual([]);
    expect(firstArg<{ where: unknown }>(taskFindManyMock).where).toEqual({ matterId: { in: [] } });
  });

  it("never returns tasks from a matter the caller is not assigned to", async () => {
    // Simulates Prisma's actual filtering behavior for the `matterId: { in }`
    // shape this function builds — the same guarantee a real Postgres query
    // gives, exercised here without a database.
    matterAssignmentFindManyMock.mockResolvedValueOnce([{ matterId: "matter-1" }]);
    taskFindManyMock.mockImplementationOnce(async ({ where }: { where: { matterId: { in: string[] } } }) => {
      const allowed = new Set(where.matterId.in);
      const allRows = [
        { id: "task-a", matterId: "matter-1", title: "Authorized task" },
        { id: "task-b", matterId: "matter-2", title: "State v. Doe — confidential detail" },
      ];
      return allRows.filter((row) => allowed.has(row.matterId));
    });

    const result = await getFirmWideTasks(staff, {});

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("task-a");
    expect(JSON.stringify(result)).not.toContain("confidential");
  });
});

describe("getFirmWideTasks — filters and sort", () => {
  it("adds an overdue condition combining dueDate and open statuses", async () => {
    await getFirmWideTasks(admin, { overdueOnly: true });
    const where = firstArg<{ where: { AND: Array<Record<string, unknown>> } }>(taskFindManyMock).where;
    const overdueCondition = where.AND[1] as { dueDate: { lt: Date }; status: { in: string[] } };
    expect(overdueCondition.dueDate.lt).toBeInstanceOf(Date);
    expect(overdueCondition.status).toEqual({ in: ["OPEN", "IN_PROGRESS"] });
  });

  // Regression coverage: Task.dueDate is a date-only column written from a
  // `<input type="date">` value (stored as UTC midnight of the selected
  // day — see lib/matters/format.ts#todayAsStoredDate). The old
  // `dueDate: { lt: new Date() }` compared that stored instant against the
  // current instant, which had already advanced hours into the UTC day —
  // wrongly marking a task due *today* as overdue for most of the local
  // day in any US time zone. This forces the clock to a time-of-day that
  // exposed the bug (9 AM Eastern, well past UTC midnight) and asserts a
  // real Prisma-style filter no longer excludes today's task.
  describe("overdueOnly does not mark a task due today as overdue", () => {
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

    it("excludes a task due today, and includes one due yesterday, from the overdue filter", async () => {
      taskFindManyMock.mockImplementationOnce(
        async ({ where }: { where: { AND: Array<{ dueDate?: { lt: Date } }> } }) => {
          const threshold = where.AND.find((c) => c.dueDate)?.dueDate?.lt;
          if (!threshold) throw new Error("Expected an overdue dueDate condition.");
          const tasks = [
            { id: "task-today", dueDate: new Date("2026-08-10") },
            { id: "task-yesterday", dueDate: new Date("2026-08-09") },
          ];
          return tasks.filter((t) => t.dueDate < threshold);
        },
      );

      const result = await getFirmWideTasks(admin, { overdueOnly: true });

      expect(result.map((t) => t.id)).toEqual(["task-yesterday"]);
    });
  });

  it("ignores an assignedToId filter when not provided", async () => {
    await getFirmWideTasks(admin, {});
    expect(firstArg<{ where: unknown }>(taskFindManyMock).where).toEqual({});
  });

  it("sorts by due date (ascending) by default", async () => {
    await getFirmWideTasks(admin, {});
    expect(firstArg<{ orderBy: unknown }>(taskFindManyMock).orderBy).toEqual([
      { dueDate: "asc" },
      { priority: "desc" },
    ]);
  });

  it("sorts by priority (descending) when requested", async () => {
    await getFirmWideTasks(admin, {}, "priority");
    expect(firstArg<{ orderBy: unknown }>(taskFindManyMock).orderBy).toEqual([
      { priority: "desc" },
      { dueDate: "asc" },
    ]);
  });
});
