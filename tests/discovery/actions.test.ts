import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

/** A real PrismaClientKnownRequestError instance, for exercising the isForeignKeyConstraintError catch path. */
function fakePrismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(`Simulated ${code}`, { code, clientVersion: "test" });
}

const {
  requireCurrentUserMock,
  hasMatterAccessMock,
  prismaMock,
  revalidatePathMock,
  hashBufferMock,
  getPdfPageCountMock,
  stampBatesNumbersMock,
  documentStoreSaveMock,
  compareProductionFilesMock,
} = vi.hoisted(() => ({
  requireCurrentUserMock: vi.fn(),
  hasMatterAccessMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  hashBufferMock: vi.fn(),
  getPdfPageCountMock: vi.fn(),
  stampBatesNumbersMock: vi.fn(),
  documentStoreSaveMock: vi.fn(),
  compareProductionFilesMock: vi.fn(),
  prismaMock: {
    discoveryProduction: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    discoveryFile: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    discoveryComparison: { create: vi.fn() },
    auditEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/auth/session", () => ({ requireCurrentUser: requireCurrentUserMock }));
vi.mock("@/lib/auth/access", () => ({ hasMatterAccess: hasMatterAccessMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/discovery/hash", () => ({ hashBuffer: hashBufferMock }));
vi.mock("@/lib/discovery/pdf", () => ({
  getPdfPageCount: getPdfPageCountMock,
  stampBatesNumbers: stampBatesNumbersMock,
}));
vi.mock("@/lib/discovery/compare", () => ({ compareProductionFiles: compareProductionFilesMock }));
vi.mock("@/lib/storage/DocumentStore", () => ({
  documentStore: { save: documentStoreSaveMock, read: vi.fn() },
}));

const { createDiscoveryProduction, registerDiscoveryFile, runDiscoveryComparison } = await import(
  "@/lib/discovery/actions"
);

const user = { id: "user-1", role: "STAFF" as const };
const matterId = "matter-1";

function formData(fields: Record<string, FormDataEntryValue>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireCurrentUserMock.mockResolvedValue(user);
  hasMatterAccessMock.mockResolvedValue(true);
  hashBufferMock.mockReturnValue("fake-hash");
  getPdfPageCountMock.mockResolvedValue(1);
  stampBatesNumbersMock.mockResolvedValue(Buffer.from(""));
  compareProductionFilesMock.mockReturnValue([]);
  prismaMock.discoveryFile.findMany.mockResolvedValue([]);
  prismaMock.discoveryProduction.findFirst.mockResolvedValue(null);
  prismaMock.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(prismaMock));
});

describe("createDiscoveryProduction", () => {
  it("rejects a missing label before touching the database", async () => {
    const result = await createDiscoveryProduction(
      { error: null },
      formData({ matterId, label: "", receivedDate: "2026-01-01" }),
    );
    expect(result.error).toBeTruthy();
    expect(prismaMock.discoveryProduction.create).not.toHaveBeenCalled();
  });

  it("rejects an invalid Bates prefix", async () => {
    const result = await createDiscoveryProduction(
      { error: null },
      formData({ matterId, label: "Initial Production", receivedDate: "2026-01-01", batesPrefix: "bad prefix!" }),
    );
    expect(result.error).toBeTruthy();
    expect(prismaMock.discoveryProduction.create).not.toHaveBeenCalled();
  });

  it("denies creation when the user lacks matter access", async () => {
    hasMatterAccessMock.mockResolvedValue(false);
    const result = await createDiscoveryProduction(
      { error: null },
      formData({ matterId, label: "Initial Production", receivedDate: "2026-01-01" }),
    );
    expect(result.error).toBe("Not found or access denied.");
    expect(prismaMock.discoveryProduction.create).not.toHaveBeenCalled();
  });

  it("creates the production and an audit event for an authorized user", async () => {
    prismaMock.discoveryProduction.create.mockResolvedValue({ id: "prod-1" });
    const result = await createDiscoveryProduction(
      { error: null },
      formData({ matterId, label: "Initial Production", receivedDate: "2026-01-01", batesPrefix: "ellis" }),
    );
    expect(result.error).toBeNull();
    expect(prismaMock.discoveryProduction.create).toHaveBeenCalledWith({
      data: { matterId, label: "Initial Production", source: undefined, receivedDate: new Date("2026-01-01"), batesPrefix: "ELLIS" },
    });
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: {
        actorId: user.id,
        action: "CREATE",
        entityType: "DiscoveryProduction",
        entityId: "prod-1",
        matterId,
        metadata: { label: "Initial Production", batesPrefix: "ELLIS" },
      },
    });
  });

  it("returns a generic not-found instead of throwing when matterId is a forged/nonexistent id (e.g. an ADMIN whose hasMatterAccess bypasses the assignment check)", async () => {
    prismaMock.discoveryProduction.create.mockRejectedValue(fakePrismaError("P2003"));
    const result = await createDiscoveryProduction(
      { error: null },
      formData({ matterId, label: "Initial Production", receivedDate: "2026-01-01" }),
    );
    expect(result.error).toBe("Not found or access denied.");
  });
});

describe("registerDiscoveryFile", () => {
  const productionId = "prod-1";

  it("rejects a request with no file", async () => {
    const result = await registerDiscoveryFile(
      { error: null },
      formData({ matterId, productionId, fileType: "PDF" }),
    );
    expect(result.error).toBeTruthy();
    expect(documentStoreSaveMock).not.toHaveBeenCalled();
  });

  it("denies registration when the user lacks matter access", async () => {
    hasMatterAccessMock.mockResolvedValue(false);
    const file = new File(["hello"], "evidence.pdf", { type: "application/pdf" });
    const result = await registerDiscoveryFile(
      { error: null },
      formData({ matterId, productionId, fileType: "PDF", file }),
    );
    expect(result.error).toBe("Not found or access denied.");
    expect(prismaMock.discoveryProduction.findFirst).not.toHaveBeenCalled();
    expect(documentStoreSaveMock).not.toHaveBeenCalled();
  });

  it("denies registration when the production doesn't belong to the given matter", async () => {
    prismaMock.discoveryProduction.findFirst.mockResolvedValue(null);
    const file = new File(["hello"], "evidence.pdf", { type: "application/pdf" });
    const result = await registerDiscoveryFile(
      { error: null },
      formData({ matterId, productionId, fileType: "PDF", file }),
    );
    expect(result.error).toBe("Not found or access denied.");
    expect(documentStoreSaveMock).not.toHaveBeenCalled();
  });

  it("registers a non-PDF file with a sequential evidence identifier, no Bates numbering", async () => {
    prismaMock.discoveryProduction.findFirst.mockResolvedValue({ id: productionId, batesPrefix: "ELLIS", batesStart: null, batesEnd: null });
    prismaMock.discoveryFile.findMany.mockResolvedValue([{ batesEnd: null }]);
    const created = { id: "file-1", originalFilename: "bodycam.mp4", sizeBytes: 5 };
    prismaMock.discoveryFile.create.mockResolvedValue(created);

    const file = new File(["hello"], "bodycam.mp4", { type: "video/mp4" });
    const result = await registerDiscoveryFile(
      { error: null },
      formData({ matterId, productionId, fileType: "VIDEO", file }),
    );

    expect(result.error).toBeNull();
    expect(getPdfPageCountMock).not.toHaveBeenCalled();
    expect(prismaMock.discoveryFile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        productionId,
        originalFilename: "bodycam.mp4",
        identifier: "ELLIS-0002",
        fileType: "VIDEO",
        contentHash: "fake-hash",
        pageCount: null,
        batesStart: null,
        batesEnd: null,
        registeredById: user.id,
      }),
    });
    expect(prismaMock.discoveryProduction.update).not.toHaveBeenCalled();
    expect(prismaMock.auditEvent.create).toHaveBeenCalledTimes(1);
  });

  it("registers a PDF with Bates numbering, stamps a derivative, and logs a separate bates-generation audit event", async () => {
    prismaMock.discoveryProduction.findFirst.mockResolvedValue({ id: productionId, batesPrefix: "ELLIS", batesStart: null, batesEnd: null });
    prismaMock.discoveryFile.findMany.mockResolvedValue([]);
    getPdfPageCountMock.mockResolvedValue(4);
    stampBatesNumbersMock.mockResolvedValue(Buffer.from("stamped-bytes"));
    const created = { id: "file-2", originalFilename: "incident-report.pdf", sizeBytes: 5 };
    prismaMock.discoveryFile.create.mockResolvedValue(created);

    const file = new File(["hello"], "incident-report.pdf", { type: "application/pdf" });
    const result = await registerDiscoveryFile(
      { error: null },
      formData({ matterId, productionId, fileType: "PDF", file }),
    );

    expect(result.error).toBeNull();
    expect(prismaMock.discoveryFile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        identifier: "ELLIS000001-ELLIS000004",
        pageCount: 4,
        batesStart: 1,
        batesEnd: 4,
        stampedStorageKey: expect.stringContaining("stamped.pdf"),
      }),
    });
    expect(prismaMock.discoveryProduction.update).toHaveBeenCalledWith({
      where: { id: productionId },
      data: { batesStart: 1, batesEnd: 4 },
    });
    // One CREATE for the file itself, one UPDATE for the Bates-generation event.
    expect(prismaMock.auditEvent.create).toHaveBeenCalledTimes(2);
    expect(prismaMock.auditEvent.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        action: "UPDATE",
        entityType: "DiscoveryFile",
        metadata: expect.objectContaining({ event: "bates_generated", batesStart: 1, batesEnd: 4 }),
      }),
    });
  });

  it("returns a friendly error and writes nothing when the uploaded PDF can't be parsed", async () => {
    prismaMock.discoveryProduction.findFirst.mockResolvedValue({ id: productionId, batesPrefix: "ELLIS", batesStart: null, batesEnd: null });
    getPdfPageCountMock.mockRejectedValue(new Error("not a pdf"));

    const file = new File(["not really a pdf"], "fake.pdf", { type: "application/pdf" });
    const result = await registerDiscoveryFile(
      { error: null },
      formData({ matterId, productionId, fileType: "PDF", file }),
    );

    expect(result.error).toBeTruthy();
    expect(documentStoreSaveMock).not.toHaveBeenCalled();
  });
});

