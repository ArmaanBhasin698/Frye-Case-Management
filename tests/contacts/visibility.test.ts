import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, getAssignedMatterIdsMock } = vi.hoisted(() => ({
  prismaMock: { contact: { count: vi.fn() } },
  getAssignedMatterIdsMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/access", () => ({ getAssignedMatterIds: getAssignedMatterIdsMock }));

const { buildContactVisibilityFilter, canViewContact, contactVisibilityFilterFor } = await import(
  "@/lib/contacts/visibility"
);

const admin = { id: "u-admin", role: "ADMIN" as const };
const attorney = { id: "u-att", role: "ATTORNEY" as const };
const staff = { id: "u-staff", role: "STAFF" as const };

beforeEach(() => vi.clearAllMocks());

describe("buildContactVisibilityFilter", () => {
  it("leaves admins unrestricted", () => {
    expect(buildContactVisibilityFilter(admin, [])).toEqual({});
  });

  it("limits everyone else to their own contacts and contacts on their matters", () => {
    expect(buildContactVisibilityFilter(attorney, ["m1", "m2"])).toEqual({
      OR: [
        { createdById: "u-att" },
        { matterLinks: { some: { removedAt: null, matterId: { in: ["m1", "m2"] } } } },
        { client: { matters: { some: { id: { in: ["m1", "m2"] } } } } },
      ],
    });
  });

  it("gives judges and other professionals no firm-wide exemption (strict matter-only)", () => {
    const filter = JSON.stringify(buildContactVisibilityFilter(staff, []));
    expect(filter).not.toContain("categories");
    expect(filter).not.toContain("JUDGE");
  });

  it("ignores removed matter links — removal ends the visibility they granted", () => {
    const filter = buildContactVisibilityFilter(staff, ["m1"]);
    expect(JSON.stringify(filter)).toContain('"removedAt":null');
  });
});

describe("contactVisibilityFilterFor / canViewContact", () => {
  it("doesn't look up assignments for admins", async () => {
    expect(await contactVisibilityFilterFor(admin)).toEqual({});
    expect(getAssignedMatterIdsMock).not.toHaveBeenCalled();
  });

  it("checks the specific id AND the visibility filter in one query", async () => {
    getAssignedMatterIdsMock.mockResolvedValue(["m1"]);
    prismaMock.contact.count.mockResolvedValue(0);
    expect(await canViewContact(staff, "c-1")).toBe(false);
    expect(prismaMock.contact.count).toHaveBeenCalledWith({
      where: { AND: [{ id: "c-1" }, buildContactVisibilityFilter(staff, ["m1"])] },
    });
  });

  it("returns true when the contact is visible", async () => {
    getAssignedMatterIdsMock.mockResolvedValue(["m1"]);
    prismaMock.contact.count.mockResolvedValue(1);
    expect(await canViewContact(staff, "c-1")).toBe(true);
  });
});
