import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

/** A real PrismaClientKnownRequestError instance, for exercising the P2002 catch path. */
function fakePrismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(`Simulated ${code}`, { code, clientVersion: "test" });
}

const { prismaMock, requireCurrentUserMock, revalidatePathMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn(), delete: vi.fn() },
    matterAssignment: { deleteMany: vi.fn() },
    auditEvent: { create: vi.fn() },
    $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  },
  requireCurrentUserMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/session", () => ({ requireCurrentUser: requireCurrentUserMock }));

const { approveUser, createUser, removeUser, resetUserPassword, setUserMfaRequired, setUserRole, setUserStatus } =
  await import("@/lib/admin/users/actions");

const admin = { id: "admin-1", role: "ADMIN" as const };
const otherAdmin = { id: "admin-2", role: "ADMIN" as const };
const staff = { id: "staff-1", role: "STAFF" as const };

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const ZERO_RELATIONS = {
  assignments: 0,
  assignedTasks: 0,
  authoredNotes: 0,
  uploadedDocuments: 0,
  filedCalls: 0,
  registeredDiscoveryFiles: 0,
  ranDiscoveryComparisons: 0,
  auditEvents: 0,
  archivedClients: 0,
  archivedMatters: 0,
  mfaRecoveryCodes: 0,
  mfaChallengeTickets: 0,
  failedLoginAttempts: 0,
  securityIncidents: 0,
  reviewedIntakeLeads: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
});

describe("createUser", () => {
  it("rejects a non-ADMIN caller", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(staff);

    const result = await createUser(
      undefined,
      formData({ name: "Jordan Rivera", email: "jordan@fryelawgroup.example", role: "STAFF" }),
    );

    expect(result.status).toBe("error");
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it("creates a fictional user as ACTIVE (already vetted by the admin), returns a temporary password once, and audits without the password", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(admin);
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    prismaMock.user.create.mockResolvedValueOnce({ id: "new-user-1", role: "STAFF", mfaRequired: true });

    const result = await createUser(
      undefined,
      formData({ name: "Jordan Rivera", email: "jordan@fryelawgroup.example", role: "STAFF", mfaRequired: "on" }),
    );

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.temporaryPassword).toBeTruthy();
      expect(result.temporaryPassword.length).toBeGreaterThanOrEqual(12);
    }

    const createCall = prismaMock.user.create.mock.calls[0]![0];
    expect(createCall.data.passwordHash).not.toBe(result.status === "success" ? result.temporaryPassword : "");
    expect(createCall.data.email).toBe("jordan@fryelawgroup.example");
    expect(createCall.data.role).toBe("STAFF");
    expect(createCall.data.status).toBe("ACTIVE");
    expect(createCall.data.mfaRequired).toBe(true);
    expect(createCall.data.mustChangePassword).toBe(true);

    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: {
        actorId: "admin-1",
        action: "CREATE",
        entityType: "User",
        entityId: "new-user-1",
        metadata: { role: "STAFF", mfaRequired: true, source: "admin_created" },
      },
    });
    const auditPayload = JSON.stringify(prismaMock.auditEvent.create.mock.calls[0]![0]);
    expect(auditPayload).not.toContain(result.status === "success" ? result.temporaryPassword : "unreachable");
  });

  it("rejects a duplicate email", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(admin);
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: "existing-user" });

    const result = await createUser(
      undefined,
      formData({ name: "Jordan Rivera", email: "jordan@fryelawgroup.example", role: "STAFF" }),
    );

    expect(result).toEqual({ status: "error", message: "A user with that email already exists." });
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it("rejects invalid input (bad email, missing name)", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(admin);

    const result = await createUser(undefined, formData({ name: "", email: "not-an-email", role: "STAFF" }));

    expect(result.status).toBe("error");
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it("returns a clean duplicate-email message (not a raw DB error) when two concurrent creates race past the findUnique check", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(admin);
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    prismaMock.user.create.mockRejectedValueOnce(fakePrismaError("P2002"));

    const result = await createUser(
      undefined,
      formData({ name: "Jordan Rivera", email: "jordan@fryelawgroup.example", role: "STAFF" }),
    );

    expect(result).toEqual({ status: "error", message: "A user with that email already exists." });
  });
});