describe("runDiscoveryComparison", () => {
  it("rejects comparing a production against itself", async () => {
    const result = await runDiscoveryComparison(
      { error: null },
      formData({ matterId, fromProductionId: "prod-1", toProductionId: "prod-1" }),
    );
    expect(result.error).toBeTruthy();
    expect(prismaMock.discoveryComparison.create).not.toHaveBeenCalled();
  });

  it("denies running a comparison when the user lacks matter access", async () => {
    hasMatterAccessMock.mockResolvedValue(false);
    const result = await runDiscoveryComparison(
      { error: null },
      formData({ matterId, fromProductionId: "prod-1", toProductionId: "prod-2" }),
    );
    expect(result.error).toBe("Not found or access denied.");
    expect(prismaMock.discoveryComparison.create).not.toHaveBeenCalled();
  });

  it("denies running a comparison when either production doesn't belong to the matter", async () => {
    prismaMock.discoveryProduction.findFirst
      .mockResolvedValueOnce({ id: "prod-1", label: "Initial", files: [] })
      .mockResolvedValueOnce(null);
    const result = await runDiscoveryComparison(
      { error: null },
      formData({ matterId, fromProductionId: "prod-1", toProductionId: "prod-2" }),
    );
    expect(result.error).toBe("Not found or access denied.");
    expect(prismaMock.discoveryComparison.create).not.toHaveBeenCalled();
  });

  it("persists the computed matches and logs an audit event with status counts", async () => {
    prismaMock.discoveryProduction.findFirst
      .mockResolvedValueOnce({ id: "prod-1", label: "Initial Production", files: [{ id: "f1" }] })
      .mockResolvedValueOnce({ id: "prod-2", label: "Supplemental Production 1", files: [{ id: "f2" }] });
    compareProductionFilesMock.mockReturnValue([
      { status: "NEW", filename: "b.pdf", identifier: "X", fileId: "f2", matchedFromFileId: null, notes: "New." },
    ]);
    prismaMock.discoveryComparison.create.mockResolvedValue({ id: "cmp-1" });

    const result = await runDiscoveryComparison(
      { error: null },
      formData({ matterId, fromProductionId: "prod-1", toProductionId: "prod-2" }),
    );

    expect(result.error).toBeNull();
    expect(prismaMock.discoveryComparison.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        matterId,
        fromProductionId: "prod-1",
        toProductionId: "prod-2",
        runById: user.id,
        matches: { create: [{ status: "NEW", filename: "b.pdf", identifier: "X", fileId: "f2", notes: "New." }] },
      }),
    });
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "CREATE",
        entityType: "DiscoveryComparison",
        entityId: "cmp-1",
        metadata: expect.objectContaining({ counts: { NEW: 1 } }),
      }),
    });
  });
});
