import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { client: { findMany: vi.fn() }, contact: { create: vi.fn() } },
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

const { backfillClientContacts } = await import("@/lib/contacts/backfill");

beforeEach(() => vi.clearAllMocks());

describe("backfillClientContacts", () => {
  it("only considers clients without a contact, and copies names only", async () => {
    prismaMock.client.findMany.mockResolvedValue([{ id: "cl-1", firstName: "Jane", lastName: "Doe" }]);
    expect(await backfillClientContacts()).toEqual({ created: 1, skipped: 0 });
    expect(prismaMock.client.findMany.mock.calls[0]![0].where).toEqual({ contact: { is: null } });
    expect(prismaMock.contact.create).toHaveBeenCalledWith({
      data: { kind: "INDIVIDUAL", firstName: "Jane", lastName: "Doe", displayName: "Jane Doe", clientId: "cl-1" },
    });
  });

  it("skips a client whose contact was created concurrently (unique clientId)", async () => {
    prismaMock.client.findMany.mockResolvedValue([{ id: "cl-1", firstName: "Jane", lastName: "Doe" }]);
    prismaMock.contact.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "test" }),
    );
    expect(await backfillClientContacts()).toEqual({ created: 0, skipped: 1 });
  });
});