describe("approveUser", () => {
  it("rejects a non-ADMIN caller", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(staff);
    const result = await approveUser(undefined, formData({ userId: "user-1", role: "STAFF" }));
    expect(result).toEqual({ status: "error", message: "Not found or access denied." });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("moves a PENDING account to ACTIVE with the admin-chosen role, and audits it", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(admin);
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: "user-1", status: "PENDING", role: "STAFF" });

    const result = await approveUser(undefined, formData({ userId: "user-1", role: "ATTORNEY" }));

    expect(result).toEqual({ status: "success" });
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { status: "ACTIVE", role: "ATTORNEY" },
    });
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: {
        actorId: "admin-1",
        action: "UPDATE",
        entityType: "User",
        entityId: "user-1",
        metadata: { field: "status", from: "PENDING", to: "ACTIVE", role: "ATTORNEY" },
      },
    });
  });

  it("refuses to approve an account that isn't PENDING", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(admin);
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: "user-1", status: "ACTIVE", role: "STAFF" });

    const result = await approveUser(undefined, formData({ userId: "user-1", role: "ATTORNEY" }));

    expect(result.status).toBe("error");
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("rejects an invalid role (crafted request)", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(admin);
    const result = await approveUser(undefined, formData({ userId: "user-1", role: "SUPERADMIN" }));
    expect(result.status).toBe("error");
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});

describe("setUserRole", () => {
  it("rejects a non-ADMIN caller", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(staff);
    const result = await setUserRole(undefined, formData({ userId: "user-1", role: "ATTORNEY" }));
    expect(result).toMatch(/not found or access denied/i);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("changes role and audits the before/after, without touching sessionInvalidatedAt", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(admin);
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: "user-1", role: "STAFF", status: "ACTIVE" });

    const result = await setUserRole(undefined, formData({ userId: "user-1", role: "PARALEGAL" }));

    expect(result).toBeUndefined();
    expect(prismaMock.user.update).toHaveBeenCalledWith({ where: { id: "user-1" }, data: { role: "PARALEGAL" } });
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: {
        actorId: "admin-1",
        action: "UPDATE",
        entityType: "User",
        entityId: "user-1",
        metadata: { field: "role", from: "STAFF", to: "PARALEGAL" },
      },
    });
  });

  it("blocks demoting the last active admin", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(otherAdmin);
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: "admin-1", role: "ADMIN", status: "ACTIVE" });
    prismaMock.user.count.mockResolvedValueOnce(0);

    const result = await setUserRole(undefined, formData({ userId: "admin-1", role: "STAFF" }));

    expect(result).toMatch(/last active admin/i);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("allows demoting an admin when another active admin still exists", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(otherAdmin);
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: "admin-1", role: "ADMIN", status: "ACTIVE" });
    prismaMock.user.count.mockResolvedValueOnce(1);

    const result = await setUserRole(undefined, formData({ userId: "admin-1", role: "STAFF" }));

    expect(result).toBeUndefined();
    expect(prismaMock.user.update).toHaveBeenCalled();
  });

  it("blocks changing your own role through this action", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(admin);
    const result = await setUserRole(undefined, formData({ userId: "admin-1", role: "STAFF" }));
    expect(result).toBeTruthy();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("refuses a role change on a still-PENDING account (must be approved first)", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(admin);
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: "user-1", role: "STAFF", status: "PENDING" });

    const result = await setUserRole(undefined, formData({ userId: "user-1", role: "ATTORNEY" }));

    expect(result).toMatch(/awaiting approval/i);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("rejects a crafted request naming a role outside the fixed set", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(admin);
    const result = await setUserRole(undefined, formData({ userId: "user-1", role: "SUPERADMIN" }));
    expect(result).toBe("Invalid request.");
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});

