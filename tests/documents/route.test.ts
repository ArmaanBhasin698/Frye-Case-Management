import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentUserMock, hasMatterAccessMock, prismaMock, documentStoreMock } = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  hasMatterAccessMock: vi.fn(),
  documentStoreMock: { read: vi.fn() },
  prismaMock: {
    document: { findFirst: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: getCurrentUserMock }));
vi.mock("@/lib/auth/access", () => ({ hasMatterAccess: hasMatterAccessMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/storage/DocumentStore", () => ({ documentStore: documentStoreMock }));

const { GET } = await import(
  "@/app/(dashboard)/matters/[matterId]/documents/files/[documentId]/route"
);

const user = { id: "user-1", role: "STAFF" as const };
const matterId = "matter-1";
const documentId = "doc-1";

function callGet(params: { matterId: string; documentId: string }) {
  return GET(new Request("http://localhost/x"), { params: Promise.resolve(params) });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Document download route", () => {
  it("returns a generic 404 when not logged in", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    const response = await callGet({ matterId, documentId });
    expect(response.status).toBe(404);
    expect(prismaMock.document.findFirst).not.toHaveBeenCalled();
  });

  it("returns a generic 404 when the user lacks matter access", async () => {
    getCurrentUserMock.mockResolvedValue(user);
    hasMatterAccessMock.mockResolvedValue(false);
    const response = await callGet({ matterId, documentId });
    expect(response.status).toBe(404);
    expect(prismaMock.document.findFirst).not.toHaveBeenCalled();
  });

  it("returns a generic 404 for a document id from a different matter (cross-matter probe)", async () => {
    getCurrentUserMock.mockResolvedValue(user);
    hasMatterAccessMock.mockResolvedValue(true);
    prismaMock.document.findFirst.mockResolvedValue(null);
    const response = await callGet({ matterId, documentId: "doc-in-other-matter" });
    expect(response.status).toBe(404);
    expect(prismaMock.document.findFirst).toHaveBeenCalledWith({
      where: { id: "doc-in-other-matter", matterId },
    });
    expect(documentStoreMock.read).not.toHaveBeenCalled();
  });

  it("returns a generic 404 (not a 500) when the storage layer can't read the file", async () => {
    getCurrentUserMock.mockResolvedValue(user);
    hasMatterAccessMock.mockResolvedValue(true);
    prismaMock.document.findFirst.mockResolvedValue({
      id: documentId,
      storageKey: "/legacy/fake-dropbox-path.pdf",
      originalFilename: null,
      mimeType: null,
    });
    documentStoreMock.read.mockRejectedValue(new Error("ENOENT: ./local-data/documents/x"));
    const response = await callGet({ matterId, documentId });
    expect(response.status).toBe(404);
    const body = await response.text();
    expect(body).not.toContain("ENOENT");
    expect(body).not.toContain("local-data");
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
  });

  it("streams the file, sets download headers, and logs an EXPORT audit event on success", async () => {
    getCurrentUserMock.mockResolvedValue(user);
    hasMatterAccessMock.mockResolvedValue(true);
    prismaMock.document.findFirst.mockResolvedValue({
      id: documentId,
      storageKey: `matters/${matterId}/documents/uuid/original`,
      originalFilename: "entry.pdf",
      mimeType: "application/pdf",
    });
    documentStoreMock.read.mockResolvedValue(Buffer.from("%PDF-1.4 fictional content"));

    const response = await callGet({ matterId, documentId });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toContain('filename="entry.pdf"');

    const body = Buffer.from(await response.arrayBuffer());
    expect(body.toString("utf8")).toBe("%PDF-1.4 fictional content");

    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: {
        actorId: user.id,
        action: "EXPORT",
        entityType: "Document",
        entityId: documentId,
        matterId,
      },
    });
  });
});
