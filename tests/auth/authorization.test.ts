import { describe, expect, it } from "vitest";

import {
  buildMatterIdFilter,
  buildMatterScopeFilter,
  canAccessMatter,
  isAdmin,
} from "@/lib/auth/authorization";

const admin = { id: "user-admin", role: "ADMIN" as const };
const attorney = { id: "user-attorney", role: "ATTORNEY" as const };
const paralegal = { id: "user-paralegal", role: "PARALEGAL" as const };
const staff = { id: "user-staff", role: "STAFF" as const };

describe("isAdmin", () => {
  it("is true only for the ADMIN role", () => {
    expect(isAdmin(admin)).toBe(true);
    expect(isAdmin(attorney)).toBe(false);
    expect(isAdmin(paralegal)).toBe(false);
    expect(isAdmin(staff)).toBe(false);
  });
});

describe("canAccessMatter", () => {
  it("lets an admin access any matter regardless of assignments", () => {
    expect(canAccessMatter(admin, [], "matter-1")).toBe(true);
    expect(canAccessMatter(admin, ["matter-2", "matter-3"], "matter-1")).toBe(true);
  });

  it("lets a non-admin access a matter they're assigned to", () => {
    expect(canAccessMatter(attorney, ["matter-1", "matter-2"], "matter-1")).toBe(true);
  });

  it("denies a non-admin access to a matter they're not assigned to", () => {
    expect(canAccessMatter(attorney, ["matter-2", "matter-3"], "matter-1")).toBe(false);
  });

  it("denies a non-admin with no assignments at all", () => {
    expect(canAccessMatter(staff, [], "matter-1")).toBe(false);
  });

  it("does not fall back to allowing access on an empty assignment list for staff", () => {
    // Regression guard: an unassigned STAFF account (e.g. a new hire) must
    // never be treated as having implicit access.
    expect(canAccessMatter(staff, [], "any-matter")).toBe(false);
  });
});

describe("buildMatterIdFilter", () => {
  it("returns no restriction for an admin", () => {
    expect(buildMatterIdFilter(admin, ["matter-1"])).toEqual({});
  });

  it("restricts to the given ids for a non-admin", () => {
    expect(buildMatterIdFilter(attorney, ["matter-1", "matter-2"])).toEqual({
      id: { in: ["matter-1", "matter-2"] },
    });
  });

  it("restricts to an empty set (matches nothing) for a non-admin with no assignments", () => {
    expect(buildMatterIdFilter(paralegal, [])).toEqual({ id: { in: [] } });
  });
});

describe("buildMatterScopeFilter", () => {
  it("returns no restriction for an admin", () => {
    expect(buildMatterScopeFilter(admin, ["matter-1"])).toEqual({});
  });

  it("restricts to the given matter ids for a non-admin", () => {
    expect(buildMatterScopeFilter(staff, ["matter-1"])).toEqual({
      matterId: { in: ["matter-1"] },
    });
  });

  it("restricts to an empty set for a non-admin with no assignments", () => {
    expect(buildMatterScopeFilter(attorney, [])).toEqual({ matterId: { in: [] } });
  });
});
