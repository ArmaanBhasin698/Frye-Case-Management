import { beforeEach, describe, expect, it, vi } from "vitest";

const { callFindManyMock, matterAssignmentFindManyMock } = vi.hoisted(() => ({
  callFindManyMock: vi.fn(),
  matterAssignmentFindManyMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    call: { findMany: callFindManyMock },
    matterAssignment: { findMany: matterAssignmentFindManyMock },
  },
}));

const { getFirmWideCalls } = await import("@/lib/communications/queries");

const admin = { id: "user-admin", role: "ADMIN" as const };
const attorney = { id: "user-attorney", role: "ATTORNEY" as const };
const paralegal = { id: "user-paralegal", role: "PARALEGAL" as const };
const staff = { id: "user-staff", role: "STAFF" as const };

/** First call's first argument, typed at the call site — avoids repeating non-null assertions under `noUncheckedIndexedAccess`. */
function firstArg<T>(mock: { mock: { calls: unknown[][] } }): T {
  const call = mock.mock.calls[0];
  if (!call) throw new Error("Mock was never called.");
  return call[0] as T;
}

beforeEach(() => {
  vi.clearAllMocks();
  callFindManyMock.mockResolvedValue([]);
});

describe("getFirmWideCalls — filed-call authorization scoping", () => {
  it("gives an ADMIN an unrestricted matter scope without querying assignments", async () => {
    await getFirmWideCalls(admin, {});
    expect(matterAssignmentFindManyMock).not.toHaveBeenCalled();
    // ADMIN's scope is unrestricted (`{}`), so visibility must be `{}` directly —
    // NOT `{ OR: [{ matterId: null }, {}] }`. Prisma only treats `{}` as
    // "match everything" at the top level of `where`; nested as an OR branch it
    // matches nothing, which would silently drop every filed call for an ADMIN
    // (verified against a real Postgres instance — see lib/communications/queries.ts).
    expect(firstArg<{ where: unknown }>(callFindManyMock).where).toEqual({});
  });

  it("scopes a non-admin, non-attorney's filed-call query to exactly their assigned matters", async () => {
    matterAssignmentFindManyMock.mockResolvedValueOnce([{ matterId: "matter-1" }, { matterId: "matter-2" }]);
    await getFirmWideCalls(staff, {});
    expect(firstArg<{ where: unknown }>(callFindManyMock).where).toEqual({
      matterId: { in: ["matter-1", "matter-2"] },
    });
  });

  it("combines the matter scope with extra filters via AND, never replacing it", async () => {
    matterAssignmentFindManyMock.mockResolvedValueOnce([{ matterId: "matter-1" }]);
    await getFirmWideCalls(staff, { matterId: "matter-1", direction: "INBOUND" });
    expect(firstArg<{ where: { AND: unknown[] } }>(callFindManyMock).where).toEqual({
      AND: [{ matterId: { in: ["matter-1"] } }, { matterId: "matter-1" }, { direction: "INBOUND" }],
    });
  });

  it("resolves to an empty list cleanly when a non-admin has no assigned matters at all", async () => {
    matterAssignmentFindManyMock.mockResolvedValueOnce([]);
    const result = await getFirmWideCalls(staff, {});
    expect(result).toEqual([]);
    expect(firstArg<{ where: unknown }>(callFindManyMock).where).toEqual({ matterId: { in: [] } });
  });

  it("never returns a call from a matter the caller is not assigned to", async () => {
    // Simulates Prisma's actual filtering behavior for the `matterId: { in }`
    // shape this function builds — exercised here without a database.
    matterAssignmentFindManyMock.mockResolvedValueOnce([{ matterId: "matter-1" }]);
    callFindManyMock.mockImplementationOnce(async ({ where }: { where: { matterId: { in: string[] } } }) => {
      const allowed = new Set(where.matterId.in);
      const allRows = [
        { id: "call-a", matterId: "matter-1", notes: "Authorized call" },
        { id: "call-b", matterId: "matter-2", notes: "State v. Doe — confidential detail" },
      ];
      return allRows.filter((row) => allowed.has(row.matterId));
    });

    const result = await getFirmWideCalls(staff, {});

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("call-a");
    expect(JSON.stringify(result)).not.toContain("confidential");
  });
});

