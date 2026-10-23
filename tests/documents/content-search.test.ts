import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, hasMatterAccessMock, getAssignedMatterIdsMock, storeMock } = vi.hoisted(() => ({
  prismaMock: {
    $queryRaw: vi.fn(),
    documentVersion: { findUnique: vi.fn(), findMany: vi.fn() },
    documentTextIndex: { upsert: vi.fn() },
  },
  hasMatterAccessMock: vi.fn(),
  getAssignedMatterIdsMock: vi.fn(),
  storeMock: { read: vi.fn(), save: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/access", () => ({ hasMatterAccess: hasMatterAccessMock, getAssignedMatterIds: getAssignedMatterIdsMock }));
vi.mock("@/lib/storage/DocumentStore", () => ({ documentStore: storeMock }));

const { normalizeContentQuery, searchDocumentContent, snippetSegments } = await import("@/lib/documents/content-search");
const { indexDocumentVersion, reindexPending } = await import("@/lib/documents/indexing");
const { pdfWithoutText } = await import("./fixtures");

const admin = { id: "a", role: "ADMIN" as const };
const staff = { id: "s", role: "STAFF" as const };

type SqlLike = { sql: string; values: unknown[] };
const isSql = (a: unknown): a is SqlLike => typeof a === "object" && a !== null && "values" in a && "sql" in a;

/** Every bound value passed to the $queryRaw call (nested Prisma.sql fragments flattened). */
function boundValues(callIndex: number): unknown[] {
  const args = prismaMock.$queryRaw.mock.calls[callIndex]!.slice(1);
  return args.flatMap((a: unknown) => (isSql(a) ? a.values : [a]));
}
function sqlText(callIndex: number): string {
  const [strings, ...args] = prismaMock.$queryRaw.mock.calls[callIndex]!;
  return (strings as string[]).join("?") + args.map((a: unknown) => (isSql(a) ? a.sql : "")).join(" ");
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) =>
    strings.join("").includes("COUNT(*)") ? [{ count: BigInt(1) }] : [{ documentId: "d1", matterId: "m1", title: "Memo", versionId: "v1", version: 1, snippet: "the [[body]] cam" }],
  );
});

describe("searchDocumentContent scoping", () => {
  it("binds the caller's assigned matter ids into the SQL WHERE (before LIMIT/OFFSET and COUNT)", async () => {
    getAssignedMatterIdsMock.mockResolvedValue(["m1", "m2"]);
    const result = await searchDocumentContent(staff, "body cam", { take: 10, skip: 20 });
    expect(result.total).toBe(1);
    for (const i of [0, 1]) {
      expect(boundValues(i)).toEqual(expect.arrayContaining(["body cam", "m1", "m2"]));
      expect(sqlText(i)).toContain(`d."matterId" IN`);
      expect(sqlText(i)).toContain(`'INDEXED'`);
      expect(sqlText(i)).toContain(`d."currentVersionId" = v."id"`);
    }
    expect(boundValues(0)).toEqual(expect.arrayContaining([10, 20]));
  });

  it("never queries when the caller has no matters, or asks for a matter they can't access", async () => {
    getAssignedMatterIdsMock.mockResolvedValue([]);
    expect(await searchDocumentContent(staff, "body cam")).toEqual({ hits: [], total: 0 });
    hasMatterAccessMock.mockResolvedValue(false);
    expect(await searchDocumentContent(staff, "body cam", { matterId: "m-secret" })).toEqual({ hits: [], total: 0 });
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });

  it("filters to one accessible matter, and admins are unrestricted", async () => {
    hasMatterAccessMock.mockResolvedValue(true);
    await searchDocumentContent(staff, "memo", { matterId: "m1" });
    expect(boundValues(0)).toContain("m1");
    expect(getAssignedMatterIdsMock).not.toHaveBeenCalled();
    prismaMock.$queryRaw.mockClear();
    await searchDocumentContent(admin, "memo");
    expect(sqlText(0)).toContain("TRUE");
  });

  it("bounds and normalizes the query, and ignores too-short input", async () => {
    expect(normalizeContentQuery(`  a   b ${"x".repeat(500)}`).length).toBe(200);
    expect(await searchDocumentContent(admin, " a ")).toEqual({ hits: [], total: 0 });
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });

  it("clamps page size", async () => {
    await searchDocumentContent(admin, "memo", { take: 10_000, skip: -5 });
    expect(boundValues(0)).toEqual(expect.arrayContaining([50, 0]));
  });

  it("turns highlight markers into plain-text segments (no HTML)", () => {
    expect(snippetSegments("the [[body]] cam [[video]]")).toEqual([
      { text: "the ", match: false },
      { text: "body", match: true },
      { text: " cam ", match: false },
      { text: "video", match: true },
    ]);
    expect(snippetSegments("<b>x</b> [[y")).toEqual([{ text: "<b>x</b> [[y", match: false }]);
  });
});

describe("indexing", () => {
  it("records a scanned/no-text PDF as UNSUPPORTED (so it can never match)", async () => {
    prismaMock.documentVersion.findUnique.mockResolvedValue({ id: "v1", storageKey: "k", mimeType: "application/pdf", originalFilename: "scan.pdf" });
    storeMock.read.mockResolvedValue(await pdfWithoutText());
    await indexDocumentVersion("v1");
    expect(prismaMock.documentTextIndex.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ status: "UNSUPPORTED", text: null }) }),
    );
  });

  it("records FAILED (never throws) when bytes can't be read", async () => {
    prismaMock.documentVersion.findUnique.mockResolvedValue({ id: "v1", storageKey: "k", mimeType: "text/plain", originalFilename: "a.txt" });
    storeMock.read.mockRejectedValue(new Error("gone"));
    await expect(indexDocumentVersion("v1")).resolves.toBeUndefined();
    expect(prismaMock.documentTextIndex.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ status: "FAILED" }) }));
  });

  it("reindexes only current versions that are unindexed/pending/failed, bounded", async () => {
    prismaMock.documentVersion.findMany.mockResolvedValue([]);
    await reindexPending(25);
    expect(prismaMock.documentVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 25, where: expect.objectContaining({ currentFor: { isNot: null } }) }),
    );
  });
});
