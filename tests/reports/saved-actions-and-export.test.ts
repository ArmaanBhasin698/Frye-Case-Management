import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireCurrentUserMock, getCurrentUserMock, prismaMock, runReportMock, recordActivityMock, redirectMock } = vi.hoisted(() => ({
  requireCurrentUserMock: vi.fn(),
  getCurrentUserMock: vi.fn(),
  runReportMock: vi.fn(),
  recordActivityMock: vi.fn(),
  redirectMock: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
  prismaMock: {
    savedReport: { create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/auth/session", () => ({ requireCurrentUser: requireCurrentUserMock, getCurrentUser: getCurrentUserMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/usage/record", () => ({ recordActivity: recordActivityMock }));
vi.mock("@/lib/reports/saved", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/reports/saved")>();
  return { ...actual, runReport: runReportMock };
});

const { deleteReport, renameReport, saveReport } = await import("@/lib/reports/saved-actions");
const { GET } = await import("@/app/(dashboard)/reports/export/[kind]/route");

const admin = { id: "u-admin", role: "ADMIN" as const, sessionId: "s1" };
const attorney = { id: "u-att", role: "ATTORNEY" as const, sessionId: "s2" };

function fd(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
}

async function exportCsv(kind: string, query = "") {
  return GET(new Request(`http://localhost/reports/export/${kind}${query}`), { params: Promise.resolve({ kind }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireCurrentUserMock.mockResolvedValue(attorney);
  getCurrentUserMock.mockResolvedValue(attorney);
  prismaMock.savedReport.create.mockResolvedValue({ id: "r-1" });
  redirectMock.mockImplementation(() => {
    throw new Error("NEXT_REDIRECT");
  });
});

describe("saved-report actions", () => {
  it("saves validated filters for the current owner, without filter values in the audit log", async () => {
    await expect(saveReport({ error: null }, fd({ kind: "SEARCH", name: "Ellis lookups", f_q: "ellis secret" }))).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(prismaMock.savedReport.create).toHaveBeenCalledWith({
      data: { ownerId: attorney.id, name: "Ellis lookups", kind: "SEARCH", filters: { q: "ellis secret", archived: "active" } },
    });
    expect(JSON.stringify(prismaMock.auditEvent.create.mock.calls)).not.toContain("secret");
  });

  it("refuses to save a USAGE report for a non-admin", async () => {
    expect((await saveReport({ error: null }, fd({ kind: "USAGE", name: "x" }))).error).toBe("Not found or access denied.");
    expect(prismaMock.savedReport.create).not.toHaveBeenCalled();
  });

  it("rejects invalid filters and unknown kinds", async () => {
    expect((await saveReport({ error: null }, fd({ kind: "SEARCH", name: "x", f_q: "a" }))).error).toMatch(/valid/);
    expect((await saveReport({ error: null }, fd({ kind: "PAYROLL", name: "x" }))).error).toMatch(/type/);
  });

  it("rename/delete only ever touch the caller's own reports (forged id → generic denial)", async () => {
    prismaMock.savedReport.updateMany.mockResolvedValue({ count: 0 });
    expect((await renameReport({ error: null }, fd({ reportId: "someone-elses", name: "mine now" }))).error).toBe(
      "Not found or access denied.",
    );
    expect(prismaMock.savedReport.updateMany).toHaveBeenCalledWith({
      where: { id: "someone-elses", ownerId: attorney.id },
      data: { name: "mine now" },
    });
    prismaMock.savedReport.deleteMany.mockResolvedValue({ count: 0 });
    expect((await deleteReport({ error: null }, fd({ reportId: "someone-elses" }))).error).toBe("Not found or access denied.");
    expect(prismaMock.savedReport.deleteMany).toHaveBeenCalledWith({ where: { id: "someone-elses", ownerId: attorney.id } });
  });
});

describe("CSV export route", () => {
  it("404s when not signed in, for unknown kinds, and for invalid filters", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    expect((await exportCsv("tasks")).status).toBe(404);
    getCurrentUserMock.mockResolvedValue(attorney);
    expect((await exportCsv("payroll")).status).toBe(404);
    expect((await exportCsv("search", "?q=a")).status).toBe(404);
    expect(runReportMock).not.toHaveBeenCalled();
  });

  it("404s a USAGE export for a non-admin (runReport refuses)", async () => {
    runReportMock.mockResolvedValue(null);
    expect((await exportCsv("usage")).status).toBe(404);
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
  });

  it("exports formula-safe CSV and audits kind + row count only — never the query text", async () => {
    runReportMock.mockResolvedValue({ columns: ["Title"], rows: [["=cmd|' /C calc'!A0"], ["Plain"]], truncated: false });
    const res = await exportCsv("search", "?q=privileged%20phrase");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const body = await res.text();
    expect(body).toContain("'=cmd");
    expect(runReportMock).toHaveBeenCalledWith(attorney, "SEARCH", { q: "privileged phrase", archived: "active" });
    const audit = prismaMock.auditEvent.create.mock.calls[0]![0].data;
    expect(audit).toMatchObject({ action: "EXPORT", entityType: "CsvExport", entityId: "SEARCH", metadata: { kind: "SEARCH", rows: 2 } });
    expect(JSON.stringify(audit)).not.toContain("privileged");
    expect(recordActivityMock).toHaveBeenCalledWith(expect.objectContaining({ type: "REPORT_EXPORT", resourceId: "SEARCH" }));
    expect(JSON.stringify(recordActivityMock.mock.calls)).not.toContain("privileged");
  });

  it("runs under the requesting user's own identity (admin vs attorney)", async () => {
    runReportMock.mockResolvedValue({ columns: ["a"], rows: [], truncated: false });
    getCurrentUserMock.mockResolvedValue(admin);
    await exportCsv("time", "?from=2026-01-01");
    expect(runReportMock).toHaveBeenCalledWith(admin, "TIME", { from: "2026-01-01" });
  });
});