describe("getFirmWideCalls — unfiled-call visibility (conservative role rule)", () => {
  it("gives an ADMIN an unrestricted visibility clause (covers both filed and unfiled)", async () => {
    await getFirmWideCalls(admin, {});
    expect(firstArg<{ where: unknown }>(callFindManyMock).where).toEqual({});
  });

  it("includes unfiled calls in an ATTORNEY's visibility clause alongside their assigned-matter scope", async () => {
    matterAssignmentFindManyMock.mockResolvedValueOnce([{ matterId: "matter-1" }]);
    await getFirmWideCalls(attorney, {});
    const where = firstArg<{ where: { OR: unknown[] } }>(callFindManyMock).where;
    expect(where.OR).toEqual([{ matterId: null }, { matterId: { in: ["matter-1"] } }]);
  });

  it("never includes unfiled calls in a PARALEGAL's visibility clause", async () => {
    matterAssignmentFindManyMock.mockResolvedValueOnce([{ matterId: "matter-1" }]);
    await getFirmWideCalls(paralegal, {});
    const where = firstArg<{ where: unknown }>(callFindManyMock).where;
    expect(where).toEqual({ matterId: { in: ["matter-1"] } });
    expect(JSON.stringify(where)).not.toContain("null");
  });

  it("never includes unfiled calls in a STAFF's visibility clause, even with no assigned matters", async () => {
    matterAssignmentFindManyMock.mockResolvedValueOnce([]);
    await getFirmWideCalls(staff, {});
    expect(firstArg<{ where: unknown }>(callFindManyMock).where).toEqual({ matterId: { in: [] } });
  });

  it("actually filters out an unfiled row for a STAFF caller (simulated Prisma behavior)", async () => {
    matterAssignmentFindManyMock.mockResolvedValueOnce([{ matterId: "matter-1" }]);
    callFindManyMock.mockImplementationOnce(async ({ where }: { where: { matterId: { in: string[] } } }) => {
      const allowed = new Set(where.matterId.in);
      const allRows = [
        { id: "call-filed", matterId: "matter-1" },
        { id: "call-unfiled", matterId: null },
      ];
      // `matterId: { in: [...] }` never matches a null column in real Postgres —
      // simulated here the same way tests/tasks/queries.test.ts does.
      return allRows.filter((row) => row.matterId !== null && allowed.has(row.matterId));
    });

    const result = await getFirmWideCalls(staff, {});
    expect(result).toEqual([{ id: "call-filed", matterId: "matter-1" }]);
  });

  it("lets an ADMIN explicitly filter to unfiled-only calls", async () => {
    await getFirmWideCalls(admin, { filedState: "unfiled" });
    expect(firstArg<{ where: { AND: unknown[] } }>(callFindManyMock).where).toEqual({
      AND: [{}, { matterId: null }],
    });
  });

  it("lets an ATTORNEY explicitly filter to filed-only calls", async () => {
    matterAssignmentFindManyMock.mockResolvedValueOnce([{ matterId: "matter-1" }]);
    await getFirmWideCalls(attorney, { filedState: "filed" });
    expect(firstArg<{ where: { AND: unknown[] } }>(callFindManyMock).where).toEqual({
      AND: [
        { OR: [{ matterId: null }, { matterId: { in: ["matter-1"] } }] },
        { matterId: { not: null } },
      ],
    });
  });
});

/**
 * Emulates real Prisma/Postgres `where`-matching for the shapes
 * `getFirmWideCalls` builds — in particular, `{}` matches every row at the
 * top level of `where` but matches NO rows when nested as an `OR` branch.
 * That asymmetry (verified against a real Postgres instance) is exactly
 * what let filed calls silently disappear for an ADMIN; a naive simulation
 * that treats `{}` as "always true" everywhere would not have caught it.
 */
function matchesWhere(row: { matterId: string | null }, where: unknown, isOrBranch = false): boolean {
  const w = where as Record<string, unknown>;
  if (Array.isArray(w.OR)) return w.OR.some((branch) => matchesWhere(row, branch, true));
  if (Array.isArray(w.AND)) return w.AND.every((branch) => matchesWhere(row, branch, false));
  if (Object.keys(w).length === 0) return !isOrBranch;
  if ("matterId" in w) {
    const cond = w.matterId;
    if (cond === null) return row.matterId === null;
    if (cond && typeof cond === "object" && "in" in cond) {
      return (cond as { in: string[] }).in.includes(row.matterId ?? "");
    }
    if (cond && typeof cond === "object" && "not" in cond && (cond as { not: null }).not === null) {
      return row.matterId !== null;
    }
  }
  throw new Error(`matchesWhere: unhandled where shape ${JSON.stringify(where)}`);
}

describe("getFirmWideCalls — regression: a newly filed call must appear for ADMIN", () => {
  it("returns a matter-scoped call that was just manually logged and filed, alongside existing unfiled calls", async () => {
    const rows = [
      { id: "call-existing-unfiled", matterId: null },
      { id: "call-just-logged-filed", matterId: "matter-1" },
    ];
    callFindManyMock.mockImplementationOnce(async ({ where }: { where: unknown }) =>
      rows.filter((row) => matchesWhere(row, where)),
    );

    const result = await getFirmWideCalls(admin, {});

    expect(result.map((r) => r.id)).toEqual(
      expect.arrayContaining(["call-existing-unfiled", "call-just-logged-filed"]),
    );
    expect(result).toHaveLength(2);
  });
});

describe("getFirmWideCalls — sort", () => {
  it("sorts most-recent-first by default", async () => {
    await getFirmWideCalls(admin, {});
    expect(firstArg<{ orderBy: unknown }>(callFindManyMock).orderBy).toEqual({ occurredAt: "desc" });
  });

  it("sorts oldest-first when requested", async () => {
    await getFirmWideCalls(admin, {}, "oldest");
    expect(firstArg<{ orderBy: unknown }>(callFindManyMock).orderBy).toEqual({ occurredAt: "asc" });
  });
});

describe("getFirmWideCalls — empty state", () => {
  it("resolves to an empty array when nothing matches", async () => {
    callFindManyMock.mockResolvedValueOnce([]);
    const result = await getFirmWideCalls(admin, {});
    expect(result).toEqual([]);
  });
});
