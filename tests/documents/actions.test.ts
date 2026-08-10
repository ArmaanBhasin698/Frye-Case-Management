import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireCurrentUserMock, hasMatterAccessMock, prismaMock, revalidatePathMock, documentStoreMock } =
  vi.hoisted(() => ({
    requireCurrentUserMock: vi.fn(),
    hasMatterAccessMock: vi.fn(),
    revalidatePathMock: vi.fn(),
    documentStoreMock: { save: vi.fn(), read: vi.fn() },
    prismaMock: {
      document: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
      auditEvent: { create: vi.fn() },
    },
  }));

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/auth/session", () => ({ requireCurrentUser: requireCurrentUserMock }));
vi.mock("@/lib/auth/access", () => ({ hasMatterAccess: hasMatterAccessMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/storage/DocumentStore", () => ({ documentStore: documentStoreMock }));

const { updateDocumentMetadata, uploadDocument } = await import("@/lib/documents/actions");
const { isAllowedDocumentFile } = await import("@/lib/documents/validation");

const user = { id: "user-1", role: "STAFF" as const };
const matterId = "matter-1";

function formDataWithFile(
  fields: Record<string, string>,
  file: { name: string; type: string; content: string } | null,
) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  if (file) {
    fd.set("file", new File([file.content], file.name, { type: file.type }));
  }
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireCurrentUserMock.mockResolvedValue(user);
  hasMatterAccessMock.mockResolvedValue(true);
});

describe("isAllowedDocumentFile", () => {
  it("allows common law-office file types by extension", () => {
    expect(isAllowedDocumentFile("motion.pdf", "application/pdf")).toBe(true);
    expect(isAllowedDocumentFile("letter.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(true);
    expect(isAllowedDocumentFile("exhibit.jpg", "image/jpeg")).toBe(true);
    expect(isAllowedDocumentFile("notes.txt", "")).toBe(true);
  });

  it("allows an extension match even when the browser reports a generic/empty MIME type", () => {
    expect(isAllowedDocumentFile("scan.pdf", "application/octet-stream")).toBe(true);
    expect(isAllowedDocumentFile("scan.pdf", "")).toBe(true);
  });

  it("rejects disallowed extensions", () => {
    expect(isAllowedDocumentFile("script.exe", "application/octet-stream")).toBe(false);
    expect(isAllowedDocumentFile("archive.zip", "application/zip")).toBe(false);
    expect(isAllowedDocumentFile("noextension", "application/pdf")).toBe(false);
  });

  it("rejects an extension paired with a specific, mismatched MIME type", () => {
    expect(isAllowedDocumentFile("fake.pdf", "application/x-msdownload")).toBe(false);
  });
});

describe("uploadDocument", () => {
  const validFields = { matterId, title: "Entry of Appearance", category: "PLEADING", notes: "" };
  const validFile = { name: "entry.pdf", type: "application/pdf", content: "%PDF-1.4 fictional content" };

  it("rejects a missing title before touching storage", async () => {
    const result = await uploadDocument(
      { error: null },
      formDataWithFile({ ...validFields, title: "" }, validFile),
    );
    expect(result?.error).toBeTruthy();
    expect(documentStoreMock.save).not.toHaveBeenCalled();
  });

  it("rejects an empty file", async () => {
    const result = await uploadDocument(
      { error: null },
      formDataWithFile(validFields, { name: "empty.pdf", type: "application/pdf", content: "" }),
    );
    expect(result?.error).toBeTruthy();
    expect(documentStoreMock.save).not.toHaveBeenCalled();
  });

  it("rejects an oversized file", async () => {
    const bigContent = "a".repeat(26 * 1024 * 1024);
    const result = await uploadDocument(
      { error: null },
      formDataWithFile(validFields, { name: "big.pdf", type: "application/pdf", content: bigContent }),
    );
    expect(result?.error).toBeTruthy();
    expect(documentStoreMock.save).not.toHaveBeenCalled();
  });

  it("rejects a disallowed file type before touching storage or the database", async () => {
    const result = await uploadDocument(
      { error: null },
      formDataWithFile(validFields, { name: "script.exe", type: "application/octet-stream", content: "MZ" }),
    );
    expect(result?.error).toBeTruthy();
    expect(documentStoreMock.save).not.toHaveBeenCalled();
    expect(prismaMock.document.create).not.toHaveBeenCalled();
  });

  it("denies the upload when the user lacks matter access, without writing to storage", async () => {
    hasMatterAccessMock.mockResolvedValue(false);
    const result = await uploadDocument({ error: null }, formDataWithFile(validFields, validFile));
    expect(result?.error).toBe("Not found or access denied.");
    expect(documentStoreMock.save).not.toHaveBeenCalled();
    expect(prismaMock.document.create).not.toHaveBeenCalled();
  });

  it("generates a server-controlled storage key that never contains the raw filename", async () => {
    prismaMock.document.create.mockResolvedValue({ id: "doc-1" });
    await uploadDocument({ error: null }, formDataWithFile(validFields, validFile));

    expect(documentStoreMock.save).toHaveBeenCalledTimes(1);
    const call = documentStoreMock.save.mock.calls.at(0);
    const [key, buffer] = call ?? [];
    expect(key).toMatch(/^matters\/matter-1\/documents\/[0-9a-f-]{36}\/original$/);
    expect(key).not.toContain("entry.pdf");
    expect(Buffer.isBuffer(buffer)).toBe(true);
  });

  it("preserves the exact original bytes passed to the store", async () => {
    prismaMock.document.create.mockResolvedValue({ id: "doc-1" });
    await uploadDocument({ error: null }, formDataWithFile(validFields, validFile));
    const call = documentStoreMock.save.mock.calls.at(0);
    const buffer = call?.[1];
    expect(buffer?.toString("utf8")).toBe(validFile.content);
  });

  it("creates the document with hashed content and full metadata, then writes an audit event", async () => {
    prismaMock.document.create.mockResolvedValue({ id: "doc-1" });
    const result = await uploadDocument({ error: null }, formDataWithFile(validFields, validFile));
    expect(result.error).toBeNull();

    expect(prismaMock.document.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        matterId,
        category: "PLEADING",
        title: "Entry of Appearance",
        originalFilename: "entry.pdf",
        mimeType: "application/pdf",
        sizeBytes: validFile.content.length,
        uploadedById: user.id,
        contentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        storageKey: expect.stringMatching(/^matters\/matter-1\/documents\/[0-9a-f-]{36}\/original$/),
      }),
    });
    // The audit log must never carry the raw uploaded filename — it can
    // disclose a client's real name or case details (see the comment
    // above `storageKey` in lib/documents/actions.ts). Only safe, derived
    // fields belong here.
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: {
        actorId: user.id,
        action: "CREATE",
        entityType: "Document",
        entityId: "doc-1",
        matterId,
        metadata: { sizeBytes: validFile.content.length, category: "PLEADING" },
      },
    });
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({ originalFilename: expect.anything() }),
        }),
      }),
    );
  });

  it("gives two uploads sharing a filename distinct storage keys, so neither overwrites the other", async () => {
    prismaMock.document.create.mockResolvedValueOnce({ id: "doc-1" }).mockResolvedValueOnce({ id: "doc-2" });
    await uploadDocument({ error: null }, formDataWithFile(validFields, validFile));
    await uploadDocument(
      { error: null },
      formDataWithFile(validFields, { ...validFile, content: "different fictional content" }),
    );

    expect(documentStoreMock.save).toHaveBeenCalledTimes(2);
    const firstKey = documentStoreMock.save.mock.calls.at(0)?.[0];
    const secondKey = documentStoreMock.save.mock.calls.at(1)?.[0];
    expect(firstKey).not.toBe(secondKey);
    expect(prismaMock.document.create).toHaveBeenCalledTimes(2);
  });

  it("reports a generic failure and does not throw a raw Prisma error when the database write fails", async () => {
    prismaMock.document.create.mockRejectedValue(new Error("connection refused at 10.0.0.5:5432"));
    const result = await uploadDocument({ error: null }, formDataWithFile(validFields, validFile));
    expect(result.error).toBe("Failed to save document.");
    expect(result.error).not.toContain("10.0.0.5");
  });
});

