import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentUserMock, hasMatterAccessMock, listExpensesMock, prismaMock, recordActivityMock } = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  hasMatterAccessMock: vi.fn(),
  listExpensesMock: vi.fn(),
  recordActivityMock: vi.fn(),
  prismaMock: { auditEvent: { create: vi.fn() } },
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: getCurrentUserMock }));
vi.mock("@/lib/auth/access", () => ({ hasMatterAccess: hasMatterAccessMock }));
vi.mock("@/lib/usage/record", () => ({ recordActivity: recordActivityMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/expenses/queries", async () => {
  const actual = await vi.importActual<typeof import("@/lib/expenses/queries")>("@/lib/expenses/queries");
  return { ...actual, listExpenses: listExpensesMock };
});

const { GET } = await import("@/app/(dashboard)/expenses/export/route");

const attorney = { id: "u-att", role: "ATTORNEY" as const, sessionId: "s-1" };

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUserMock.mockResolvedValue(attorney);
  hasMatterAccessMock.mockResolvedValue(true);
  listExpensesMock.mockResolvedValue({ views: [], totals: {} });
});

describe("GET /expenses/export", () => {
  it("404s without a session", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    expect((await GET(new Request("http://x/expenses/export"))).status).toBe(404);
  });

  it("404s for a matter the user can't access instead of exporting an empty file", async () => {
    hasMatterAccessMock.mockResolvedValue(false);
    const res = await GET(new Request("http://x/expenses/export?matterId=m-secret"));
    expect(res.status).toBe(404);
    expect(listExpensesMock).not.toHaveBeenCalled();
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
  });

  it("returns CSV, audits the export without content, and records a usage export event", async () => {
    const res = await GET(new Request("http://x/expenses/export?matterId=m-1&category=EXPERT"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(listExpensesMock).toHaveBeenCalledWith(attorney, expect.objectContaining({ matterId: "m-1", category: "EXPERT" }), 5000);
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "EXPORT", entityType: "ExpenseExport", matterId: "m-1" }),
    });
    expect(recordActivityMock).toHaveBeenCalledWith(expect.objectContaining({ type: "REPORT_EXPORT", resourceType: "ExpenseCsv" }));
  });
});
