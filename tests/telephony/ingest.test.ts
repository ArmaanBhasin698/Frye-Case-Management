import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

function fakePrismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(`Simulated ${code}`, { code, clientVersion: "test" });
}

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    call: { findFirst: vi.fn(), create: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

const { ingestVonageCallEvent } = await import("@/lib/telephony/ingest");
const {
  outboundCompletedEvent,
  duplicateOutboundCompletedEvent,
  inboundCompletedWithRecordingEvent,
  inboundRingingEvent,
  malformedMissingFieldsEvent,
} = await import("@/lib/telephony/fixtures");

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.call.findFirst.mockResolvedValue(null);
});

describe("ingestVonageCallEvent", () => {
  it("creates an unfiled Call and audits it (no actor) for a fresh completed event", async () => {
    prismaMock.call.create.mockResolvedValue({ id: "call-1" });

    const result = await ingestVonageCallEvent(outboundCompletedEvent);

    expect(result).toEqual({ outcome: "created", callId: "call-1", recordingRef: undefined });
    expect(prismaMock.call.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        matterId: null,
        filedById: null,
        filedAt: null,
        vonageCallId: "fictional-conv-outbound-0002",
        direction: "OUTBOUND",
      }),
    });
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: {
        actorId: null,
        action: "CREATE",
        entityType: "Call",
        entityId: "call-1",
        matterId: null,
        metadata: { source: "vonage_webhook", direction: "OUTBOUND", filed: false },
      },
    });
  });

  it("passes through a recording reference on the created result without writing it to recordingDropboxPath", async () => {
    prismaMock.call.create.mockResolvedValue({ id: "call-2" });

    const result = await ingestVonageCallEvent(inboundCompletedWithRecordingEvent);

    expect(result).toEqual({
      outcome: "created",
      callId: "call-2",
      recordingRef: inboundCompletedWithRecordingEvent.recording_url,
    });
    expect(prismaMock.call.create).toHaveBeenCalledWith({
      data: expect.not.objectContaining({ recordingDropboxPath: expect.anything() }),
    });
  });

  it("treats a retried delivery of the same externalCallId as a duplicate, never creating a second row", async () => {
    prismaMock.call.findFirst.mockResolvedValue({ id: "call-1", recordingDropboxPath: null });

    const result = await ingestVonageCallEvent(duplicateOutboundCompletedEvent);

    expect(result).toEqual({ outcome: "duplicate", callId: "call-1", recordingRef: undefined });
    expect(prismaMock.call.create).not.toHaveBeenCalled();
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
  });

  it("surfaces a pending recording reference on a duplicate when none has been stored yet", async () => {
    prismaMock.call.findFirst.mockResolvedValue({ id: "call-3", recordingDropboxPath: null });

    const result = await ingestVonageCallEvent(inboundCompletedWithRecordingEvent);

    expect(result).toEqual({
      outcome: "duplicate",
      callId: "call-3",
      recordingRef: inboundCompletedWithRecordingEvent.recording_url,
    });
  });

  it("does not surface a recording reference on a duplicate once one is already stored", async () => {
    prismaMock.call.findFirst.mockResolvedValue({ id: "call-3", recordingDropboxPath: "calls/call-3/recording" });

    const result = await ingestVonageCallEvent(inboundCompletedWithRecordingEvent);

    expect(result).toEqual({ outcome: "duplicate", callId: "call-3", recordingRef: undefined });
  });

  it("ignores a non-terminal event without touching the database", async () => {
    const result = await ingestVonageCallEvent(inboundRingingEvent);

    expect(result).toEqual({
      outcome: "ignored",
      reason: "unsupported_status",
      detail: expect.stringContaining("ringing"),
    });
    expect(prismaMock.call.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.call.create).not.toHaveBeenCalled();
  });

  it("ignores a malformed payload without touching the database", async () => {
    const result = await ingestVonageCallEvent(malformedMissingFieldsEvent);

    expect(result.outcome).toBe("ignored");
    expect(prismaMock.call.findFirst).not.toHaveBeenCalled();
  });

  it("returns a generic ignored result instead of throwing on a foreign-key failure", async () => {
    prismaMock.call.create.mockRejectedValue(fakePrismaError("P2003"));

    const result = await ingestVonageCallEvent(outboundCompletedEvent);

    expect(result.outcome).toBe("ignored");
  });

  it("resolves a genuine concurrent-delivery race via the database's unique constraint, not a 500", async () => {
    // Fast-path check sees nothing yet (findFirst #1) — but by the time
    // create() runs, a concurrent delivery has already committed the row,
    // so the unique constraint on vonageCallId rejects this insert.
    prismaMock.call.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "call-raced", recordingDropboxPath: null });
    prismaMock.call.create.mockRejectedValue(fakePrismaError("P2002"));

    const result = await ingestVonageCallEvent(outboundCompletedEvent);

    expect(result).toEqual({ outcome: "duplicate", callId: "call-raced", recordingRef: undefined });
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
  });

  it("never throws even if the raced row can't be re-read (vanishingly unlikely, but must not 500)", async () => {
    prismaMock.call.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    prismaMock.call.create.mockRejectedValue(fakePrismaError("P2002"));

    const result = await ingestVonageCallEvent(outboundCompletedEvent);

    expect(result.outcome).toBe("ignored");
  });
});
