import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({ prismaMock: { contact: { findMany: vi.fn() } } }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

const { classifyDuplicates, findDuplicateContacts, normalizeName, phoneDigits } = await import("@/lib/contacts/duplicates");

beforeEach(() => vi.clearAllMocks());

describe("normalization", () => {
  it("normalizes names case- and punctuation-insensitively", () => {
    expect(normalizeName("  O'Brien,  Jane ")).toBe(normalizeName("o brien jane"));
  });

  it("treats a leading US country code as insignificant", () => {
    expect(phoneDigits("+1 (555) 010-0142")).toBe(phoneDigits("555-010-0142"));
  });
});

describe("classifyDuplicates", () => {
  const candidates = [
    { id: "c1", displayName: "Jane Doe", emails: [{ address: "jane@example.com" }], phones: [{ number: "555-010-0142" }] },
    { id: "c2", displayName: "John Roe", emails: [], phones: [{ number: "555-999-0142" }] },
  ];

  it("reports every matching reason", () => {
    expect(
      classifyDuplicates({ displayName: "jane  doe", emails: ["JANE@example.com"], phones: ["(555) 010-0142"] }, candidates),
    ).toEqual([{ id: "c1", displayName: "Jane Doe", reasons: ["name", "email", "phone"] }]);
  });

  it("doesn't treat a shared last-four alone as a phone match", () => {
    expect(classifyDuplicates({ displayName: "Someone Else", emails: [], phones: ["555-010-0142"] }, candidates)).toEqual([
      { id: "c1", displayName: "Jane Doe", reasons: ["phone"] },
    ]);
  });
});

describe("findDuplicateContacts", () => {
  it("only ever searches within the caller's visibility filter", async () => {
    prismaMock.contact.findMany.mockResolvedValue([]);
    const visibility = { OR: [{ createdById: "u1" }] };
    await findDuplicateContacts({ displayName: "Jane Doe", emails: [], phones: [] }, visibility);
    const where = prismaMock.contact.findMany.mock.calls[0]![0].where;
    expect(where.AND[0]).toBe(visibility);
  });

  it("excludes the contact being edited", async () => {
    prismaMock.contact.findMany.mockResolvedValue([]);
    await findDuplicateContacts({ displayName: "Jane Doe", emails: [], phones: [] }, {}, "self");
    expect(prismaMock.contact.findMany.mock.calls[0]![0].where.AND).toContainEqual({ id: { not: "self" } });
  });

  it("skips the database entirely when there's nothing to match on", async () => {
    expect(await findDuplicateContacts({ displayName: " ", emails: [], phones: ["12"] }, {})).toEqual([]);
    expect(prismaMock.contact.findMany).not.toHaveBeenCalled();
  });
});