describe("updateDocumentMetadata", () => {
  const documentId = "doc-1";
  const validFields = { matterId, documentId, title: "Amended Entry of Appearance", category: "PLEADING", notes: "" };

  function formData(fields: Record<string, string>) {
    const fd = new FormData();
    for (const [key, value] of Object.entries(fields)) fd.set(key, value);
    return fd;
  }

  beforeEach(() => {
    prismaMock.document.findFirst.mockResolvedValue({
      title: "Entry of Appearance",
      category: "PLEADING",
      notes: null,
    });
  });

  it("denies the edit when the user lacks matter access", async () => {
    hasMatterAccessMock.mockResolvedValue(false);
    const result = await updateDocumentMetadata({ error: null }, formData(validFields));
    expect(result?.error).toBe("Not found or access denied.");
    expect(prismaMock.document.update).not.toHaveBeenCalled();
  });

  it("scopes the lookup to the given matter, denying a cross-matter document id", async () => {
    prismaMock.document.findFirst.mockResolvedValue(null);
    const result = await updateDocumentMetadata({ error: null }, formData(validFields));
    expect(result?.error).toBe("Not found or access denied.");
    expect(prismaMock.document.findFirst).toHaveBeenCalledWith({
      where: { id: documentId, matterId },
      select: { title: true, category: true, notes: true },
    });
    expect(prismaMock.document.update).not.toHaveBeenCalled();
  });

  it("never touches storage when editing metadata", async () => {
    prismaMock.document.update.mockResolvedValue({});
    await updateDocumentMetadata({ error: null }, formData(validFields));
    expect(documentStoreMock.save).not.toHaveBeenCalled();
  });

  it("updates metadata and writes an audit event with a before/after diff", async () => {
    prismaMock.document.update.mockResolvedValue({});
    const result = await updateDocumentMetadata({ error: null }, formData(validFields));
    expect(result.error).toBeNull();
    expect(prismaMock.document.update).toHaveBeenCalledWith({
      where: { id: documentId },
      data: { title: "Amended Entry of Appearance", category: "PLEADING", notes: null },
    });
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "UPDATE",
        entityType: "Document",
        entityId: documentId,
        metadata: expect.objectContaining({
          changed: { title: { before: "Entry of Appearance", after: "Amended Entry of Appearance" } },
        }),
      }),
    });
  });

  it("records only that notes changed, never their content", async () => {
    prismaMock.document.update.mockResolvedValue({});
    await updateDocumentMetadata(
      { error: null },
      formData({ ...validFields, title: "Entry of Appearance", notes: "Sensitive case detail." }),
    );
    const call = prismaMock.auditEvent.create.mock.calls.at(0)?.[0];
    expect(call.data.metadata.notesChanged).toBe(true);
    expect(JSON.stringify(call)).not.toContain("Sensitive case detail.");
  });

  it("writes no audit event when nothing actually changed", async () => {
    prismaMock.document.findFirst.mockResolvedValue({
      title: "Amended Entry of Appearance",
      category: "PLEADING",
      notes: null,
    });
    prismaMock.document.update.mockResolvedValue({});
    await updateDocumentMetadata({ error: null }, formData(validFields));
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
  });
});
