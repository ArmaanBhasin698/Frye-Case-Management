import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, documentStoreSaveMock } = vi.hoisted(() => ({
  prismaMock: {
    call: { findUnique: vi.fn(), update: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
  documentStoreSaveMock: vi.fn(),
}));

class FakeDocumentAlreadyExistsError extends Error {}

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/storage/DocumentStore", () => ({
  documentStore: { save: documentStoreSaveMock, read: vi.fn() },
  DocumentAlreadyExistsError: FakeDocumentAlreadyExistsError,
}));

const { storeCallRecording } = await import("@/lib/telephony/recording");
const { fictionalRecordingBytes } = await import("@/lib/telephony/fixtures");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("storeCallRecording", () => {
  it("stores fictional recording bytes via DocumentStore under a call-scoped key and records where", async () => {
    prismaMock.call.findUnique.mockResolvedValue({ recordingDropboxPath: null, matterId: null });

    const result = await storeCallRecording("call-1", fictionalRecordingBytes);

    expect(result).toEqual({ outcome: "stored", storageKey: "calls/call-1/recording" });
    expect(documentStoreSaveMock).toHaveBeenCalledWith("calls/call-1/recording", fictionalRecordingBytes);
    expect(prismaMock.call.update).toHaveBeenCalledWith({
      where: { id: "call-1" },
      data: { recordingDropboxPath: "calls/call-1/recording" },
    });
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: {
        actorId: null,
        action: "UPDATE",
        entityType: "Call",
        entityId: "call-1",
        matterId: null,
        metadata: { field: "recordingDropboxPath", event: "recording_stored" },
      },
    });
  });

  it("carries the call's matterId (once filed) into the audit event", async () => {
    prismaMock.call.findUnique.mockResolvedValue({ recordingDropboxPath: null, matterId: "matter-1" });

    await storeCallRecording("call-1", fictionalRecordingBytes);

    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ matterId: "matter-1" }) }),
    );
  });

  it("returns call_not_found for a forged/nonexistent callId without calling DocumentStore", async () => {
    prismaMock.call.findUnique.mockResolvedValue(null);

    const result = await storeCallRecording("does-not-exist", fictionalRecordingBytes);

    expect(result).toEqual({ outcome: "call_not_found" });
    expect(documentStoreSaveMock).not.toHaveBeenCalled();
  });

  it("is a no-op when a recording is already stored for this call (DB check)", async () => {
    prismaMock.call.findUnique.mockResolvedValue({ recordingDropboxPath: "calls/call-1/recording", matterId: null });

    const result = await storeCallRecording("call-1", fictionalRecordingBytes);

    expect(result).toEqual({ outcome: "already_stored", storageKey: "calls/call-1/recording" });
    expect(documentStoreSaveMock).not.toHaveBeenCalled();
    expect(prismaMock.call.update).not.toHaveBeenCalled();
  });

  it("treats a DocumentAlreadyExistsError from a concurrent delivery as already_stored rather than throwing", async () => {
    prismaMock.call.findUnique.mockResolvedValue({ recordingDropboxPath: null, matterId: null });
    documentStoreSaveMock.mockRejectedValue(new FakeDocumentAlreadyExistsError("already there"));

    const result = await storeCallRecording("call-1", fictionalRecordingBytes);

    expect(result).toEqual({ outcome: "already_stored", storageKey: "calls/call-1/recording" });
    expect(prismaMock.call.update).not.toHaveBeenCalled();
  });

  it("propagates an unrelated storage failure rather than swallowing it", async () => {
    prismaMock.call.findUnique.mockResolvedValue({ recordingDropboxPath: null, matterId: null });
    documentStoreSaveMock.mockRejectedValue(new Error("provider outage"));

    await expect(storeCallRecording("call-1", fictionalRecordingBytes)).rejects.toThrow("provider outage");
  });
});