describe("setUserStatus", () => {
  it("rejects a non-ADMIN caller", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(staff);
    const result = await setUserStatus(undefined, formData({ userId: "user-1", status: "INACTIVE" }));
    expect(result).toMatch(/not found or access denied/i);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("deactivates a user, bumps sessionInvalidatedAt (ending their current session), and audits the change", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(admin);
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: "user-1", role: "STAFF", status: "ACTIVE" });

    const result = await setUserStatus(undefined, formData({ userId: "user-1", status: "INACTIVE" }));

    expect(result).toBeUndefined();
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { status: "INACTIVE", sessionInvalidatedAt: expect.any(Date) },
    });
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: {
        actorId: "admin-1",
        action: "UPDATE",
        entityType: "User",
        entityId: "user-1",
        metadata: { field: "status", from: "ACTIVE", to: "INACTIVE" },
      },
    });
  });

  it("reactivates a deactivated user without touching sessionInvalidatedAt", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(admin);
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: "user-1", role: "STAFF", status: "INACTIVE" });

    const result = await setUserStatus(undefined, formData({ userId: "user-1", status: "ACTIVE" }));

    expect(result).toBeUndefined();
    expect(prismaMock.user.update).toHaveBeenCalledWith({ where: { id: "user-1" }, data: { status: "ACTIVE" } });
  });

  it("blocks deactivating the last active admin", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(otherAdmin);
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: "admin-1", role: "ADMIN", status: "ACTIVE" });
    prismaMock.user.count.mockResolvedValueOnce(0);

    const result = await setUserStatus(undefined, formData({ userId: "admin-1", status: "INACTIVE" }));

    expect(result).toMatch(/last active admin/i);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("blocks deactivating your own account through this action", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(admin);
    const result = await setUserStatus(undefined, formData({ userId: "admin-1", status: "INACTIVE" }));
    expect(result).toBeTruthy();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("rejects a crafted request naming PENDING as a target status", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(admin);
    const result = await setUserStatus(undefined, formData({ userId: "user-1", status: "PENDING" }));
    expect(result).toBe("Invalid request.");
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("refuses to act on a still-PENDING account (must be approved first)", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(admin);
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: "user-1", role: "STAFF", status: "PENDING" });

    const result = await setUserStatus(undefined, formData({ userId: "user-1", status: "ACTIVE" }));

    expect(result).toMatch(/approve/i);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});

describe("setUserMfaRequired", () => {
  it("rejects a non-ADMIN caller", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(staff);
    const result = await setUserMfaRequired(undefined, formData({ userId: "user-1", mfaRequired: "true" }));
    expect(result).toMatch(/not found or access denied/i);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("toggles mfaRequired and audits the change", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(admin);
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: "user-1", mfaRequired: false });

    const result = await setUserMfaRequired(undefined, formData({ userId: "user-1", mfaRequired: "true" }));

    expect(result).toBeUndefined();
    expect(prismaMock.user.update).toHaveBeenCalledWith({ where: { id: "user-1" }, data: { mfaRequired: true } });
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: {
        actorId: "admin-1",
        action: "UPDATE",
        entityType: "User",
        entityId: "user-1",
        metadata: { field: "mfaRequired", from: false, to: true },
      },
    });
  });

  it("blocks changing your own mfaRequired through this action, matching setUserRole/setUserStatus's self-guard", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(admin);
    const result = await setUserMfaRequired(undefined, formData({ userId: "admin-1", mfaRequired: "false" }));
    expect(result).toBeTruthy();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});

