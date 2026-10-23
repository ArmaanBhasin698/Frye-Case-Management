import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireCurrentUserMock, canEditMatterMock, matterIdFilterForMock, prismaMock } = vi.hoisted(() => ({
  requireCurrentUserMock: vi.fn(),
  canEditMatterMock: vi.fn(),
  matterIdFilterForMock: vi.fn(),
  prismaMock: {
    matterStage: { count: vi.fn(), create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), aggregate: vi.fn() },
    matter: { findUnique: vi.fn(), update: vi.fn(), groupBy: vi.fn(), findMany: vi.fn() },
    matterStageChange: { create: vi.fn() },
    auditEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireCurrentUser: requireCurrentUserMock }));
vi.mock("@/lib/auth/access", () => ({ canEditMatter: canEditMatterMock, matterIdFilterFor: matterIdFilterForMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

const { createStage, installSuggestedStages, moveStage, setMatterStage, setStageArchived } = await import("@/lib/stages/actions");
const { getStageCounts } = await import("@/lib/stages/queries");
const { ensureSuggestedStages, SUGGESTED_STAGES } = await import("@/lib/stages/suggested");
const { listMatters } = await import("@/lib/matters/queries");

const admin = { id: "u-admin", role: "ADMIN" as const };
const attorney = { id: "u-att", role: "ATTORNEY" as const };
const staff = { id: "u-staff", role: "STAFF" as const };
const NOT_FOUND = "Not found or access denied.";

function fd(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireCurrentUserMock.mockResolvedValue(admin);
  canEditMatterMock.mockResolvedValue(true);
  prismaMock.matterStage.count.mockResolvedValue(0);
  prismaMock.matterStage.aggregate.mockResolvedValue({ _max: { position: 3 } });
  prismaMock.matterStage.create.mockResolvedValue({ id: "st-new", position: 4 });
  prismaMock.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
});

describe("stage definitions (ADMIN only)", () => {
  it("refuses non-admins", async () => {
    requireCurrentUserMock.mockResolvedValue(attorney);
    expect((await createStage({ error: null }, fd({ name: "Motions" }))).error).toBe(NOT_FOUND);
    expect((await setStageArchived({ stageId: "s1", archived: true })).error).toBe(NOT_FOUND);
    expect((await installSuggestedStages()).error).toBe(NOT_FOUND);
    expect(prismaMock.matterStage.create).not.toHaveBeenCalled();
  });

  it("appends a new stage after the last position and rejects duplicate active names", async () => {
    expect((await createStage({ error: null }, fd({ name: "Motions" }))).error).toBeNull();
    expect(prismaMock.matterStage.create).toHaveBeenCalledWith({ data: { name: "Motions", position: 4 } });
    prismaMock.matterStage.count.mockResolvedValue(1);
    expect((await createStage({ error: null }, fd({ name: "motions" }))).error).toMatch(/already has that name/);
  });

  it("reorders by swapping neighbours and renumbering densely", async () => {
    prismaMock.matterStage.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }, { id: "c" }]);
    await moveStage({ stageId: "c", direction: "up" });
    const updates = prismaMock.matterStage.update.mock.calls.map((c) => [c[0].where.id, c[0].data.position]);
    expect(updates).toEqual([
      ["a", 1],
      ["c", 2],
      ["b", 3],
    ]);
  });

  it("installs suggested stages idempotently", async () => {
    prismaMock.matterStage.findMany.mockResolvedValue([
      { name: "investigation", position: 1 },
      { name: "Trial", position: 7 },
    ]);
    const created = await ensureSuggestedStages(prismaMock as never);
    expect(created).toEqual(SUGGESTED_STAGES.filter((n) => n !== "Investigation" && n !== "Trial"));
    expect(prismaMock.matterStage.create.mock.calls[0]![0].data).toEqual({ name: "Discovery", position: 8 });
    prismaMock.matterStage.create.mockClear();
    prismaMock.matterStage.findMany.mockResolvedValue(SUGGESTED_STAGES.map((name, i) => ({ name, position: i + 1 })));
    expect(await ensureSuggestedStages(prismaMock as never)).toEqual([]);
    expect(prismaMock.matterStage.create).not.toHaveBeenCalled();
  });
});

