import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireCurrentUserMock, getUsageReportMock, expireStaleSessionsMock, recordActivityMock, prismaMock } = vi.hoisted(
  () => ({
    requireCurrentUserMock: vi.fn(),
    getUsageReportMock: vi.fn(),
    expireStaleSessionsMock: vi.fn(),
    recordActivityMock: vi.fn(),
    prismaMock: { matterAssignment: { findMany: vi.fn() } },
  }),
);

vi.mock("@/lib/auth/session", () => ({ requireCurrentUser: requireCurrentUserMock }));
vi.mock("@/lib/usage/queries", async (orig) => ({
  ...(await orig<typeof import("@/lib/usage/queries")>()),
  getUsageReport: getUsageReportMock,
}));
vi.mock("@/lib/usage/sessions", () => ({ expireStaleSessions: expireStaleSessionsMock }));
vi.mock("@/lib/usage/record", () => ({ recordActivity: recordActivityMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const { default: AdminUsagePage } = await import("@/app/(dashboard)/admin/usage/page");
const { parseUsageFilters } = await import("@/lib/usage/queries");
const { assertMatterAccess } = await import("@/lib/auth/access");

beforeEach(() => vi.clearAllMocks());

describe("/admin/usage authorization", () => {
  for (const role of ["ATTORNEY", "PARALEGAL", "STAFF"] as const) {
    it(`renders not-found for ${role} before reading any usage data`, async () => {
      requireCurrentUserMock.mockResolvedValue({ id: "u", role });
      await expect(AdminUsagePage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
      expect(getUsageReportMock).not.toHaveBeenCalled();
      expect(expireStaleSessionsMock).not.toHaveBeenCalled();
    });
  }
});

describe("parseUsageFilters", () => {
  const now = new Date("2026-10-23T15:00:00Z");

  it("defaults to the last 30 days, inclusive of today", () => {
    const f = parseUsageFilters({}, now);
    expect(f.toDay).toBe("2026-10-23");
    expect(f.to).toEqual(new Date("2026-10-24T00:00:00Z"));
    expect(f.from).toEqual(new Date("2026-09-24T00:00:00Z"));
  });

  it("drops invalid values instead of passing them to queries", () => {
    const f = parseUsageFilters({ type: "DROP_TABLE", module: "nope", userId: "a b", from: "yesterday" }, now);
    expect(f.type).toBeUndefined();
    expect(f.module).toBeUndefined();
    expect(f.userId).toBeUndefined();
  });

  it("clamps very long ranges", () => {
    const f = parseUsageFilters({ from: "2000-01-01", to: "2026-10-23" }, now);
    expect((f.to.getTime() - f.from.getTime()) / 86_400_000).toBe(366);
  });
});

describe("assertMatterAccess records denials without changing the decision", () => {
  it("records ACCESS_DENIED with the attempted id as a resource, then 404s", async () => {
    prismaMock.matterAssignment.findMany.mockResolvedValue([]);
    await expect(assertMatterAccess({ id: "u-staff", role: "STAFF" }, "m-secret")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(recordActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u-staff", type: "ACCESS_DENIED", resourceId: "m-secret", result: "DENIED" }),
    );
  });
});