describe("resetUserPassword", () => {
  it("rejects a non-ADMIN caller", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(staff);
    const result = await resetUserPassword("user-1");
    expect(result).toEqual({ status: "error", message: "Not found or access denied." });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("blocks resetting your own password through this action", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(admin);
    const result = await resetUserPassword("admin-1");
    expect(result.status).toBe("error");
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("generates a one-time temporary password, forces a change, ends the current session, and audits without the password", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(admin);
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: "user-1" });

    const result = await resetUserPassword("user-1");

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.temporaryPassword.length).toBeGreaterThanOrEqual(12);
    }
    const updateCall = prismaMock.user.update.mock.calls[0]![0];
    expect(updateCall.data.mustChangePassword).toBe(true);
    expect(updateCall.data.sessionInvalidatedAt).toBeInstanceOf(Date);
    expect(updateCall.data.passwordHash).not.toBe(result.status === "success" ? result.temporaryPassword : "");

    const auditPayload = JSON.stringify(prismaMock.auditEvent.create.mock.calls[0]![0]);
    expect(auditPayload).not.toContain(result.status === "success" ? result.temporaryPassword : "unreachable");
  });

  it("returns not-found for a nonexistent user", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(admin);
    prismaMock.user.findUnique.mockResolvedValueOnce(null);

    const result = await resetUserPassword("does-not-exist");

    expect(result).toEqual({ status: "error", message: "Not found or access denied." });
  });
});

describe("removeUser", () => {
  it("rejects a non-ADMIN caller", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(staff);
    const result = await removeUser("user-1");
    expect(result).toEqual({ status: "error", message: "Not found or access denied." });
    expect(prismaMock.user.delete).not.toHaveBeenCalled();
  });

  it("blocks removing your own account through this action", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(admin);
    const result = await removeUser("admin-1");
    expect(result.status).toBe("error");
    expect(prismaMock.user.delete).not.toHaveBeenCalled();
  });

  it("blocks removing the last active admin", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(otherAdmin);
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: "admin-1", role: "ADMIN", status: "ACTIVE" });
    prismaMock.user.count.mockResolvedValueOnce(0);

    const result = await removeUser("admin-1");

    expect(result).toEqual({ status: "error", message: "Cannot remove: this is the last active admin." });
    expect(prismaMock.user.delete).not.toHaveBeenCalled();
  });

  it("truly deletes an account with zero historical relations", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(admin);
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ id: "user-1", role: "STAFF", status: "ACTIVE" })
      .mockResolvedValueOnce({ _count: ZERO_RELATIONS });

    const result = await removeUser("user-1");

    expect(result).toEqual({ status: "deleted" });
    expect(prismaMock.user.delete).toHaveBeenCalledWith({ where: { id: "user-1" } });
    expect(prismaMock.matterAssignment.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: {
        actorId: "admin-1",
        action: "DELETE",
        entityType: "User",
        entityId: "user-1",
        metadata: { role: "STAFF" },
      },
    });
  });

  it("archives instead of deleting an account with any historical relation (e.g. an authored Note)", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(admin);
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ id: "user-1", role: "STAFF", status: "ACTIVE" })
      .mockResolvedValueOnce({ _count: { ...ZERO_RELATIONS, authoredNotes: 3 } });

    const result = await removeUser("user-1");

    expect(result).toEqual({ status: "archived" });
    expect(prismaMock.user.delete).not.toHaveBeenCalled();
    expect(prismaMock.matterAssignment.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-1" } });
    const auditCall = prismaMock.auditEvent.create.mock.calls[0]![0];
    expect(auditCall.data.metadata).toEqual({ field: "status", from: "ACTIVE", to: "INACTIVE", archived: true });
  });

  it("archives (never deletes) an account with a MatterAssignment on record", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(admin);
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ id: "user-1", role: "PARALEGAL", status: "ACTIVE" })
      .mockResolvedValueOnce({ _count: { ...ZERO_RELATIONS, assignments: 2 } });

    const result = await removeUser("user-1");

    expect(result).toEqual({ status: "archived" });
    expect(prismaMock.user.delete).not.toHaveBeenCalled();
  });

  it("returns not-found for a nonexistent user", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(admin);
    prismaMock.user.findUnique.mockResolvedValueOnce(null);

    const result = await removeUser("does-not-exist");

    expect(result).toEqual({ status: "error", message: "Not found or access denied." });
  });
});
