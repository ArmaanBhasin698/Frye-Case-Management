import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    intakeLead: { findMany: vi.fn(), findUnique: vi.fn() },
    highLevelSyncState: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

const { getHighLevelSyncState, getIntakeLeadById, listPendingIntakeLeads } = await import("@/lib/intake/queries");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listPendingIntakeLeads", () => {
  it("queries only PENDING leads, oldest first", async () => {
    prismaMock.intakeLead.findMany.mockResolvedValue([]);
    await listPendingIntakeLeads();
    expect(prismaMock.intakeLead.findMany).toHaveBeenCalledWith({
      where: { status: "PENDING" },
      orderBy: { receivedAt: "asc" },
    });
  });
});

describe("getIntakeLeadById", () => {
  it("looks up by id", async () => {
    prismaMock.intakeLead.findUnique.mockResolvedValue(null);
    await getIntakeLeadById("lead-1");
    expect(prismaMock.intakeLead.findUnique).toHaveBeenCalledWith({ where: { id: "lead-1" } });
  });
});

describe("getHighLevelSyncState", () => {
  it("returns null (\"Never synced\") when no row exists yet", async () => {
    prismaMock.highLevelSyncState.findUnique.mockResolvedValue(null);
    expect(await getHighLevelSyncState()).toBeNull();
  });

  it("returns the persisted singleton row by its fixed id", async () => {
    const state = { id: "highlevel", lastSuccessfulSyncAt: new Date("2026-01-01T12:00:00Z") };
    prismaMock.highLevelSyncState.findUnique.mockResolvedValue(state);

    const result = await getHighLevelSyncState();

    expect(prismaMock.highLevelSyncState.findUnique).toHaveBeenCalledWith({ where: { id: "highlevel" } });
    expect(result).toEqual(state);
  });
});
