import { beforeEach, describe, expect, it, vi } from "vitest";

const { clientFindManyMock } = vi.hoisted(() => ({
  clientFindManyMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    client: { findMany: clientFindManyMock },
  },
}));

const { listClients, listClientsForPicker } = await import("@/lib/clients/queries");

/** First call's first argument, typed at the call site. */
function firstArg<T>(mock: { mock: { calls: unknown[][] } }): T {
  const call = mock.mock.calls[0];
  if (!call) throw new Error("Mock was never called.");
  return call[0] as T;
}

beforeEach(() => {
  vi.clearAllMocks();
  clientFindManyMock.mockResolvedValue([]);
});

describe("listClients — view filtering", () => {
  it("defaults to archived: false with no options passed at all", () => {
    listClients();
    expect(firstArg<{ where: unknown }>(clientFindManyMock).where).toEqual({ archived: false });
  });

  it("defaults to archived: false when options is passed but view is omitted", () => {
    listClients({});
    expect(firstArg<{ where: unknown }>(clientFindManyMock).where).toEqual({ archived: false });
  });

  it("requests archived: true for the explicit archived view", () => {
    listClients({ view: "archived" });
    expect(firstArg<{ where: unknown }>(clientFindManyMock).where).toEqual({ archived: true });
  });

  it("never returns an archived client from the default (active) view (simulated Prisma filtering)", async () => {
    clientFindManyMock.mockImplementationOnce(async ({ where }: { where: { archived: boolean } }) => {
      const allRows = [
        { id: "client-1", archived: false, notes: "Authorized" },
        { id: "client-2", archived: true, notes: "State v. Doe — confidential" },
      ];
      return allRows.filter((row) => row.archived === where.archived);
    });

    const result = await listClients();

    expect(result).toEqual([{ id: "client-1", archived: false, notes: "Authorized" }]);
    expect(JSON.stringify(result)).not.toContain("confidential");
  });
});

describe("listClientsForPicker — always excludes archived", () => {
  it("filters to archived: false unconditionally (no view option exists)", () => {
    listClientsForPicker();
    expect(firstArg<{ where: unknown }>(clientFindManyMock).where).toEqual({ archived: false });
  });
});
