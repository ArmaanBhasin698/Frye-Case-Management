import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { customFieldValue: { findMany: vi.fn() }, customFieldDefinition: { findMany: vi.fn() } },
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

const { getCustomFieldMergeValues, getCustomFieldRows } = await import("@/lib/custom-fields/queries");

const blank = { valueText: null, valueNumber: null, valueBoolean: null, valueDate: null, valueOptionId: null };

beforeEach(() => vi.clearAllMocks());

describe("getCustomFieldMergeValues", () => {
  it("namespaces values by entity and key, constrained to the owner's own entity", async () => {
    prismaMock.customFieldValue.findMany
      .mockResolvedValueOnce([
        { ...blank, valueOptionId: "o1", definition: { key: "case_class", type: "SINGLE_SELECT", options: [{ id: "o1", label: "Felony" }] } },
      ])
      .mockResolvedValueOnce([{ ...blank, valueBoolean: true, definition: { key: "interpreter_needed", type: "BOOLEAN", options: null } }]);
    const values = await getCustomFieldMergeValues({ matterId: "m1", clientId: "cl1" });
    expect(values).toEqual({ "custom.matter.case_class": "Felony", "custom.client.interpreter_needed": "Yes" });
    expect(prismaMock.customFieldValue.findMany.mock.calls[0]![0].where).toEqual({ matterId: "m1", definition: { entity: "MATTER" } });
    expect(prismaMock.customFieldValue.findMany.mock.calls[1]![0].where).toEqual({ clientId: "cl1", definition: { entity: "CLIENT" } });
  });
});

describe("getCustomFieldRows", () => {
  it("shows every active definition, and archived ones only where a value is stored", async () => {
    prismaMock.customFieldDefinition.findMany.mockResolvedValue([
      { id: "d1", type: "SHORT_TEXT", options: null, archivedAt: null },
      { id: "d2", type: "SHORT_TEXT", options: null, archivedAt: new Date() },
      { id: "d3", type: "SHORT_TEXT", options: null, archivedAt: new Date() },
    ]);
    prismaMock.customFieldValue.findMany.mockResolvedValue([{ ...blank, definitionId: "d2", valueText: "historic" }]);
    const rows = await getCustomFieldRows("CONTACT", "c1");
    expect(prismaMock.customFieldValue.findMany).toHaveBeenCalledWith({ where: { contactId: "c1" } });
    expect(rows.active.map((r) => r.definition.id)).toEqual(["d1"]);
    expect(rows.archived.map((r) => [r.definition.id, r.display])).toEqual([["d2", "historic"]]);
  });
});
