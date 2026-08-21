import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, requireCurrentUserMock, revalidatePathMock } = vi.hoisted(() => ({
  prismaMock: {
    securityIncident: { findUnique: vi.fn(), update: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
  requireCurrentUserMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/session", () => ({ requireCurrentUser: requireCurrentUserMock }));

const { updateSecurityIncidentStatus } = await import("@/lib/security/actions");

const admin = { id: "admin-1", role: "ADMIN" as const };
const staff = { id: "staff-1", role: "STAFF" as const };
const attorney = { id: "attorney-1", role: "ATTORNEY" as const };

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("updateSecurityIncidentStatus — authorization boundary", () => {
  it("rejects a non-ADMIN (STAFF) caller without touching the database", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(staff);

    const result = await updateSecurityIncidentStatus(
      undefined,
      formData({ incidentId: "incident-1", nextStatus: "INVESTIGATING" }),
    );

    expect(result).toMatch(/not found or access denied/i);
    expect(prismaMock.securityIncident.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.securityIncident.update).not.toHaveBeenCalled();
  });

  it("rejects a non-ADMIN (ATTORNEY) caller — ATTORNEY has broader case access but no security-triage authority", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(attorney);

    const result = await updateSecurityIncidentStatus(
      undefined,
      formData({ incidentId: "incident-1", nextStatus: "INVESTIGATING" }),
    );

    expect(result).toMatch(/not found or access denied/i);
    expect(prismaMock.securityIncident.update).not.toHaveBeenCalled();
  });

  it("rejects a forged/nonexistent incident id for an admin", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(admin);
    prismaMock.securityIncident.findUnique.mockResolvedValueOnce(null);

    const result = await updateSecurityIncidentStatus(
      undefined,
      formData({ incidentId: "does-not-exist", nextStatus: "INVESTIGATING" }),
    );

    expect(result).toMatch(/not found or access denied/i);
    expect(prismaMock.securityIncident.update).not.toHaveBeenCalled();
  });
});

describe("updateSecurityIncidentStatus — lifecycle transitions", () => {
  it("allows OPEN -> INVESTIGATING for an admin and audits the change", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(admin);
    prismaMock.securityIncident.findUnique.mockResolvedValueOnce({ id: "incident-1", status: "OPEN" });

    const result = await updateSecurityIncidentStatus(
      undefined,
      formData({ incidentId: "incident-1", nextStatus: "INVESTIGATING" }),
    );

    expect(result).toBeUndefined();
    expect(prismaMock.securityIncident.update).toHaveBeenCalledWith({
      where: { id: "incident-1" },
      data: { status: "INVESTIGATING" },
    });
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: {
        actorId: "admin-1",
        action: "UPDATE",
        entityType: "SecurityIncident",
        entityId: "incident-1",
        metadata: { field: "status", from: "OPEN", to: "INVESTIGATING" },
      },
    });
  });

  it("rejects an invalid transition (RESOLVED is terminal) without writing anything", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(admin);
    prismaMock.securityIncident.findUnique.mockResolvedValueOnce({ id: "incident-1", status: "RESOLVED" });

    const result = await updateSecurityIncidentStatus(
      undefined,
      formData({ incidentId: "incident-1", nextStatus: "OPEN" }),
    );

    expect(result).toMatch(/cannot move an incident/i);
    expect(prismaMock.securityIncident.update).not.toHaveBeenCalled();
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
  });

  it("rejects skipping straight from OPEN to RESOLVED", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(admin);
    prismaMock.securityIncident.findUnique.mockResolvedValueOnce({ id: "incident-1", status: "OPEN" });

    const result = await updateSecurityIncidentStatus(
      undefined,
      formData({ incidentId: "incident-1", nextStatus: "RESOLVED" }),
    );

    expect(result).toMatch(/cannot move an incident/i);
    expect(prismaMock.securityIncident.update).not.toHaveBeenCalled();
  });

  it("rejects an invalid nextStatus value", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(admin);

    const result = await updateSecurityIncidentStatus(
      undefined,
      formData({ incidentId: "incident-1", nextStatus: "DELETED" }),
    );

    expect(result).toMatch(/invalid request/i);
    expect(prismaMock.securityIncident.findUnique).not.toHaveBeenCalled();
  });
});
