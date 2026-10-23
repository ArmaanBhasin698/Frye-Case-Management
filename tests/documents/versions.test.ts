import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const { requireCurrentUserMock, hasMatterAccessMock, prismaMock, storeMock, scheduleIndexingMock } = vi.hoisted(() => ({
  requireCurrentUserMock: vi.fn(),
  hasMatterAccessMock: vi.fn(),
  scheduleIndexingMock: vi.fn(),
  storeMock: { save: vi.fn(), read: vi.fn() },
  prismaMock: {
    document: { findFirst: vi.fn(), update: vi.fn() },
    documentVersion: { count: vi.fn(), create: vi.fn(), aggregate: vi.fn() },
    auditEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireCurrentUser: requireCurrentUserMock }));
vi.mock("@/lib/auth/access", () => ({ hasMatterAccess: hasMatterAccessMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/storage/DocumentStore", () => ({ documentStore: storeMock }));
vi.mock("@/lib/documents/schedule", () => ({ scheduleIndexing: scheduleIndexingMock }));

const { uploadDocumentVersion } = await import("@/lib/documents/version-actions");

const user = { id: "u-staff", role: "STAFF" as const };
const legacyDoc = {
  id: "doc-1",
  matterId: "m-1",
  storageKey: "matters/m-1/documents/old-key/original",
  originalFilename: "Jane Doe draft.pdf",
  mimeType: "application/pdf",
  sizeBytes: 10,
  contentHash: "a".repeat(64),
  uploadedById: "u-original",
  uploadedAt: new Date("2026-01-01"),
};

function fd(fields: Record<string, string>, file?: File) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  if (file) f.set("file", file);
  return f;
}
const pdf = () => new File(["%PDF-1.4 fictional v2"], "motion v2.pdf", { type: "application/pdf" });

beforeEach(() => {
  vi.clearAllMocks();
  requireCurrentUserMock.mockResolvedValue(user);
  hasMatterAccessMock.mockResolvedValue(true);
  prismaMock.document.findFirst.mockResolvedValue(legacyDoc);
  prismaMock.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(prismaMock));
  prismaMock.documentVersion.count.mockResolvedValue(2);
  prismaMock.documentVersion.aggregate.mockResolvedValue({ _max: { version: 2 } });
  prismaMock.documentVersion.create.mockImplementation(async ({ data }: { data: { version: number } }) => ({ id: `ver-${data.version}`, version: data.version }));
});

describe("uploadDocumentVersion", () => {
  it("denies without matter access, before storing anything", async () => {
    hasMatterAccessMock.mockResolvedValue(false);
    expect((await uploadDocumentVersion({ error: null }, fd({ matterId: "m-1", documentId: "doc-1" }, pdf()))).error).toBe(
      "Not found or access denied.",
    );
    expect(storeMock.save).not.toHaveBeenCalled();
  });

  it("refuses a document id from another matter (forged)", async () => {
    prismaMock.document.findFirst.mockResolvedValue(null);
    const result = await uploadDocumentVersion({ error: null }, fd({ matterId: "m-1", documentId: "doc-elsewhere" }, pdf()));
    expect(result.error).toBe("Not found or access denied.");
    expect(prismaMock.document.findFirst).toHaveBeenCalledWith({ where: { id: "doc-elsewhere", matterId: "m-1" } });
    expect(storeMock.save).not.toHaveBeenCalled();
  });

  it("stores the new bytes under a fresh key — the previous version's bytes are never overwritten", async () => {
    await uploadDocumentVersion({ error: null }, fd({ matterId: "m-1", documentId: "doc-1" }, pdf()));
    const [savedKey] = storeMock.save.mock.calls[0]!;
    expect(savedKey).not.toBe(legacyDoc.storageKey);
    expect(savedKey).toMatch(/^matters\/m-1\/documents\/[0-9a-f-]{36}\/original$/);
    expect(storeMock.save).toHaveBeenCalledTimes(1);
  });

  it("appends max+1 and moves the document's current pointer and storage columns in one transaction", async () => {
    const result = await uploadDocumentVersion({ error: null }, fd({ matterId: "m-1", documentId: "doc-1" }, pdf()));
    expect(result.error).toBeNull();
    expect(prismaMock.documentVersion.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.documentVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ documentId: "doc-1", version: 3, uploadedById: user.id, originalFilename: "motion v2.pdf" }),
    });
    expect(prismaMock.document.update).toHaveBeenCalledWith({
      where: { id: "doc-1" },
      data: expect.objectContaining({ currentVersionId: "ver-3", originalFilename: "motion v2.pdf" }),
    });
    expect(scheduleIndexingMock).toHaveBeenCalledWith("ver-3");
  });

  it("records a legacy document's implicit v1 (from its own columns) before adding v2", async () => {
    prismaMock.documentVersion.count.mockResolvedValue(0);
    prismaMock.documentVersion.aggregate.mockResolvedValue({ _max: { version: 1 } });
    await uploadDocumentVersion({ error: null }, fd({ matterId: "m-1", documentId: "doc-1" }, pdf()));
    expect(prismaMock.documentVersion.create.mock.calls[0]![0].data).toMatchObject({
      version: 1,
      storageKey: legacyDoc.storageKey,
      contentHash: legacyDoc.contentHash,
      uploadedById: "u-original",
      createdAt: legacyDoc.uploadedAt,
    });
    expect(prismaMock.documentVersion.create.mock.calls[1]![0].data).toMatchObject({ version: 2 });
  });

  it("turns a concurrent same-version race into a retry message, not a merged write", async () => {
    prismaMock.$transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "t" }));
    const result = await uploadDocumentVersion({ error: null }, fd({ matterId: "m-1", documentId: "doc-1" }, pdf()));
    expect(result.error).toMatch(/same moment/);
    expect(scheduleIndexingMock).not.toHaveBeenCalled();
  });

  it("never writes the filename into audit metadata", async () => {
    await uploadDocumentVersion({ error: null }, fd({ matterId: "m-1", documentId: "doc-1" }, pdf()));
    expect(JSON.stringify(prismaMock.auditEvent.create.mock.calls)).not.toContain("motion v2");
  });

  it("rejects disallowed file types", async () => {
    const exe = new File(["MZ"], "tool.exe", { type: "application/octet-stream" });
    expect((await uploadDocumentVersion({ error: null }, fd({ matterId: "m-1", documentId: "doc-1" }, exe))).error).toMatch(/Unsupported/);
  });
});
