import { beforeEach, describe, expect, it, vi } from "vitest";

const { deadlineFindManyMock, calendarEventFindManyMock, matterAssignmentFindManyMock } = vi.hoisted(() => ({
  deadlineFindManyMock: vi.fn(),
  calendarEventFindManyMock: vi.fn(),
  matterAssignmentFindManyMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    deadline: { findMany: deadlineFindManyMock },
    calendarEvent: { findMany: calendarEventFindManyMock },
    matterAssignment: { findMany: matterAssignmentFindManyMock },
  },
}));

const { getFirmWideCalendarItems } = await import("@/lib/calendar/queries");

const admin = { id: "user-admin", role: "ADMIN" as const };
const staff = { id: "user-staff", role: "STAFF" as const };

const matterStub = (id: string) => ({
  id,
  caseNumber: `CASE-${id}`,
  client: { firstName: "Jane", lastName: "Doe" },
});

/** First call's first argument, typed at the call site — avoids repeating non-null assertions under `noUncheckedIndexedAccess`. */
function firstArg<T>(mock: { mock: { calls: unknown[][] } }): T {
  const call = mock.mock.calls[0];
  if (!call) throw new Error("Mock was never called.");
  return call[0] as T;
}

/** First element of an array, asserting it exists — for fixtures this test itself controls the length of. */
function first<T>(arr: T[]): T {
  const value = arr[0];
  if (value === undefined) throw new Error("Array was empty.");
  return value;
}

beforeEach(() => {
  vi.clearAllMocks();
  deadlineFindManyMock.mockResolvedValue([]);
  calendarEventFindManyMock.mockResolvedValue([]);
});

describe("getFirmWideCalendarItems — authorization scoping", () => {
  it("gives an ADMIN an unrestricted matter scope on both underlying queries", async () => {
    await getFirmWideCalendarItems(admin);
    expect(matterAssignmentFindManyMock).not.toHaveBeenCalled();
    const deadlineWhere = firstArg<{ where: { AND: Array<Record<string, unknown>> } }>(deadlineFindManyMock).where;
    const eventWhere = firstArg<{ where: { AND: Array<Record<string, unknown>> } }>(calendarEventFindManyMock).where;
    expect(first(deadlineWhere.AND)).toEqual({});
    expect(first(eventWhere.AND)).toEqual({});
  });

  it("scopes a non-admin's query to exactly their assigned matters on both models", async () => {
    matterAssignmentFindManyMock.mockResolvedValueOnce([{ matterId: "matter-1" }]);
    await getFirmWideCalendarItems(staff);
    const deadlineWhere = firstArg<{ where: { AND: Array<Record<string, unknown>> } }>(deadlineFindManyMock).where;
    const eventWhere = firstArg<{ where: { AND: Array<Record<string, unknown>> } }>(calendarEventFindManyMock).where;
    expect(first(deadlineWhere.AND)).toEqual({ matterId: { in: ["matter-1"] } });
    expect(first(eventWhere.AND)).toEqual({ matterId: { in: ["matter-1"] } });
  });

  it("never returns a deadline or event from a matter the caller is not assigned to", async () => {
    matterAssignmentFindManyMock.mockResolvedValueOnce([{ matterId: "matter-1" }]);
    deadlineFindManyMock.mockImplementationOnce(
      async ({
        where,
      }: {
        where: { matterId?: { in: string[] } } & { AND?: Array<{ matterId?: { in: string[] } }> };
      }) => {
        // `where` is either the bare scope filter (no other conditions applied,
        // e.g. `includePast: true` with no other filters) or `{ AND: [...] }`
        // once a second condition joins it — see lib/calendar/queries.ts.
        const scopeCondition = where.matterId ? where : where.AND?.find((c) => c.matterId);
        const allowed = new Set(scopeCondition?.matterId?.in);
        const rows = [
          {
            id: "deadline-a",
            date: new Date("2026-09-01"),
            description: "Authorized filing",
            type: "FILING",
            satisfied: false,
            matter: matterStub("matter-1"),
          },
          {
            id: "deadline-b",
            date: new Date("2026-09-02"),
            description: "State v. Doe — confidential",
            type: "FILING",
            satisfied: false,
            matter: matterStub("matter-2"),
          },
        ];
        return rows.filter((row) => allowed.has(row.matter.id));
      },
    );

    const result = await getFirmWideCalendarItems(staff, { includePast: true });

    expect(result).toHaveLength(1);
    expect(first(result).id).toBe("deadline-a");
    expect(JSON.stringify(result)).not.toContain("confidential");
  });

  it("resolves to an empty list cleanly when the caller has no assigned matters at all", async () => {
    matterAssignmentFindManyMock.mockResolvedValueOnce([]);
    const result = await getFirmWideCalendarItems(staff);
    expect(result).toEqual([]);
  });
});

describe("getFirmWideCalendarItems — filters and merging", () => {
  it("only queries deadlines when kind is 'deadline'", async () => {
    await getFirmWideCalendarItems(admin, { kind: "deadline" });
    expect(deadlineFindManyMock).toHaveBeenCalledTimes(1);
    expect(calendarEventFindManyMock).not.toHaveBeenCalled();
  });

  it("only queries events when kind is 'event'", async () => {
    await getFirmWideCalendarItems(admin, { kind: "event" });
    expect(calendarEventFindManyMock).toHaveBeenCalledTimes(1);
    expect(deadlineFindManyMock).not.toHaveBeenCalled();
  });

  it("defaults to upcoming-only (excludes past items) unless includePast is set", async () => {
    await getFirmWideCalendarItems(admin, {});
    const deadlineWhere = firstArg<{ where: { AND: Array<{ date?: { gte: Date } }> } }>(deadlineFindManyMock).where;
    expect(deadlineWhere.AND.some((c) => c.date?.gte instanceof Date)).toBe(true);
  });

  it("represents a satisfied deadline's state correctly and passes it through untouched", async () => {
    deadlineFindManyMock.mockResolvedValueOnce([
      {
        id: "deadline-1",
        date: new Date("2026-09-01"),
        description: "Filed motion",
        type: "FILING",
        satisfied: true,
        matter: matterStub("matter-1"),
      },
    ]);
    const result = await getFirmWideCalendarItems(admin, { kind: "deadline" });
    expect(first(result)).toMatchObject({ kind: "deadline", satisfied: true });
  });

  it("merges deadlines and events into one chronologically sorted list", async () => {
    deadlineFindManyMock.mockResolvedValueOnce([
      {
        id: "deadline-1",
        date: new Date("2026-09-05"),
        description: "Later deadline",
        type: "FILING",
        satisfied: false,
        matter: matterStub("matter-1"),
      },
    ]);
    calendarEventFindManyMock.mockResolvedValueOnce([
      {
        id: "event-1",
        startTime: new Date("2026-09-01"),
        title: "Earlier hearing",
        type: "HEARING",
        location: null,
        matter: matterStub("matter-1"),
      },
    ]);
    const result = await getFirmWideCalendarItems(admin, {});
    expect(result.map((r) => r.id)).toEqual(["event-1", "deadline-1"]);
  });
});
