import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, hasMatterAccessMock, matterIdFilterForMock, matterScopeFilterForMock } = vi.hoisted(() => ({
  prismaMock: {
    contact: { count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
    contactRelationship: { findMany: vi.fn() },
    contactInteraction: { findMany: vi.fn() },
    call: { findMany: vi.fn() },
  },
  hasMatterAccessMock: vi.fn(),
  matterIdFilterForMock: vi.fn(),
  matterScopeFilterForMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/access", () => ({
  hasMatterAccess: hasMatterAccessMock,
  matterIdFilterFor: matterIdFilterForMock,
  matterScopeFilterFor: matterScopeFilterForMock,
}));
vi.mock("@/lib/contacts/visibility", () => ({
  contactVisibilityFilterFor: vi.fn(async (user: { role: string }) => (user.role === "ADMIN" ? {} : { VISIBLE: true })),
}));

const { getContactDetail, isContactOnMatter, listContacts } = await import("@/lib/contacts/queries");

const staff = { id: "u-staff", role: "STAFF" as const };
const attorney = { id: "u-att", role: "ATTORNEY" as const };
const admin = { id: "u-admin", role: "ADMIN" as const };
const MATTERS = { id: { in: ["m-1"] } };
const SCOPE = { matterId: { in: ["m-1"] } };

beforeEach(() => {
  vi.clearAllMocks();
  matterIdFilterForMock.mockImplementation(async (u: { role: string }) => (u.role === "ADMIN" ? {} : MATTERS));
  matterScopeFilterForMock.mockImplementation(async (u: { role: string }) => (u.role === "ADMIN" ? {} : SCOPE));
  prismaMock.contact.count.mockResolvedValue(0);
  prismaMock.contact.findMany.mockResolvedValue([]);
  prismaMock.contactRelationship.findMany.mockResolvedValue([]);
  prismaMock.contactInteraction.findMany.mockResolvedValue([]);
  prismaMock.call.findMany.mockResolvedValue([]);
});

describe("listContacts", () => {
  it("always ANDs the visibility filter, so search can't reach hidden contacts", async () => {
    await listContacts(staff, { q: "Vance" });
    const where = prismaMock.contact.findMany.mock.calls[0]![0].where;
    expect(where.AND[0]).toEqual({ VISIBLE: true });
    expect(prismaMock.contact.count.mock.calls[0]![0].where).toBe(where);
  });

  it("answers a filter on an inaccessible matter with nothing, without querying", async () => {
    hasMatterAccessMock.mockResolvedValue(false);
    expect(await listContacts(staff, { matterId: "m-secret" })).toMatchObject({ rows: [], total: 0 });
    expect(prismaMock.contact.findMany).not.toHaveBeenCalled();
    expect(prismaMock.contact.count).not.toHaveBeenCalled();
  });

  it("derives current/former client status only from matters the viewer can see", async () => {
    await listContacts(staff, { clientStatus: "former" });
    const where = JSON.stringify(prismaMock.contact.findMany.mock.calls[0]![0].where);
    expect(where).toContain(JSON.stringify({ some: MATTERS }).slice(1, -1));
    expect(where).toContain('"none"');

    prismaMock.contact.findMany.mockResolvedValue([
      { id: "c1", clientId: "cl1", client: { matters: [{ status: "CLOSED" }] }, categories: [] },
    ]);
    const { rows } = await listContacts(staff);
    expect(rows[0]!.clientStatus).toBe("FORMER");
    const select = prismaMock.contact.findMany.mock.calls[1]![0].select;
    expect(select.client.select.matters.where).toEqual(MATTERS);
  });

  it("paginates", async () => {
    await listContacts(admin, { page: 3 });
    expect(prismaMock.contact.findMany.mock.calls[0]![0]).toMatchObject({ skip: 50, take: 25 });
  });
});

describe("getContactDetail", () => {
  it("returns null for a contact outside the viewer's visibility", async () => {
    prismaMock.contact.findFirst.mockResolvedValue(null);
    expect(await getContactDetail(staff, "c-hidden")).toBeNull();
    expect(prismaMock.contact.findFirst.mock.calls[0]![0].where).toEqual({ AND: [{ id: "c-hidden" }, { VISIBLE: true }] });
    expect(prismaMock.contactInteraction.findMany).not.toHaveBeenCalled();
  });

  it("restricts every matter-derived section to the viewer's matters", async () => {
    prismaMock.contact.findFirst.mockResolvedValue({ id: "c-judge", clientId: null, client: null, matterLinks: [] });
    await getContactDetail(staff, "c-judge");

    const include = prismaMock.contact.findFirst.mock.calls[0]![0].include;
    expect(include.matterLinks.where).toEqual({ removedAt: null, matter: MATTERS });
    expect(include.client.select.matters.where).toEqual(MATTERS);
    expect(include.members.where.AND[0]).toEqual({ VISIBLE: true });

    const relWhere = prismaMock.contactRelationship.findMany.mock.calls[0]![0].where;
    expect(relWhere.AND[0].OR).toEqual([
      { fromContactId: "c-judge", toContact: { VISIBLE: true } },
      { toContactId: "c-judge", fromContact: { VISIBLE: true } },
    ]);
    expect(relWhere.AND[1]).toEqual({ OR: [{ matterId: null }, SCOPE] });

    expect(prismaMock.contactInteraction.findMany.mock.calls[0]![0].where).toEqual({
      AND: [{ contactId: "c-judge" }, { OR: [{ matterId: null }, SCOPE] }],
    });
    // STAFF can't see unfiled calls (same rule as Communications).
    expect(prismaMock.call.findMany.mock.calls[0]![0].where).toEqual({ AND: [{ contactId: "c-judge" }, SCOPE] });
  });

  it("lets ADMIN/ATTORNEY see unfiled calls linked to the contact, like Communications", async () => {
    prismaMock.contact.findFirst.mockResolvedValue({ id: "c-1", clientId: null, client: null, matterLinks: [] });
    await getContactDetail(attorney, "c-1");
    expect(prismaMock.call.findMany.mock.calls[0]![0].where).toEqual({
      AND: [{ contactId: "c-1" }, { OR: [SCOPE, { matterId: null }] }],
    });
  });
});

describe("isContactOnMatter", () => {
  it("accepts an active link or the matter's own client, never a removed link", async () => {
    prismaMock.contact.count.mockResolvedValue(1);
    expect(await isContactOnMatter("c-1", "m-1")).toBe(true);
    expect(prismaMock.contact.count).toHaveBeenCalledWith({
      where: {
        id: "c-1",
        OR: [
          { matterLinks: { some: { matterId: "m-1", removedAt: null } } },
          { client: { matters: { some: { id: "m-1" } } } },
        ],
      },
    });
  });
});
