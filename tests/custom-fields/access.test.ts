import { beforeEach, describe, expect, it, vi } from "vitest";

const { canEditMatterMock, canViewContactMock, prismaMock } = vi.hoisted(() => ({
  canEditMatterMock: vi.fn(),
  canViewContactMock: vi.fn(),
  prismaMock: { client: { count: vi.fn() } },
}));

vi.mock("@/lib/auth/access", () => ({ canEditMatter: canEditMatterMock }));
vi.mock("@/lib/contacts/visibility", () => ({ canViewContact: canViewContactMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

const { canEditCustomValues } = await import("@/lib/custom-fields/access");

const roles = {
  admin: { id: "a", role: "ADMIN" as const },
  attorney: { id: "t", role: "ATTORNEY" as const },
  paralegal: { id: "p", role: "PARALEGAL" as const },
  staff: { id: "s", role: "STAFF" as const },
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.client.count.mockResolvedValue(1);
});

describe("canEditCustomValues", () => {
  it("MATTER values follow canEditMatter (assigned attorney or admin)", async () => {
    canEditMatterMock.mockImplementation(async (u: { role: string }) => u.role === "ADMIN");
    expect(await canEditCustomValues(roles.admin, "MATTER", "m1")).toBe(true);
    expect(await canEditCustomValues(roles.paralegal, "MATTER", "m1")).toBe(false);
    expect(canEditMatterMock).toHaveBeenCalledWith(roles.paralegal, "m1");
  });

  it("CONTACT values follow contact visibility (same rule as updateContact)", async () => {
    canViewContactMock.mockResolvedValue(false);
    expect(await canEditCustomValues(roles.staff, "CONTACT", "c-hidden")).toBe(false);
    canViewContactMock.mockResolvedValue(true);
    expect(await canEditCustomValues(roles.staff, "CONTACT", "c1")).toBe(true);
  });

  it("CLIENT values are ADMIN/ATTORNEY only and require an existing client", async () => {
    expect(await canEditCustomValues(roles.paralegal, "CLIENT", "cl1")).toBe(false);
    expect(await canEditCustomValues(roles.staff, "CLIENT", "cl1")).toBe(false);
    expect(await canEditCustomValues(roles.attorney, "CLIENT", "cl1")).toBe(true);
    prismaMock.client.count.mockResolvedValue(0);
    expect(await canEditCustomValues(roles.admin, "CLIENT", "forged")).toBe(false);
  });
});
