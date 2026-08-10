import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentUserMock, hasMatterAccessMock, prismaMock, documentStoreMock } = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  hasMatterAccessMock: vi.fn(),
  documentStoreMock: { read: vi.fn() },
  prismaMock: {
    discoveryFile: { findFirst: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: getCurrentUserMock }));
vi.mock("@/lib/auth/access", () => ({ hasMatterAccess: hasMatterAccessMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/storage/DocumentStore", () => ({ documentStore: documentStoreMock }));

const { GET } = await import(
  "@/app/(dashboard)/matters/[matterId]/discovery/files/[fileId]/route"
);

const user = { id: "user-1", role: "STAFF" as const };
const matterId = "matter-1";
const fileId = "file-1";

function callGet(params: { matterId: string; fileId: string }, search = "") {
  return GET(new NextRequest(`http://localhost/x${search}`), { params: Promise.resolve(params) });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Discovery file download route", () => {
  it("returns a generic 404 when not logged in", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    const response = await callGet({ matterId, fileId });
    expect(response.status).toBe(404);
    expect(prismaMock.discoveryFile.findFirst).not.toHaveBeenCalled();
  });

  it("returns a generic 404 when the user lacks matter access", async () => {
    getCurrentUserMock.mockResolvedValue(user);
    hasMatterAccessMock.mockResolvedValue(false);
    const response = await callGet({ matterId, fileId });
    expect(response.status).toBe(404);
    expect(prismaMock.discoveryFile.findFirst).not.toHaveBeenCalled();
  });

  it("returns a generic 404 for a fileId from a different matter (cross-matter probe)", async () => {
    getCurrentUserMock.mockResolvedValue(user);
    hasMatterAccessMock.mockResolvedValue(true);
    prismaMock.discoveryFile.findFirst.mockResolvedValue(null);
    const response = await callGet({ matterId, fileId: "file-in-other-matter" });
    expect(response.status).toBe(404);
    expect(prismaMock.discoveryFile.findFirst).toHaveBeenCalledWith({
      where: { id: "file-in-other-matter", production: { matterId } },
    });
    expect(documentStoreMock.read).not.toHaveBeenCalled();
  });

  it("returns a generic 404 (not a 500) when the storage layer can't read the file", async () => {
    getCurrentUserMock.mockResolvedValue(user);
    hasMatterAccessMock.mockResolvedValue(true);
    prismaMock.discoveryFile.findFirst.mockResolvedValue({
      id: fileId,
      originalStorageKey: "/legacy/fake-dropbox-path.pdf",
      stampedStorageKey: null,
      originalFilename: "evidence.pdf",
      mimeType: "application/pdf",
    });
    documentStoreMock.read.mockRejectedValue(new Error("ENOENT: ./local-data/discovery-files/x"));
    const response = await callGet({ matterId, fileId });
    expect(response.status).toBe(404);
    const body = await response.text();
    expect(body).not.toContain("ENOENT");
    expect(body).not.toContain("local-data");
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
  });

  it("returns a generic 404 when the requested variant was never stored (e.g. ?variant=stamped on a non-PDF)", async () => {
    getCurrentUserMock.mockResolvedValue(user);
    hasMatterAccessMock.mockResolvedValue(true);
    prismaMock.discoveryFile.findFirst.mockResolvedValue({
      id: fileId,
      originalStorageKey: "matters/matter-1/discovery/uuid/original",
      stampedStorageKey: null,
      originalFilename: "bodycam.mp4",
      mimeType: "video/mp4",
    });
    const response = await callGet({ matterId, fileId }, "?variant=stamped");
    expect(response.status).toBe(404);
    expect(documentStoreMock.read).not.toHaveBeenCalled();
  });

  it("streams the original file, sets download headers, and logs an EXPORT audit event on success", async () => {
    getCurrentUserMock.mockResolvedValue(user);
    hasMatterAccessMock.mockResolvedValue(true);
    prismaMock.discoveryFile.findFirst.mockResolvedValue({
      id: fileId,
      originalStorageKey: `matters/${matterId}/discovery/uuid/original`,
      stampedStorageKey: `matters/${matterId}/discovery/uuid/stamped`,
      originalFilename: "evidence.pdf",
      mimeType: "application/pdf",
    });
    documentStoreMock.read.mockResolvedValue(Buffer.from("%PDF-1.4 fictional content"));

    const response = await callGet({ matterId, fileId });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toContain('filename="evidence.pdf"');
    expect(documentStoreMock.read).toHaveBeenCalledWith(`matters/${matterId}/discovery/uuid/original`);

    const body = Buffer.from(await response.arrayBuffer());
    expect(body.toString("utf8")).toBe("%PDF-1.4 fictional content");

    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: {
        actorId: user.id,
        action: "EXPORT",
        entityType: "DiscoveryFile",
        entityId: fileId,
        matterId,
        metadata: { variant: "original" },
      },
    });
  });

  it("streams the stamped variant with a prefixed filename when ?variant=stamped is requested", async () => {
    getCurrentUserMock.mockResolvedValue(user);
    hasMatterAccessMock.mockResolvedValue(true);
    prismaMock.discoveryFile.findFirst.mockResolvedValue({
      id: fileId,
      originalStorageKey: `matters/${matterId}/discovery/uuid/original`,
      stampedStorageKey: `matters/${matterId}/discovery/uuid/stamped`,
      originalFilename: "evidence.pdf",
      mimeType: "application/pdf",
    });
    documentStoreMock.read.mockResolvedValue(Buffer.from("stamped-bytes"));

    const response = await callGet({ matterId, fileId }, "?variant=stamped");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toContain('filename="stamped-evidence.pdf"');
    expect(documentStoreMock.read).toHaveBeenCalledWith(`matters/${matterId}/discovery/uuid/stamped`);
  });
});
