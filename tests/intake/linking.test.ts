import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

function fakePrismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(`Simulated ${code}`, { code, clientVersion: "test" });
}

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    externalLeadLink: { findUnique: vi.fn(), create: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

const { findClientIdByExternalContact, linkExternalContactToClient } = await import("@/lib/intake/linking");

const PROVIDER = "LOOP_HIGHLEVEL" as const;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("findClientIdByExternalContact", () => {
  it("returns null when no link exists yet", async () => {
    prismaMock.externalLeadLink.findUnique.mockResolvedValue(null);

    expect(await findClientIdByExternalContact(PROVIDER, "contact-1")).toBeNull();
    expect(prismaMock.externalLeadLink.findUnique).toHaveBeenCalledWith({
      where: { provider_externalId: { provider: PROVIDER, externalId: "contact-1" } },
      select: { clientId: true },
    });
  });

  it("returns the linked clientId once a link exists (idempotent lookup before creating a Client)", async () => {
    prismaMock.externalLeadLink.findUnique.mockResolvedValue({ clientId: "client-1" });

    expect(await findClientIdByExternalContact(PROVIDER, "contact-1")).toBe("client-1");
  });
});

describe("linkExternalContactToClient", () => {
  it("creates a first-time link and audits it without the raw externalId", async () => {
    prismaMock.externalLeadLink.findUnique.mockResolvedValue(null);
    prismaMock.externalLeadLink.create.mockResolvedValue({ id: "link-1" });

    const result = await linkExternalContactToClient({
      provider: PROVIDER,
      externalId: "contact-1",
      clientId: "client-1",
      actorId: "user-1",
    });

    expect(result).toEqual({ outcome: "linked", linkId: "link-1" });
    expect(prismaMock.externalLeadLink.create).toHaveBeenCalledWith({
      data: { provider: PROVIDER, externalId: "contact-1", clientId: "client-1" },
    });
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: {
        actorId: "user-1",
        action: "CREATE",
        entityType: "ExternalLeadLink",
        entityId: "link-1",
        metadata: { provider: PROVIDER },
      },
    });
  });

  it("supports a null actorId for an unattended/system-triggered link", async () => {
    prismaMock.externalLeadLink.findUnique.mockResolvedValue(null);
    prismaMock.externalLeadLink.create.mockResolvedValue({ id: "link-1" });

    await linkExternalContactToClient({ provider: PROVIDER, externalId: "contact-1", clientId: "client-1", actorId: null });

    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actorId: null }) }));
  });

  it("is a no-op (repeated delivery) when the same external contact is already linked to the same client", async () => {
    prismaMock.externalLeadLink.findUnique.mockResolvedValue({ clientId: "client-1" });

    const result = await linkExternalContactToClient({
      provider: PROVIDER,
      externalId: "contact-1",
      clientId: "client-1",
      actorId: "user-1",
    });

    expect(result).toEqual({ outcome: "already_linked_to_same_client" });
    expect(prismaMock.externalLeadLink.create).not.toHaveBeenCalled();
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
  });

  it("reports a conflict rather than reassigning when the external contact is already linked to a DIFFERENT client", async () => {
    prismaMock.externalLeadLink.findUnique.mockResolvedValue({ clientId: "client-999" });

    const result = await linkExternalContactToClient({
      provider: PROVIDER,
      externalId: "contact-1",
      clientId: "client-1",
      actorId: "user-1",
    });

    expect(result).toEqual({ outcome: "conflict_linked_to_different_client", existingClientId: "client-999" });
    expect(prismaMock.externalLeadLink.create).not.toHaveBeenCalled();
  });

  it("resolves a genuine concurrent-link race via the database's unique constraint (same client)", async () => {
    prismaMock.externalLeadLink.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ clientId: "client-1" });
    prismaMock.externalLeadLink.create.mockRejectedValue(fakePrismaError("P2002"));

    const result = await linkExternalContactToClient({
      provider: PROVIDER,
      externalId: "contact-1",
      clientId: "client-1",
      actorId: "user-1",
    });

    expect(result).toEqual({ outcome: "already_linked_to_same_client" });
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
  });

  it("resolves a genuine concurrent-link race via the database's unique constraint (conflicting client)", async () => {
    prismaMock.externalLeadLink.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ clientId: "client-999" });
    prismaMock.externalLeadLink.create.mockRejectedValue(fakePrismaError("P2002"));

    const result = await linkExternalContactToClient({
      provider: PROVIDER,
      externalId: "contact-1",
      clientId: "client-1",
      actorId: "user-1",
    });

    expect(result).toEqual({ outcome: "conflict_linked_to_different_client", existingClientId: "client-999" });
  });

  it("returns client_not_found for a forged/nonexistent clientId instead of throwing", async () => {
    prismaMock.externalLeadLink.findUnique.mockResolvedValue(null);
    prismaMock.externalLeadLink.create.mockRejectedValue(fakePrismaError("P2003"));

    const result = await linkExternalContactToClient({
      provider: PROVIDER,
      externalId: "contact-1",
      clientId: "does-not-exist",
      actorId: "user-1",
    });

    expect(result).toEqual({ outcome: "client_not_found" });
  });

  it("does not match a lookup for the same externalId under a different provider (provider-mismatched lookup)", async () => {
    // A real DB would simply not find a composite-key row for a
    // different provider; simulate that directly since this test only
    // needs to prove the lookup key includes provider, not just externalId.
    prismaMock.externalLeadLink.findUnique.mockImplementation(({ where }) =>
      where.provider_externalId.provider === PROVIDER ? Promise.resolve({ clientId: "client-1" }) : Promise.resolve(null),
    );

    const sameProvider = await findClientIdByExternalContact(PROVIDER, "contact-1");
    const otherProvider = await findClientIdByExternalContact(
      "SOME_OTHER_PROVIDER" as never,
      "contact-1",
    );

    expect(sameProvider).toBe("client-1");
    expect(otherProvider).toBeNull();
  });
});
