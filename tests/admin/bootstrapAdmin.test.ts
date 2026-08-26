import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

function fakePrismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(`Simulated ${code}`, { code, clientVersion: "test" });
}

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { count: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

const { bootstrapAdmin } = await import("@/lib/admin/bootstrapAdmin");

const VALID_INPUT = { name: "Alex Rivera", email: "alex.rivera@fryelawgroup.example" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("bootstrapAdmin", () => {
  it("refuses to run when an ADMIN account already exists, without touching the database further", async () => {
    prismaMock.user.count.mockResolvedValueOnce(1);

    const result = await bootstrapAdmin(VALID_INPUT);

    expect(result.status).toBe("error");
    expect(result).toMatchObject({ message: expect.stringContaining("already exists") });
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
  });

  it("rejects an invalid email without touching the database", async () => {
    const result = await bootstrapAdmin({ name: "Alex Rivera", email: "not-an-email" });

    expect(result.status).toBe("error");
    expect(prismaMock.user.count).not.toHaveBeenCalled();
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it("rejects an empty name without touching the database", async () => {
    const result = await bootstrapAdmin({ name: "   ", email: "alex.rivera@fryelawgroup.example" });

    expect(result.status).toBe("error");
    expect(prismaMock.user.count).not.toHaveBeenCalled();
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it("creates exactly one ACTIVE ADMIN with mustChangePassword set, hashes the generated password, and audits without leaking it", async () => {
    prismaMock.user.count.mockResolvedValueOnce(0);
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    prismaMock.user.create.mockResolvedValueOnce({
      id: "new-admin-1",
      email: VALID_INPUT.email,
    });

    const result = await bootstrapAdmin(VALID_INPUT);

    expect(result.status).toBe("success");
    if (result.status !== "success") throw new Error("unreachable");

    const createCall = prismaMock.user.create.mock.calls[0]![0];
    expect(createCall.data.role).toBe("ADMIN");
    expect(createCall.data.status).toBe("ACTIVE");
    expect(createCall.data.mustChangePassword).toBe(true);
    expect(createCall.data.email).toBe(VALID_INPUT.email);
    expect(createCall.data.passwordHash).not.toBe(result.temporaryPassword);
    expect(await bcrypt.compare(result.temporaryPassword, createCall.data.passwordHash)).toBe(true);

    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: {
        actorId: null,
        action: "CREATE",
        entityType: "User",
        entityId: "new-admin-1",
        metadata: { role: "ADMIN", source: "bootstrap_script" },
      },
    });
    const auditPayload = JSON.stringify(prismaMock.auditEvent.create.mock.calls[0]![0]);
    expect(auditPayload).not.toContain(result.temporaryPassword);
    expect(auditPayload).not.toContain(createCall.data.passwordHash);
  });

  it("normalizes the email to lowercase/trimmed before checking uniqueness and storing it", async () => {
    prismaMock.user.count.mockResolvedValueOnce(0);
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    prismaMock.user.create.mockResolvedValueOnce({ id: "new-admin-1", email: "alex.rivera@fryelawgroup.example" });

    await bootstrapAdmin({ name: "Alex Rivera", email: "  Alex.Rivera@FryeLawGroup.example  " });

    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { email: "alex.rivera@fryelawgroup.example" },
    });
    expect(prismaMock.user.create.mock.calls[0]![0].data.email).toBe("alex.rivera@fryelawgroup.example");
  });

  it("rejects a duplicate email found by the pre-check, without attempting a create", async () => {
    prismaMock.user.count.mockResolvedValueOnce(0);
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: "existing-1" });

    const result = await bootstrapAdmin(VALID_INPUT);

    expect(result.status).toBe("error");
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it("resolves a race on the unique-email constraint (P2002) as a clean duplicate error, not a raw crash", async () => {
    prismaMock.user.count.mockResolvedValueOnce(0);
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    prismaMock.user.create.mockRejectedValueOnce(fakePrismaError("P2002"));

    const result = await bootstrapAdmin(VALID_INPUT);

    expect(result).toEqual({ status: "error", message: "A user with that email already exists." });
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
  });

  it("propagates an unexpected database error rather than reporting false success", async () => {
    prismaMock.user.count.mockResolvedValueOnce(0);
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    prismaMock.user.create.mockRejectedValueOnce(new Error("connection reset"));

    await expect(bootstrapAdmin(VALID_INPUT)).rejects.toThrow("connection reset");
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
  });
});
