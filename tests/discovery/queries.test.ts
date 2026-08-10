import { beforeEach, describe, expect, it, vi } from "vitest";

const { discoveryFileFindManyMock, matterAssignmentFindManyMock } = vi.hoisted(() => ({
  discoveryFileFindManyMock: vi.fn(),
  matterAssignmentFindManyMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    discoveryFile: { findMany: discoveryFileFindManyMock },
    matterAssignment: { findMany: matterAssignmentFindManyMock },
  },
}));

const { getFirmWideDiscoveryFiles } = await import("@/lib/discovery/queries");

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
  discoveryFileFindManyMock.mockResolvedValue([]);
});

describe("getFirmWideDiscoveryFiles — authorization scoping", () => {
  it("gives an ADMIN an unrestricted scope without querying assignments", async () => {
    await getFirmWideDiscoveryFiles(admin, {});
    expect(matterAssignmentFindManyMock).not.toHaveBeenCalled();
    expect(firstArg<{ where: unknown }>(discoveryFileFindManyMock).where).toEqual({});
  });

  it("scopes a non-admin's query to exactly their assigned matters, nested under production", async () => {
    matterAssignmentFindManyMock.mockResolvedValueOnce([{ matterId: "matter-1" }, { matterId: "matter-2" }]);
    await getFirmWideDiscoveryFiles(staff, {});
    expect(firstArg<{ where: unknown }>(discoveryFileFindManyMock).where).toEqual({
      production: { matterId: { in: ["matter-1", "matter-2"] } },
    });
  });

  it("resolves to an empty list cleanly when a non-admin has no assigned matters at all", async () => {
    matterAssignmentFindManyMock.mockResolvedValueOnce([]);
    const result = await getFirmWideDiscoveryFiles(staff, {});
    expect(result).toEqual([]);
    expect(firstArg<{ where: unknown }>(discoveryFileFindManyMock).where).toEqual({
      production: { matterId: { in: [] } },
    });
  });

  it("never returns a file from a matter the caller is not assigned to (simulated Prisma nested-relation filtering)", async () => {
    matterAssignmentFindManyMock.mockResolvedValueOnce([{ matterId: "matter-1" }]);
    discoveryFileFindManyMock.mockImplementationOnce(
      async ({ where }: { where: { production: { matterId: { in: string[] } } } }) => {
        const allowed = new Set(where.production.matterId.in);
        const allRows = [
          { id: "file-a", matterId: "matter-1", originalFilename: "Authorized file.pdf" },
          { id: "file-b", matterId: "matter-2", originalFilename: "State v. Doe — confidential evidence.pdf" },
        ];
        return allRows
          .filter((row) => allowed.has(row.matterId))
          .map((row) => ({ id: row.id, originalFilename: row.originalFilename }));
      },
    );

    const result = await getFirmWideDiscoveryFiles(staff, {});

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("file-a");
    expect(JSON.stringify(result)).not.toContain("confidential");
  });

  it("combines the matter scope with extra filters via AND, never replacing it", async () => {
    matterAssignmentFindManyMock.mockResolvedValueOnce([{ matterId: "matter-1" }]);
    await getFirmWideDiscoveryFiles(staff, { matterId: "matter-1", fileType: "PDF", reviewStatus: "COMPLETE" });
    expect(firstArg<{ where: { AND: unknown[] } }>(discoveryFileFindManyMock).where).toEqual({
      AND: [
        { production: { matterId: { in: ["matter-1"] } } },
        { production: { matterId: "matter-1" } },
        { production: { reviewStatus: "COMPLETE" } },
        { fileType: "PDF" },
      ],
    });
  });

  it("does not nest an ADMIN's unrestricted scope under production (regression: {} inside a relation filter must not silently drop rows)", async () => {
    await getFirmWideDiscoveryFiles(admin, { fileType: "PDF" });
    expect(firstArg<{ where: unknown }>(discoveryFileFindManyMock).where).toEqual({ fileType: "PDF" });
  });
});

describe("getFirmWideDiscoveryFiles — filters", () => {
  it("ignores matterId/fileType/reviewStatus filters when not provided", async () => {
    await getFirmWideDiscoveryFiles(admin, {});
    expect(firstArg<{ where: unknown }>(discoveryFileFindManyMock).where).toEqual({});
  });

  it("applies a matterId filter alone", async () => {
    await getFirmWideDiscoveryFiles(admin, { matterId: "matter-1" });
    expect(firstArg<{ where: unknown }>(discoveryFileFindManyMock).where).toEqual({
      production: { matterId: "matter-1" },
    });
  });

  it("applies a fileType filter alone", async () => {
    await getFirmWideDiscoveryFiles(admin, { fileType: "VIDEO" });
    expect(firstArg<{ where: unknown }>(discoveryFileFindManyMock).where).toEqual({ fileType: "VIDEO" });
  });

  it("applies a reviewStatus filter alone", async () => {
    await getFirmWideDiscoveryFiles(admin, { reviewStatus: "IN_REVIEW" });
    expect(firstArg<{ where: unknown }>(discoveryFileFindManyMock).where).toEqual({
      production: { reviewStatus: "IN_REVIEW" },
    });
  });
});

describe("getFirmWideDiscoveryFiles — sort", () => {
  it("sorts most-recently-registered-first by default", async () => {
    await getFirmWideDiscoveryFiles(admin, {});
    expect(firstArg<{ orderBy: unknown }>(discoveryFileFindManyMock).orderBy).toEqual({ createdAt: "desc" });
  });

  it("sorts oldest-first when requested", async () => {
    await getFirmWideDiscoveryFiles(admin, {}, "oldest");
    expect(firstArg<{ orderBy: unknown }>(discoveryFileFindManyMock).orderBy).toEqual({ createdAt: "asc" });
  });
});

describe("getFirmWideDiscoveryFiles — includes", () => {
  it("includes registeredBy and the production's matter/client for row display and matter links", async () => {
    await getFirmWideDiscoveryFiles(admin, {});
    expect(firstArg<{ include: unknown }>(discoveryFileFindManyMock).include).toEqual({
      registeredBy: true,
      production: { include: { matter: { include: { client: true } } } },
    });
  });
});

describe("getFirmWideDiscoveryFiles — empty state", () => {
  it("resolves to an empty array when nothing matches", async () => {
    discoveryFileFindManyMock.mockResolvedValueOnce([]);
    const result = await getFirmWideDiscoveryFiles(admin, {});
    expect(result).toEqual([]);
  });
});
