import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseFolderPath, parseFolderSetPaths, parseTags, wouldCreateCycle, folderDepth } from "@/lib/documents/folders";

const { requireCurrentUserMock, hasMatterAccessMock, prismaMock, storeMock } = vi.hoisted(() => ({
  requireCurrentUserMock: vi.fn(),
  hasMatterAccessMock: vi.fn(),
  storeMock: { save: vi.fn(), read: vi.fn() },
  prismaMock: {
    document: { findFirst: vi.fn(), update: vi.fn() },
    documentFolder: { findMany: vi.fn(), create: vi.fn(), count: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    documentFolderSet: { findFirst: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    documentFolderSetItem: { deleteMany: vi.fn(), createMany: vi.fn() },
    auditEvent: { create: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireCurrentUser: requireCurrentUserMock }));
vi.mock("@/lib/auth/access", () => ({ hasMatterAccess: hasMatterAccessMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/storage/DocumentStore", () => ({ documentStore: storeMock }));

const { applyFolderSet, createFolder, moveDocument, moveFolder, saveFolderSet, setDocumentTags } = await import(
  "@/lib/documents/folder-actions"
);

const staff = { id: "u-staff", role: "STAFF" as const };
const admin = { id: "u-admin", role: "ADMIN" as const };
const NOT_FOUND = "Not found or access denied.";

function fd(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireCurrentUserMock.mockResolvedValue(staff);
  hasMatterAccessMock.mockResolvedValue(true);
  prismaMock.$transaction.mockImplementation((arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: unknown) => unknown)(prismaMock) : Promise.all(arg as Promise<unknown>[]),
  );
  prismaMock.documentFolder.findMany.mockResolvedValue([]);
  let n = 0;
  prismaMock.documentFolder.create.mockImplementation(async () => ({ id: `new-${++n}` }));
});

describe("pure folder helpers", () => {
  it("parses and validates folder paths and folder-set text", () => {
    expect(parseFolderPath(" Discovery / Body cam ")).toEqual(["Discovery", "Body cam"]);
    expect(parseFolderPath("a/b/c/d/e")).toBeNull();
    expect(parseFolderSetPaths("Pleadings\n\npleadings\nDiscovery/Video\n" + "x".repeat(101))).toEqual({
      paths: ["Pleadings", "Discovery/Video"],
      invalid: ["x".repeat(101)],
    });
  });

  it("detects cycles and depth", () => {
    const folders = [
      { id: "a", parentId: null },
      { id: "b", parentId: "a" },
      { id: "c", parentId: "b" },
    ];
    expect(wouldCreateCycle(folders, "a", "c")).toBe(true);
    expect(wouldCreateCycle(folders, "c", "a")).toBe(false);
    expect(folderDepth(folders, "c")).toBe(3);
  });

  it("normalizes tags and bounds them", () => {
    expect(parseTags("Exhibit, privileged , exhibit")).toEqual({ tags: ["exhibit", "privileged"], error: null });
    expect(parseTags(Array.from({ length: 11 }, (_, i) => `t${i}`).join(",")).error).toMatch(/At most/);
  });
});

describe("folder actions", () => {
  it("serializes folder writes per matter with an advisory lock and rejects duplicate names", async () => {
    prismaMock.documentFolder.findMany.mockResolvedValue([{ id: "f1", parentId: null, name: "Motions" }]);
    const result = await createFolder({ error: null }, fd({ matterId: "m-1", name: "motions" }));
    expect(result.error).toMatch(/already exists/);
    expect(prismaMock.$executeRaw).toHaveBeenCalled();
    expect(prismaMock.documentFolder.create).not.toHaveBeenCalled();
  });

  it("refuses a parent folder from another matter", async () => {
    const result = await createFolder({ error: null }, fd({ matterId: "m-1", name: "Sub", parentId: "folder-other-matter" }));
    expect(result.error).toBe(NOT_FOUND);
  });

  it("requires matter access", async () => {
    hasMatterAccessMock.mockResolvedValue(false);
    expect((await createFolder({ error: null }, fd({ matterId: "m-x", name: "A" }))).error).toBe(NOT_FOUND);
    expect((await moveDocument({ error: null }, fd({ matterId: "m-x", documentId: "d" }))).error).toBe(NOT_FOUND);
    expect((await setDocumentTags({ error: null }, fd({ matterId: "m-x", documentId: "d", tags: "a" }))).error).toBe(NOT_FOUND);
  });

  it("refuses to move a folder inside its own subtree", async () => {
    prismaMock.documentFolder.findMany.mockResolvedValue([
      { id: "a", parentId: null, name: "A" },
      { id: "b", parentId: "a", name: "B" },
    ]);
    expect((await moveFolder({ error: null }, fd({ matterId: "m-1", folderId: "a", parentId: "b" }))).error).toMatch(/inside itself/);
  });

  it("moving a document changes only its folderId — never bytes, storage, or matter", async () => {
    prismaMock.document.findFirst.mockResolvedValue({ id: "d1", folderId: null });
    prismaMock.documentFolder.count.mockResolvedValue(1);
    expect((await moveDocument({ error: null }, fd({ matterId: "m-1", documentId: "d1", folderId: "f1" }))).error).toBeNull();
    expect(prismaMock.document.update).toHaveBeenCalledWith({ where: { id: "d1" }, data: { folderId: "f1" } });
    expect(storeMock.save).not.toHaveBeenCalled();
    expect(storeMock.read).not.toHaveBeenCalled();
  });

  it("refuses moving a document into another matter's folder", async () => {
    prismaMock.document.findFirst.mockResolvedValue({ id: "d1", folderId: null });
    prismaMock.documentFolder.count.mockResolvedValue(0);
    expect((await moveDocument({ error: null }, fd({ matterId: "m-1", documentId: "d1", folderId: "foreign" }))).error).toBe(NOT_FOUND);
    expect(prismaMock.document.update).not.toHaveBeenCalled();
  });

  it("keeps tag text out of the audit log", async () => {
    prismaMock.document.findFirst.mockResolvedValue({ id: "d1" });
    await setDocumentTags({ error: null }, fd({ matterId: "m-1", documentId: "d1", tags: "jane-doe-alibi" }));
    expect(JSON.stringify(prismaMock.auditEvent.create.mock.calls)).not.toContain("jane-doe-alibi");
  });
});

describe("folder sets", () => {
  const set = {
    id: "set-1",
    items: [
      { path: "Discovery", position: 0 },
      { path: "Discovery/Video", position: 1 },
      { path: "Motions", position: 2 },
    ],
  };

  it("applies idempotently: creates only missing folders (case-insensitive), under the lock", async () => {
    prismaMock.documentFolderSet.findFirst.mockResolvedValue(set);
    prismaMock.documentFolder.findMany.mockResolvedValue([{ id: "existing-disc", parentId: null, name: "discovery" }]);
    expect((await applyFolderSet({ error: null }, fd({ matterId: "m-1", setId: "set-1" }))).error).toBeNull();
    expect(prismaMock.$executeRaw).toHaveBeenCalled();
    expect(prismaMock.documentFolder.create.mock.calls.map((c) => [c[0].data.name, c[0].data.parentId])).toEqual([
      ["Video", "existing-disc"],
      ["Motions", null],
    ]);
  });

  it("creates nothing when every folder already exists", async () => {
    prismaMock.documentFolderSet.findFirst.mockResolvedValue(set);
    prismaMock.documentFolder.findMany.mockResolvedValue([
      { id: "d", parentId: null, name: "Discovery" },
      { id: "v", parentId: "d", name: "Video" },
      { id: "m", parentId: null, name: "Motions" },
    ]);
    await applyFolderSet({ error: null }, fd({ matterId: "m-1", setId: "set-1" }));
    expect(prismaMock.documentFolder.create).not.toHaveBeenCalled();
  });

  it("only ADMIN can manage the folder-set library", async () => {
    expect((await saveFolderSet({ error: null }, fd({ name: "Std", paths: "A" }))).error).toBe(NOT_FOUND);
    requireCurrentUserMock.mockResolvedValue(admin);
    prismaMock.documentFolderSet.create.mockResolvedValue({ id: "set-new" });
    expect((await saveFolderSet({ error: null }, fd({ name: "Std", paths: "A\nA/B" }))).error).toBeNull();
    expect(prismaMock.documentFolderSetItem.createMany).toHaveBeenCalledWith({
      data: [
        { setId: "set-new", path: "A", position: 0 },
        { setId: "set-new", path: "A/B", position: 1 },
      ],
    });
  });

  it("does not apply an archived/unknown set", async () => {
    prismaMock.documentFolderSet.findFirst.mockResolvedValue(null);
    expect((await applyFolderSet({ error: null }, fd({ matterId: "m-1", setId: "gone" }))).error).toBe(NOT_FOUND);
  });
});
