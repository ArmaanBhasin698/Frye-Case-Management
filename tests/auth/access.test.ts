import { describe, expect, it, vi } from "vitest";

const { findManyMock } = vi.hoisted(() => ({ findManyMock: vi.fn() }));

vi.mock("@/lib/db", () => ({
  prisma: {
    matterAssignment: {
      findMany: findManyMock,
    },
  },
}));

// next/navigation's notFound() throws in a way that requires a request
// context outside of Next.js — stub it so assertMatterAccess is testable
// here without one.
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const { assertMatterAccess, hasMatterAccess } = await import("@/lib/auth/access");

const admin = { id: "user-admin", role: "ADMIN" as const };
const staff = { id: "user-staff", role: "STAFF" as const };

describe("hasMatterAccess", () => {
  it("returns true for an admin without querying assignments", async () => {
    findManyMock.mockClear();
    const result = await hasMatterAccess(admin, "matter-1");
    expect(result).toBe(true);
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it("returns true for a non-admin assigned to the matter", async () => {
    findManyMock.mockResolvedValueOnce([{ matterId: "matter-1" }, { matterId: "matter-2" }]);
    const result = await hasMatterAccess(staff, "matter-1");
    expect(result).toBe(true);
  });

  it("returns false for a non-admin not assigned to the matter", async () => {
    findManyMock.mockResolvedValueOnce([{ matterId: "matter-2" }]);
    const result = await hasMatterAccess(staff, "matter-1");
    expect(result).toBe(false);
  });

  it("returns false for a non-admin with no assignments at all", async () => {
    findManyMock.mockResolvedValueOnce([]);
    const result = await hasMatterAccess(staff, "matter-1");
    expect(result).toBe(false);
  });
});

describe("assertMatterAccess", () => {
  it("resolves without throwing for an admin", async () => {
    await expect(assertMatterAccess(admin, "matter-1")).resolves.toBeUndefined();
  });

  it("resolves without throwing for a non-admin who is assigned", async () => {
    findManyMock.mockResolvedValueOnce([{ matterId: "matter-1" }]);
    await expect(assertMatterAccess(staff, "matter-1")).resolves.toBeUndefined();
  });

  it("calls notFound (same as a nonexistent matter) for a non-admin who is not assigned", async () => {
    findManyMock.mockResolvedValueOnce([]);
    await expect(assertMatterAccess(staff, "matter-1")).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
