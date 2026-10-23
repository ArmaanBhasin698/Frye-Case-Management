import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentUserMock, hasMatterAccessMock, prismaMock } = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  hasMatterAccessMock: vi.fn(),
  prismaMock: {
    matter: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    timeEntry: { findMany: vi.fn() },
    userSession: { findMany: vi.fn() },
    userActivityEvent: { findMany: vi.fn() },
    userActivityMinute: { findMany: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: getCurrentUserMock }));
vi.mock("@/lib/auth/access", () => ({ hasMatterAccess: hasMatterAccessMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

const matterTime = await import("@/app/(dashboard)/reports/pdf/matter-time/route");
const firm = await import("@/app/(dashboard)/reports/pdf/firm-utilization/route");
const employee = await import("@/app/(dashboard)/reports/pdf/employee-activity/route");

const admin = { id: "u-admin", role: "ADMIN" as const };
const attorney = { id: "u-att", role: "ATTORNEY" as const };
const req = (path: string) => new Request(`http://localhost${path}`);

beforeEach(() => {
  vi.clearAllMocks();
  hasMatterAccessMock.mockResolvedValue(true);
  prismaMock.matter.findUnique.mockResolvedValue({
    caseNumber: "25-CR-01044",
    court: "Example Court (fictional)",
    status: "OPEN",
    client: { firstName: "Jane", lastName: "Doe" },
  });
  prismaMock.user.findUnique.mockResolvedValue({ name: "Jane Doe", email: "jane@example.com", role: "STAFF" });
  for (const m of [prismaMock.timeEntry, prismaMock.userSession, prismaMock.userActivityEvent, prismaMock.userActivityMinute]) {
    m.findMany.mockResolvedValue([]);
  }
});

describe("matter time PDF route", () => {
  it("404s when signed out", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    expect((await matterTime.GET(req("/reports/pdf/matter-time?matterId=m-1"))).status).toBe(404);
  });

  it("404s without matter access (forged matter id) and never queries entries", async () => {
    getCurrentUserMock.mockResolvedValue(attorney);
    hasMatterAccessMock.mockResolvedValue(false);
    expect((await matterTime.GET(req("/reports/pdf/matter-time?matterId=m-secret"))).status).toBe(404);
    expect(prismaMock.timeEntry.findMany).not.toHaveBeenCalled();
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
  });

  it("404s on a malformed date range", async () => {
    getCurrentUserMock.mockResolvedValue(attorney);
    expect((await matterTime.GET(req("/reports/pdf/matter-time?matterId=m-1&from=bad"))).status).toBe(404);
  });

  it("returns a PDF and audits the export for an authorized user", async () => {
    getCurrentUserMock.mockResolvedValue(attorney);
    const res = await matterTime.GET(req("/reports/pdf/matter-time?matterId=m-1&from=2026-09-01&to=2026-09-30"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(new TextDecoder().decode((await res.arrayBuffer()).slice(0, 5))).toBe("%PDF-");
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "EXPORT", entityType: "MatterTimeReport", matterId: "m-1" }),
    });
  });
});

describe("admin-only PDF routes", () => {
  it("firm utilization 404s for non-admins and works for ADMIN", async () => {
    getCurrentUserMock.mockResolvedValue(attorney);
    expect((await firm.GET(req("/reports/pdf/firm-utilization"))).status).toBe(404);
    expect(prismaMock.timeEntry.findMany).not.toHaveBeenCalled();
    getCurrentUserMock.mockResolvedValue(admin);
    expect((await firm.GET(req("/reports/pdf/firm-utilization"))).status).toBe(200);
  });

  it("employee activity 404s for non-admins, for unknown users, and works for ADMIN", async () => {
    getCurrentUserMock.mockResolvedValue(attorney);
    expect((await employee.GET(req("/reports/pdf/employee-activity?userId=u-1"))).status).toBe(404);
    expect(prismaMock.userSession.findMany).not.toHaveBeenCalled();

    getCurrentUserMock.mockResolvedValue(admin);
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    expect((await employee.GET(req("/reports/pdf/employee-activity?userId=u-ghost"))).status).toBe(404);

    const res = await employee.GET(req("/reports/pdf/employee-activity?userId=u-1&from=2026-09-01&to=2026-09-30"));
    expect(res.status).toBe(200);
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "EXPORT", entityType: "EmployeeActivityReport", entityId: "u-1" }),
    });
  });
});
