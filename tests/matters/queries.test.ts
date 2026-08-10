import { beforeEach, describe, expect, it, vi } from "vitest";

const { matterFindManyMock, matterAssignmentFindManyMock } = vi.hoisted(() => ({
  matterFindManyMock: vi.fn(),
  matterAssignmentFindManyMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    matter: { findMany: matterFindManyMock },
    matterAssignment: { findMany: matterAssignmentFindManyMock },
  },
}));

const { listMatters } = await import("@/lib/matters/queries");

const admin = { id: "user-admin", role: "ADMIN" as const };
const staff = { id: "user-staff", role: "STAFF" as const };

/** First call's first argument, typed at the call site. */
function firstArg<T>(mock: { mock: { calls: unknown[][] } }): T {
  const call = mock.mock.calls[0];
  if (!call) throw new Error("Mock was never called.");
  return call[0] as T;
}

beforeEach(() => {
  vi.clearAllMocks();
  matterFindManyMock.mockResolvedValue([]);
});

describe("listMatters — default view excludes archived", () => {
  it("defaults to archived: false with no options passed at all", async () => {
    await listMatters(admin);
    expect(firstArg<{ where: unknown }>(matterFindManyMock).where).toEqual({ archived: false });
  });

  it("defaults to archived: false when options is passed but view is omitted", async () => {
    await listMatters(admin, {});
    expect(firstArg<{ where: unknown }>(matterFindManyMock).where).toEqual({ archived: false });
  });

  it("requests archived: true for the explicit archived view", async () => {
    await listMatters(admin, { view: "archived" });
    expect(firstArg<{ where: unknown }>(matterFindManyMock).where).toEqual({ archived: true });
  });
});

describe("listMatters — the archived filter never replaces matter-level authorization scoping", () => {
  it("gives an ADMIN an unrestricted id scope, combined with archived: false", async () => {
    await listMatters(admin);
    expect(matterAssignmentFindManyMock).not.toHaveBeenCalled();
    expect(firstArg<{ where: unknown }>(matterFindManyMock).where).toEqual({ archived: false });
  });

  it("scopes a non-admin to exactly their assigned matters, ANDed with the archived filter", async () => {
    matterAssignmentFindManyMock.mockResolvedValueOnce([{ matterId: "matter-1" }, { matterId: "matter-2" }]);
    await listMatters(staff, { view: "archived" });
    expect(firstArg<{ where: unknown }>(matterFindManyMock).where).toEqual({
      id: { in: ["matter-1", "matter-2"] },
      archived: true,
    });
  });

  it("resolves to an empty list, not an error, when a non-admin has no assigned matters at all", async () => {
    matterAssignmentFindManyMock.mockResolvedValueOnce([]);
    const result = await listMatters(staff);
    expect(result).toEqual([]);
    expect(firstArg<{ where: unknown }>(matterFindManyMock).where).toEqual({
      id: { in: [] },
      archived: false,
    });
  });

  it("never returns a matter from outside the caller's assignment, even in the archived view (simulated Prisma filtering)", async () => {
    matterAssignmentFindManyMock.mockResolvedValueOnce([{ matterId: "matter-1" }]);
    matterFindManyMock.mockImplementationOnce(
      async ({ where }: { where: { id: { in: string[] }; archived: boolean } }) => {
        const allowed = new Set(where.id.in);
        const allRows = [
          { id: "matter-1", archived: true, caseNumber: "Authorized" },
          { id: "matter-2", archived: true, caseNumber: "State v. Doe — confidential" },
        ];
        return allRows.filter((row) => allowed.has(row.id) && row.archived === where.archived);
      },
    );

    const result = await listMatters(staff, { view: "archived" });

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("matter-1");
    expect(JSON.stringify(result)).not.toContain("confidential");
  });
});
