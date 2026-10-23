import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireCurrentUserMock, canEditCustomValuesMock, prismaMock } = vi.hoisted(() => ({
  requireCurrentUserMock: vi.fn(),
  canEditCustomValuesMock: vi.fn(),
  prismaMock: {
    customFieldDefinition: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), aggregate: vi.fn() },
    customFieldValue: { count: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
    auditEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireCurrentUser: requireCurrentUserMock }));
vi.mock("@/lib/custom-fields/access", () => ({ canEditCustomValues: canEditCustomValuesMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

const { createCustomFieldDefinition, saveCustomFieldValues, setCustomFieldDefinitionArchived, updateCustomFieldDefinition } =
  await import("@/lib/custom-fields/actions");

const admin = { id: "u-admin", role: "ADMIN" as const };
const attorney = { id: "u-att", role: "ATTORNEY" as const };
const NOT_FOUND = "Not found or access denied.";

function fd(fields: Record<string, string | string[]>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}
const audits = () => prismaMock.auditEvent.create.mock.calls.map((c) => c[0].data);

const selectOptions = [
  { id: "opt_a", label: "Felony", archived: false },
  { id: "opt_old", label: "Traffic", archived: true },
];
const matterDefs = [
  { id: "def-text", entity: "MATTER", key: "arresting_agency", label: "Arresting agency", type: "SHORT_TEXT", options: null, archivedAt: null },
  { id: "def-sel", entity: "MATTER", key: "case_class", label: "Case class", type: "SINGLE_SELECT", options: selectOptions, archivedAt: null },
  { id: "def-num", entity: "MATTER", key: "bond_amount", label: "Bond amount", type: "NUMBER", options: null, archivedAt: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  requireCurrentUserMock.mockResolvedValue(admin);
  canEditCustomValuesMock.mockResolvedValue(true);
  prismaMock.customFieldDefinition.aggregate.mockResolvedValue({ _max: { position: 2 } });
  prismaMock.customFieldDefinition.create.mockResolvedValue({ id: "def-new" });
  prismaMock.customFieldDefinition.findMany.mockResolvedValue(matterDefs);
  prismaMock.customFieldValue.findMany.mockResolvedValue([]);
  prismaMock.$transaction.mockImplementation((arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: unknown) => unknown)(prismaMock) : Promise.all(arg as Promise<unknown>[]),
  );
});

describe("definitions (ADMIN only)", () => {
  it("refuses non-admins", async () => {
    requireCurrentUserMock.mockResolvedValue(attorney);
    expect((await createCustomFieldDefinition({ error: null }, fd({ entity: "MATTER", label: "X", type: "SHORT_TEXT" }))).error).toBe(NOT_FOUND);
    expect((await setCustomFieldDefinitionArchived({ definitionId: "d", archived: true })).error).toBe(NOT_FOUND);
    expect(prismaMock.customFieldDefinition.create).not.toHaveBeenCalled();
  });

  it("creates with a slug key and generated option ids, auditing key/type only", async () => {
    const result = await createCustomFieldDefinition(
      { error: null },
      fd({ entity: "CONTACT", label: "Agency Type", type: "SINGLE_SELECT", optionsText: "Local\nState\n" }),
    );
    expect(result.error).toBeNull();
    const data = prismaMock.customFieldDefinition.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({ entity: "CONTACT", key: "agency_type", type: "SINGLE_SELECT", position: 3 });
    expect(data.options.map((o: { label: string }) => o.label)).toEqual(["Local", "State"]);
    expect(audits()[0]).toMatchObject({ entityType: "CustomFieldDefinition", metadata: { entity: "CONTACT", key: "agency_type", type: "SINGLE_SELECT" } });
  });

  it("rejects an invalid key and a select with no options", async () => {
    expect((await createCustomFieldDefinition({ error: null }, fd({ entity: "MATTER", label: "X", key: "Bad Key", type: "SHORT_TEXT" }))).error).toMatch(/Key must/);
    expect((await createCustomFieldDefinition({ error: null }, fd({ entity: "MATTER", label: "X", type: "SINGLE_SELECT" }))).error).toMatch(/at least one option/);
  });

  it("refuses a type change once values exist", async () => {
    prismaMock.customFieldDefinition.findUnique.mockResolvedValue({ ...matterDefs[0], helpText: null, position: 1 });
    prismaMock.customFieldValue.count.mockResolvedValue(3);
    const result = await updateCustomFieldDefinition({ error: null }, fd({ definitionId: "def-text", label: "Arresting agency", type: "NUMBER", position: "1" }));
    expect(result.error).toMatch(/type can't change/);
    expect(prismaMock.customFieldDefinition.update).not.toHaveBeenCalled();
  });

  it("allows a type change while no values exist", async () => {
    prismaMock.customFieldDefinition.findUnique.mockResolvedValue({ ...matterDefs[0], helpText: null, position: 1 });
    prismaMock.customFieldValue.count.mockResolvedValue(0);
    const result = await updateCustomFieldDefinition({ error: null }, fd({ definitionId: "def-text", label: "Arresting agency", type: "LONG_TEXT", position: "1" }));
    expect(result.error).toBeNull();
    expect(audits()[0].metadata).toMatchObject({ changed: ["type"], type: { before: "SHORT_TEXT", after: "LONG_TEXT" } });
  });

  it("refuses deleting a select option (it must be retired instead)", async () => {
    prismaMock.customFieldDefinition.findUnique.mockResolvedValue({ ...matterDefs[1], helpText: null, position: 2 });
    const dropped = await updateCustomFieldDefinition(
      { error: null },
      fd({ definitionId: "def-sel", label: "Case class", type: "SINGLE_SELECT", position: "2", optionId: ["opt_a"], optionLabel: ["Felony"] }),
    );
    expect(dropped.error).toMatch(/retired but not deleted/);
    const retired = await updateCustomFieldDefinition(
      { error: null },
      fd({
        definitionId: "def-sel",
        label: "Case class",
        type: "SINGLE_SELECT",
        position: "2",
        optionId: ["opt_a", "opt_old"],
        optionLabel: ["Felony", "Traffic"],
        optionArchived: ["opt_old"],
        newOptionsText: "Probation violation",
      }),
    );
    expect(retired.error).toBeNull();
    const options = prismaMock.customFieldDefinition.update.mock.calls[0]![0].data.options;
    expect(options.slice(0, 2)).toEqual(selectOptions);
    expect(options[2]).toMatchObject({ label: "Probation violation", archived: false });
  });
});

describe("saveCustomFieldValues", () => {
  const base = { entity: "MATTER", ownerId: "m1" };

  it("denies when the record's own edit rule fails (forged/inaccessible owner)", async () => {
    canEditCustomValuesMock.mockResolvedValue(false);
    expect((await saveCustomFieldValues({ error: null }, fd({ ...base, "cf_def-text": "Example PD" }))).error).toBe(NOT_FOUND);
    expect(prismaMock.customFieldValue.create).not.toHaveBeenCalled();
    expect(canEditCustomValuesMock).toHaveBeenCalledWith(admin, "MATTER", "m1");
  });

  it("only processes active definitions of the record's own entity", async () => {
    // A CONTACT-entity save with a MATTER definition id: the query only loads
    // CONTACT definitions, so the forged key is never read or written.
    prismaMock.customFieldDefinition.findMany.mockResolvedValue([]);
    const result = await saveCustomFieldValues({ error: null }, fd({ entity: "CONTACT", ownerId: "c1", "cf_def-text": "Injected" }));
    expect(result.error).toBeNull();
    expect(prismaMock.customFieldDefinition.findMany).toHaveBeenCalledWith({ where: { entity: "CONTACT", archivedAt: null } });
    expect(prismaMock.customFieldValue.create).not.toHaveBeenCalled();
  });

  it("validates typed values and writes nothing on error", async () => {
    const result = await saveCustomFieldValues({ error: null }, fd({ ...base, "cf_def-text": "ok", "cf_def-num": "12.34567" }));
    expect(result.error).toMatch(/4 decimal places/);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("creates, updates, clears, and skips unchanged values in one transaction; audit has ids only", async () => {
    prismaMock.customFieldValue.findMany.mockResolvedValue([
      { id: "v-sel", definitionId: "def-sel", valueText: null, valueNumber: null, valueBoolean: null, valueDate: null, valueOptionId: "opt_old" },
      { id: "v-num", definitionId: "def-num", valueText: null, valueNumber: "5", valueBoolean: null, valueDate: null, valueOptionId: null },
    ]);
    const result = await saveCustomFieldValues(
      { error: null },
      fd({ ...base, "cf_def-text": "Example County Sheriff", "cf_def-sel": "opt_old", "cf_def-num": "" }),
    );
    expect(result.error).toBeNull();
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.customFieldValue.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ definitionId: "def-text", matterId: "m1", valueText: "Example County Sheriff", updatedById: admin.id }),
    });
    // Retired option re-submitted unchanged → no write; cleared number → delete.
    expect(prismaMock.customFieldValue.update).not.toHaveBeenCalled();
    expect(prismaMock.customFieldValue.deleteMany).toHaveBeenCalledWith({ where: { definitionId: "def-num", matterId: "m1" } });
    const audit = audits()[0];
    expect(audit).toMatchObject({ entityType: "CustomFieldValues", entityId: "m1", matterId: "m1" });
    expect(audit.metadata.changedDefinitionIds.sort()).toEqual(["def-num", "def-text"]);
    expect(JSON.stringify(audits())).not.toContain("Sheriff");
  });

  it("rejects switching a value to a retired option", async () => {
    const result = await saveCustomFieldValues({ error: null }, fd({ ...base, "cf_def-sel": "opt_old" }));
    expect(result.error).toMatch(/retired/);
  });

  it("leaves fields absent from the form untouched", async () => {
    prismaMock.customFieldValue.findMany.mockResolvedValue([
      { id: "v-num", definitionId: "def-num", valueText: null, valueNumber: "5", valueBoolean: null, valueDate: null, valueOptionId: null },
    ]);
    expect((await saveCustomFieldValues({ error: null }, fd({ ...base, "cf_def-text": "" }))).error).toBeNull();
    expect(prismaMock.customFieldValue.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
