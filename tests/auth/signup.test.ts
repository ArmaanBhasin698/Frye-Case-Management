import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

function fakePrismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(`Simulated ${code}`, { code, clientVersion: "test" });
}

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn(), create: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

const { registerAccount } = await import("@/lib/auth/signup");

const VALID_FIELDS = {
  firstName: "Jordan",
  lastName: "Ellis",
  email: "jordan.ellis@fryelawgroup.example",
  password: "correct-horse-battery",
  confirmPassword: "correct-horse-battery",
};

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("registerAccount", () => {
  it("creates a PENDING account with role STAFF, hashes the password, and audits without the password", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    prismaMock.user.create.mockResolvedValueOnce({ id: "new-user-1", role: "STAFF" });

    const result = await registerAccount(undefined, formData(VALID_FIELDS));

    expect(result).toEqual({ status: "success" });
    const createCall = prismaMock.user.create.mock.calls[0]![0];
    expect(createCall.data.status).toBe("PENDING");
    expect(createCall.data.role).toBe("STAFF");
    expect(createCall.data.email).toBe("jordan.ellis@fryelawgroup.example");
    expect(createCall.data.name).toBe("Jordan Ellis");
    expect(createCall.data.passwordHash).not.toBe(VALID_FIELDS.password);
    expect(await bcrypt.compare(VALID_FIELDS.password, createCall.data.passwordHash)).toBe(true);

    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: {
        actorId: null,
        action: "CREATE",
        entityType: "User",
        entityId: "new-user-1",
        metadata: { role: "STAFF", source: "self_registered" },
      },
    });
    const auditPayload = JSON.stringify(prismaMock.auditEvent.create.mock.calls[0]![0]);
    expect(auditPayload).not.toContain(VALID_FIELDS.password);
  });

  it("normalizes the email to lowercase/trimmed before checking uniqueness and storing it", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    prismaMock.user.create.mockResolvedValueOnce({ id: "new-user-1", role: "STAFF" });

    await registerAccount(undefined, formData({ ...VALID_FIELDS, email: "  Jordan.Ellis@FryeLawGroup.example  " }));

    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({ where: { email: "jordan.ellis@fryelawgroup.example" } });
    expect(prismaMock.user.create.mock.calls[0]![0].data.email).toBe("jordan.ellis@fryelawgroup.example");
  });

  it("ignores any role field a crafted request tries to smuggle in — it's never even read", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    prismaMock.user.create.mockResolvedValueOnce({ id: "new-user-1", role: "STAFF" });

    await registerAccount(undefined, formData({ ...VALID_FIELDS, role: "ADMIN" }));

    expect(prismaMock.user.create.mock.calls[0]![0].data.role).toBe("STAFF");
  });

  it("rejects a duplicate email with a generic message that doesn't reveal the existing account's role or status", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: "existing-admin", role: "ADMIN", status: "ACTIVE" });

    const result = await registerAccount(undefined, formData(VALID_FIELDS));

    expect(result).toEqual({
      status: "error",
      message: "If this email already has an account, sign in instead or contact an administrator.",
    });
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it("returns the same generic message (not a raw DB error) when two concurrent signups race past the findUnique check", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    prismaMock.user.create.mockRejectedValueOnce(fakePrismaError("P2002"));

    const result = await registerAccount(undefined, formData(VALID_FIELDS));

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toMatch(/already has an account/i);
    }
  });

  it("rejects a missing first name", async () => {
    const result = await registerAccount(undefined, formData({ ...VALID_FIELDS, firstName: "" }));
    expect(result.status).toBe("error");
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it("rejects an invalid email", async () => {
    const result = await registerAccount(undefined, formData({ ...VALID_FIELDS, email: "not-an-email" }));
    expect(result.status).toBe("error");
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it("rejects a password shorter than 12 characters", async () => {
    const result = await registerAccount(
      undefined,
      formData({ ...VALID_FIELDS, password: "short1234", confirmPassword: "short1234" }),
    );
    expect(result.status).toBe("error");
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it("rejects mismatched password confirmation", async () => {
    const result = await registerAccount(
      undefined,
      formData({ ...VALID_FIELDS, confirmPassword: "a-completely-different-password" }),
    );
    expect(result.status).toBe("error");
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });
});
