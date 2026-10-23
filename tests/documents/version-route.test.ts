import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentUserMock, hasMatterAccessMock, prismaMock, storeMock, recordActivityMock } = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  hasMatterAccessMock: vi.fn(),
  recordActivityMock: vi.fn(),
  storeMock: { read: vi.fn() },
  prismaMock: {
    document: { findFirst: vi.fn() },
    documentVersion: { findFirst: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: getCurrentUserMock }));
vi.mock("@/lib/auth/access", () => ({ hasMatterAccess: hasMatterAccessMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/storage/DocumentStore", () => ({ documentStore: storeMock }));
vi.mock("@/lib/usage/record", () => ({ recordActivity: recordActivityMock }));

const { GET: getVersion } = await import(
  "@/app/(dashboard)/matters/[matterId]/documents/files/[documentId]/versions/[versionId]/route"
);
const { GET: getCurrent } = await import("@/app/(dashboard)/matters/[matterId]/documents/files/[documentId]/route");

const user = { id: "u-1", role: "PARALEGAL" as const, sessionId: "s-1" };
const call = (p: { matterId: string; documentId: string; versionId: string }) =>
  getVersion(new Request("http://localhost/x"), { params: Promise.resolve(p) });
const params = { matterId: "m-1", documentId: "doc-1", versionId: "ver-1" };

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUserMock.mockResolvedValue(user);
  hasMatterAccessMock.mockResolvedValue(true);
  storeMock.read.mockResolvedValue(Buffer.from("fictional bytes v1"));
  prismaMock.documentVersion.findFirst.mockResolvedValue({
    id: "ver-1",
    version: 1,
    storageKey: "matters/m-1/documents/k1/original",
    originalFilename: "memo.pdf",
    mimeType: "application/pdf",
  });
});

describe("version download route", () => {
  it("404s when not signed in or without matter access (and records the denial)", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    expect((await call(params)).status).toBe(404);
    getCurrentUserMock.mockResolvedValue(user);
    hasMatterAccessMock.mockResolvedValue(false);
    expect((await call(params)).status).toBe(404);
    expect(recordActivityMock).toHaveBeenCalledWith(expect.objectContaining({ type: "ACCESS_DENIED", result: "DENIED" }));
    expect(storeMock.read).not.toHaveBeenCalled();
  });

  it("scopes the version to that document AND matter, so forged/stale/cross-matter ids 404", async () => {
    prismaMock.documentVersion.findFirst.mockResolvedValue(null);
    expect((await call({ ...params, versionId: "ver-of-other-matter" })).status).toBe(404);
    expect(prismaMock.documentVersion.findFirst).toHaveBeenCalledWith({
      where: { id: "ver-of-other-matter", documentId: "doc-1", document: { matterId: "m-1" } },
    });
    expect(storeMock.read).not.toHaveBeenCalled();
  });

  it("404s when the stored bytes can't be read", async () => {
    storeMock.read.mockRejectedValue(new Error("missing"));
    expect((await call(params)).status).toBe(404);
  });

  it("streams that exact version's bytes and audits/records the download with ids only", async () => {
    const res = await call(params);
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("fictional bytes v1");
    expect(storeMock.read).toHaveBeenCalledWith("matters/m-1/documents/k1/original");
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "EXPORT", entityId: "doc-1", matterId: "m-1", metadata: { version: 1, versionId: "ver-1" } }),
    });
    expect(recordActivityMock).toHaveBeenCalledWith(expect.objectContaining({ type: "DOCUMENT_DOWNLOAD", resourceId: "ver-1" }));
  });
});

describe("legacy documents (no version rows)", () => {
  it("still download through the existing route from the Document's own storage columns", async () => {
    prismaMock.document.findFirst.mockResolvedValue({
      id: "doc-legacy",
      matterId: "m-1",
      storageKey: "matters/m-1/documents/legacy/original",
      currentVersionId: null,
      originalFilename: "old.txt",
      mimeType: "text/plain",
      title: "Old",
    });
    storeMock.read.mockResolvedValue(Buffer.from("legacy bytes"));
    const res = await getCurrent(new Request("http://localhost/x"), {
      params: Promise.resolve({ matterId: "m-1", documentId: "doc-legacy" }),
    });
    expect(res.status).toBe(200);
    expect(storeMock.read).toHaveBeenCalledWith("matters/m-1/documents/legacy/original");
  });
});