describe("setMatterStage", () => {
  beforeEach(() => {
    prismaMock.matter.findUnique.mockResolvedValue({ stageId: "s-old" });
    prismaMock.matterStage.findUnique.mockResolvedValue({ archivedAt: null });
  });

  it("requires canEditMatter (forged/inaccessible matter → generic denial)", async () => {
    canEditMatterMock.mockResolvedValue(false);
    requireCurrentUserMock.mockResolvedValue(staff);
    expect((await setMatterStage({ error: null }, fd({ matterId: "m-x", stageId: "s1" }))).error).toBe(NOT_FOUND);
    expect(prismaMock.matter.update).not.toHaveBeenCalled();
  });

  it("refuses archived and nonexistent stages", async () => {
    prismaMock.matterStage.findUnique.mockResolvedValue({ archivedAt: new Date() });
    expect((await setMatterStage({ error: null }, fd({ matterId: "m1", stageId: "s-arch" }))).error).toMatch(/archived/);
    prismaMock.matterStage.findUnique.mockResolvedValue(null);
    expect((await setMatterStage({ error: null }, fd({ matterId: "m1", stageId: "s-forged" }))).error).toMatch(/valid stage/);
    expect(prismaMock.matter.update).not.toHaveBeenCalled();
  });

  it("writes only stageId (never status/closure/archive) and appends history + audit", async () => {
    expect((await setMatterStage({ error: null }, fd({ matterId: "m1", stageId: "s-new" }))).error).toBeNull();
    expect(prismaMock.matter.update).toHaveBeenCalledWith({ where: { id: "m1" }, data: { stageId: "s-new" } });
    expect(Object.keys(prismaMock.matter.update.mock.calls[0]![0].data)).toEqual(["stageId"]);
    expect(prismaMock.matterStageChange.create).toHaveBeenCalledWith({
      data: { matterId: "m1", fromStageId: "s-old", toStageId: "s-new", changedById: admin.id },
    });
    expect(prismaMock.auditEvent.create.mock.calls[0]![0].data.metadata).toEqual({ changed: { stageId: { before: "s-old", after: "s-new" } } });
  });

  it("clears the stage with an empty value and is a no-op when unchanged", async () => {
    await setMatterStage({ error: null }, fd({ matterId: "m1", stageId: "" }));
    expect(prismaMock.matter.update).toHaveBeenCalledWith({ where: { id: "m1" }, data: { stageId: null } });
    vi.clearAllMocks();
    canEditMatterMock.mockResolvedValue(true);
    requireCurrentUserMock.mockResolvedValue(admin);
    prismaMock.matter.findUnique.mockResolvedValue({ stageId: "s-old" });
    await setMatterStage({ error: null }, fd({ matterId: "m1", stageId: "s-old" }));
    expect(prismaMock.matterStageChange.create).not.toHaveBeenCalled();
  });
});

describe("scoped stage counts and matter list filters", () => {
  it("counts only matters in the caller's scope, keeping archived stages that still have matters", async () => {
    matterIdFilterForMock.mockResolvedValue({ id: { in: ["m1", "m2"] } });
    prismaMock.matterStage.findMany.mockResolvedValue([
      { id: "s1", name: "Discovery", archivedAt: null },
      { id: "s2", name: "Old", archivedAt: new Date() },
      { id: "s3", name: "Gone", archivedAt: new Date() },
    ]);
    prismaMock.matter.groupBy.mockResolvedValue([
      { stageId: "s1", _count: { _all: 1 } },
      { stageId: "s2", _count: { _all: 1 } },
    ]);
    const counts = await getStageCounts(staff);
    expect(prismaMock.matter.groupBy.mock.calls[0]![0].where).toEqual({ id: { in: ["m1", "m2"] }, archived: false });
    expect(counts.stages.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(counts.noStage).toBe(0);
  });

  it("ANDs stage and custom-field filters with the access scope", async () => {
    matterIdFilterForMock.mockResolvedValue({ id: { in: ["m1"] } });
    prismaMock.matter.findMany.mockResolvedValue([]);
    const extra = { customFieldValues: { some: { definitionId: "d1", valueBoolean: true } } };
    await listMatters(staff, { stageId: "none", extraWhere: extra });
    expect(prismaMock.matter.findMany.mock.calls[0]![0].where).toEqual({
      id: { in: ["m1"] },
      archived: false,
      AND: [{ stageId: null }, extra],
    });
  });
});
