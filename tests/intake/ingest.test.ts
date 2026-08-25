import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

function fakePrismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(`Simulated ${code}`, { code, clientVersion: "test" });
}

const { prismaMock, findClientIdByExternalContactMock } = vi.hoisted(() => ({
  prismaMock: {
    intakeLead: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
  findClientIdByExternalContactMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/intake/linking", () => ({ findClientIdByExternalContact: findClientIdByExternalContactMock }));

const { ingestHighLevelContactEvent } = await import("@/lib/intake/ingest");
const { newLeadEvent, updatedLeadEvent, malformedLeadEvent } = await import("@/lib/intake/fixtures");

beforeEach(() => {
  vi.clearAllMocks();
  findClientIdByExternalContactMock.mockResolvedValue(null);
  prismaMock.intakeLead.findUnique.mockResolvedValue(null);
});

describe("ingestHighLevelContactEvent", () => {
  it("is a no-op that never touches IntakeLead when the contact is already linked to a Client", async () => {
    findClientIdByExternalContactMock.mockResolvedValue("client-1");

    const result = await ingestHighLevelContactEvent(newLeadEvent);

    expect(result).toEqual({ outcome: "already_linked", clientId: "client-1" });
    expect(prismaMock.intakeLead.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.intakeLead.create).not.toHaveBeenCalled();
  });

  it("creates a PENDING IntakeLead and audits it (no actor, no PII) for a fresh contact", async () => {
    prismaMock.intakeLead.create.mockResolvedValue({ id: "lead-1" });

    const result = await ingestHighLevelContactEvent(newLeadEvent);

    expect(result).toEqual({ outcome: "recorded", intakeLeadId: "lead-1", created: true });
    expect(prismaMock.intakeLead.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        provider: "LOOP_HIGHLEVEL",
        externalContactId: "fictional-contact-0001",
        firstName: "Jordan",
        lastName: "Ellis",
      }),
    });
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: {
        actorId: null,
        action: "CREATE",
        entityType: "IntakeLead",
        entityId: "lead-1",
        metadata: { provider: "LOOP_HIGHLEVEL" },
      },
    });
  });

  it("refreshes contact fields on a repeated delivery while still PENDING, without creating a duplicate", async () => {
    prismaMock.intakeLead.findUnique.mockResolvedValue({ id: "lead-1", status: "PENDING" });

    const result = await ingestHighLevelContactEvent(updatedLeadEvent);

    expect(result).toEqual({ outcome: "recorded", intakeLeadId: "lead-1", created: false });
    expect(prismaMock.intakeLead.create).not.toHaveBeenCalled();
    expect(prismaMock.intakeLead.update).toHaveBeenCalledWith({
      where: { id: "lead-1" },
      data: expect.objectContaining({ phone: "+15550142111" }),
    });
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
  });

  it("does not reopen or modify an already-LINKED lead on a later duplicate delivery", async () => {
    prismaMock.intakeLead.findUnique.mockResolvedValue({ id: "lead-1", status: "LINKED" });

    const result = await ingestHighLevelContactEvent(updatedLeadEvent);

    expect(result).toEqual({ outcome: "recorded", intakeLeadId: "lead-1", created: false });
    expect(prismaMock.intakeLead.update).not.toHaveBeenCalled();
  });

  it("does not reopen or modify an already-DISMISSED lead on a later duplicate delivery", async () => {
    prismaMock.intakeLead.findUnique.mockResolvedValue({ id: "lead-1", status: "DISMISSED" });

    const result = await ingestHighLevelContactEvent(updatedLeadEvent);

    expect(result).toEqual({ outcome: "recorded", intakeLeadId: "lead-1", created: false });
    expect(prismaMock.intakeLead.update).not.toHaveBeenCalled();
  });

  it("ignores a malformed payload without touching the database", async () => {
    const result = await ingestHighLevelContactEvent(malformedLeadEvent);

    expect(result.outcome).toBe("ignored");
    expect(findClientIdByExternalContactMock).not.toHaveBeenCalled();
    expect(prismaMock.intakeLead.findUnique).not.toHaveBeenCalled();
  });

  it("resolves a genuine concurrent-delivery race via the database's unique constraint, not a 500", async () => {
    prismaMock.intakeLead.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "lead-raced", status: "PENDING" });
    prismaMock.intakeLead.create.mockRejectedValue(fakePrismaError("P2002"));

    const result = await ingestHighLevelContactEvent(newLeadEvent);

    expect(result).toEqual({ outcome: "recorded", intakeLeadId: "lead-raced", created: false });
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
  });

  it("never throws even if the raced row can't be re-read", async () => {
    prismaMock.intakeLead.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    prismaMock.intakeLead.create.mockRejectedValue(fakePrismaError("P2002"));

    const result = await ingestHighLevelContactEvent(newLeadEvent);

    expect(result.outcome).toBe("ignored");
  });

  it("propagates an unexpected database error rather than swallowing it", async () => {
    prismaMock.intakeLead.create.mockRejectedValue(new Error("connection lost"));

    await expect(ingestHighLevelContactEvent(newLeadEvent)).rejects.toThrow("connection lost");
  });
});
