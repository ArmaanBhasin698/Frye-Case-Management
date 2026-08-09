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

const { assertCanEditMatter, assertCanManageClientsAndMatters, assertMatterAccess, canEditMatter, hasMatterAccess } =
  await import("@/lib/auth/access");

const admin = { id: "user-admin", role: "ADMIN" as const };
const attorney = { id: "user-attorney", role: "ATTORNEY" as const };
const paralegal = { id: "user-paralegal", role: "PARALEGAL" as const };
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

describe("assertCanManageClientsAndMatters", () => {
  it("does not throw for ADMIN or ATTORNEY", () => {
    expect(() => assertCanManageClientsAndMatters(admin)).not.toThrow();
    expect(() => assertCanManageClientsAndMatters(attorney)).not.toThrow();
  });

  it("calls notFound for PARALEGAL and STAFF", () => {
    expect(() => assertCanManageClientsAndMatters(paralegal)).toThrow("NEXT_NOT_FOUND");
    expect(() => assertCanManageClientsAndMatters(staff)).toThrow("NEXT_NOT_FOUND");
  });
});

describe("canEditMatter", () => {
  it("returns true for an admin without querying assignments", async () => {
    findManyMock.mockClear();
    const result = await canEditMatter(admin, "matter-1");
    expect(result).toBe(true);
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it("returns false for PARALEGAL/STAFF regardless of assignment, without even querying it", async () => {
    findManyMock.mockClear();
    expect(await canEditMatter(paralegal, "matter-1")).toBe(false);
    expect(await canEditMatter(staff, "matter-1")).toBe(false);
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it("returns true for an ATTORNEY assigned to the matter", async () => {
    findManyMock.mockResolvedValueOnce([{ matterId: "matter-1" }]);
    expect(await canEditMatter(attorney, "matter-1")).toBe(true);
  });

  it("returns false for an ATTORNEY not assigned to the matter", async () => {
    findManyMock.mockResolvedValueOnce([{ matterId: "matter-2" }]);
    expect(await canEditMatter(attorney, "matter-1")).toBe(false);
  });
});

describe("assertCanEditMatter", () => {
  it("resolves without throwing for an admin", async () => {
    await expect(assertCanEditMatter(admin, "matter-1")).resolves.toBeUndefined();
  });

  it("throws NEXT_NOT_FOUND for an ATTORNEY not assigned to the matter", async () => {
    findManyMock.mockResolvedValueOnce([]);
    await expect(assertCanEditMatter(attorney, "matter-1")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("throws NEXT_NOT_FOUND for STAFF even when assigned", async () => {
    findManyMock.mockResolvedValueOnce([{ matterId: "matter-1" }]);
    await expect(assertCanEditMatter(staff, "matter-1")).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
