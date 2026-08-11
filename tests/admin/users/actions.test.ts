import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

/** A real PrismaClientKnownRequestError instance, for exercising the P2002 catch path. */
function fakePrismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(`Simulated ${code}`, { code, clientVersion: "test" });
}

const { prismaMock, requireCurrentUserMock, revalidatePathMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
  requireCurrentUserMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/session", () => ({ requireCurrentUser: requireCurrentUserMock }));

const { createUser, setUserActive, setUserMfaRequired, setUserRole } = await import("@/lib/admin/users/actions");

const admin = { id: "admin-1", role: "ADMIN" as const };
const otherAdmin = { id: "admin-2", role: "ADMIN" as const };
const staff = { id: "staff-1", role: "STAFF" as const };

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
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

  it("creates a fictional user, returns a temporary password once, and audits without the password", async () => {
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
    expect(createCall.data.mfaRequired).toBe(true);
    expect(createCall.data.mustChangePassword).toBe(true);

    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: {
        actorId: "admin-1",
        action: "CREATE",
        entityType: "User",
        entityId: "new-user-1",
        metadata: { role: "STAFF", mfaRequired: true },
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

describe("setUserRole", () => {
  it("rejects a non-ADMIN caller", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(staff);
    const result = await setUserRole(undefined, formData({ userId: "user-1", role: "ATTORNEY" }));
    expect(result).toMatch(/not found or access denied/i);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("changes role and audits the before/after", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(admin);
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: "user-1", role: "STAFF", active: true });

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
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: "admin-1", role: "ADMIN", active: true });
    prismaMock.user.count.mockResolvedValueOnce(0);

    const result = await setUserRole(undefined, formData({ userId: "admin-1", role: "STAFF" }));

    expect(result).toMatch(/last active admin/i);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("allows demoting an admin when another active admin still exists", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(otherAdmin);
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: "admin-1", role: "ADMIN", active: true });
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
});

describe("setUserActive", () => {
  it("rejects a non-ADMIN caller", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(staff);
    const result = await setUserActive(undefined, formData({ userId: "user-1", active: "false" }));
    expect(result).toMatch(/not found or access denied/i);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("deactivates a user and audits the change", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(admin);
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: "user-1", role: "STAFF", active: true });

    const result = await setUserActive(undefined, formData({ userId: "user-1", active: "false" }));

    expect(result).toBeUndefined();
    expect(prismaMock.user.update).toHaveBeenCalledWith({ where: { id: "user-1" }, data: { active: false } });
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: {
        actorId: "admin-1",
        action: "UPDATE",
        entityType: "User",
        entityId: "user-1",
        metadata: { field: "active", from: true, to: false },
      },
    });
  });

  it("reactivates a deactivated user", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(admin);
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: "user-1", role: "STAFF", active: false });

    const result = await setUserActive(undefined, formData({ userId: "user-1", active: "true" }));

    expect(result).toBeUndefined();
    expect(prismaMock.user.update).toHaveBeenCalledWith({ where: { id: "user-1" }, data: { active: true } });
  });

  it("blocks deactivating the last active admin", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(otherAdmin);
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: "admin-1", role: "ADMIN", active: true });
    prismaMock.user.count.mockResolvedValueOnce(0);

    const result = await setUserActive(undefined, formData({ userId: "admin-1", active: "false" }));

    expect(result).toMatch(/last active admin/i);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("blocks deactivating your own account through this action", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(admin);
    const result = await setUserActive(undefined, formData({ userId: "admin-1", active: "false" }));
    expect(result).toBeTruthy();
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

  it("blocks changing your own mfaRequired through this action, matching setUserRole/setUserActive's self-guard", async () => {
    requireCurrentUserMock.mockResolvedValueOnce(admin);
    const result = await setUserMfaRequired(undefined, formData({ userId: "admin-1", mfaRequired: "false" }));
    expect(result).toBeTruthy();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});
