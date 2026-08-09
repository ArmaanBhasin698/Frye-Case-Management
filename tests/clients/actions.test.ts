import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireCurrentUserMock, prismaMock, revalidatePathMock, redirectMock } = vi.hoisted(() => ({
  requireCurrentUserMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  redirectMock: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
  prismaMock: {
    client: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/auth/session", () => ({ requireCurrentUser: requireCurrentUserMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

const { createClient, updateClient } = await import("@/lib/clients/actions");

const admin = { id: "user-admin", role: "ADMIN" as const };
const attorney = { id: "user-attorney", role: "ATTORNEY" as const };
const staff = { id: "user-staff", role: "STAFF" as const };

function clientFormData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireCurrentUserMock.mockResolvedValue(attorney);
  redirectMock.mockImplementation(() => {
    throw new Error("NEXT_REDIRECT");
  });
});

describe("createClient", () => {
  const validFields = { firstName: "Jordan", lastName: "Ellis" };

  it("denies creation for a role that isn't ADMIN or ATTORNEY", async () => {
    requireCurrentUserMock.mockResolvedValue(staff);
    const result = await createClient({ error: null }, clientFormData(validFields));
    expect(result?.error).toBe("Not found or access denied.");
    expect(prismaMock.client.create).not.toHaveBeenCalled();
  });

  it("allows ADMIN as well as ATTORNEY", async () => {
    requireCurrentUserMock.mockResolvedValue(admin);
    prismaMock.client.create.mockResolvedValue({ id: "client-1", firstName: "Jordan", lastName: "Ellis" });
    await expect(createClient({ error: null }, clientFormData(validFields))).rejects.toThrow("NEXT_REDIRECT");
    expect(prismaMock.client.create).toHaveBeenCalled();
  });

  it("rejects a missing first name before touching the database", async () => {
    const result = await createClient({ error: null }, clientFormData({ firstName: "", lastName: "Ellis" }));
    expect(result?.error).toBeTruthy();
    expect(prismaMock.client.create).not.toHaveBeenCalled();
  });

  it("rejects an invalid email", async () => {
    const result = await createClient(
      { error: null },
      clientFormData({ ...validFields, email: "not-an-email" }),
    );
    expect(result?.error).toBeTruthy();
    expect(prismaMock.client.create).not.toHaveBeenCalled();
  });

  it("creates the client, writes an audit event, and redirects to it", async () => {
    prismaMock.client.create.mockResolvedValue({ id: "client-1", firstName: "Jordan", lastName: "Ellis" });
    await expect(createClient({ error: null }, clientFormData(validFields))).rejects.toThrow("NEXT_REDIRECT");
    expect(prismaMock.client.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ firstName: "Jordan", lastName: "Ellis" }),
    });
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: attorney.id,
        action: "CREATE",
        entityType: "Client",
        entityId: "client-1",
      }),
    });
    expect(redirectMock).toHaveBeenCalledWith("/clients/client-1");
  });
});

describe("updateClient", () => {
  const clientId = "client-1";
  const validFields = { clientId, firstName: "Jordan", lastName: "Ellis", email: "jordan.ellis@example.com" };

  beforeEach(() => {
    prismaMock.client.findUnique.mockResolvedValue({
      id: clientId,
      firstName: "Jordan",
      lastName: "Ellis",
      dateOfBirth: null,
      email: "old@example.com",
      phone: null,
      address: null,
      notes: null,
    });
  });

  it("denies the edit for a role that isn't ADMIN or ATTORNEY (no per-client scoping needed — role-gated only)", async () => {
    requireCurrentUserMock.mockResolvedValue(staff);
    const result = await updateClient({ error: null }, clientFormData(validFields));
    expect(result?.error).toBe("Not found or access denied.");
    expect(prismaMock.client.update).not.toHaveBeenCalled();
  });

  it("returns a generic not-found for a nonexistent client id rather than a distinct error", async () => {
    prismaMock.client.findUnique.mockResolvedValue(null);
    const result = await updateClient({ error: null }, clientFormData(validFields));
    expect(result?.error).toBe("Not found or access denied.");
    expect(prismaMock.client.update).not.toHaveBeenCalled();
  });

  it("updates the client and writes an audit event capturing only the changed field, then redirects", async () => {
    prismaMock.client.update.mockResolvedValue({});
    await expect(updateClient({ error: null }, clientFormData(validFields))).rejects.toThrow("NEXT_REDIRECT");
    expect(prismaMock.client.update).toHaveBeenCalledWith({
      where: { id: clientId },
      data: expect.objectContaining({ email: "jordan.ellis@example.com" }),
    });
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "UPDATE",
        entityType: "Client",
        entityId: clientId,
        metadata: {
          changed: { email: { before: "old@example.com", after: "jordan.ellis@example.com" } },
        },
      }),
    });
    expect(redirectMock).toHaveBeenCalledWith(`/clients/${clientId}`);
  });

  it("records only that notes changed, never their content", async () => {
    prismaMock.client.update.mockResolvedValue({});
    await expect(
      updateClient(
        { error: null },
        clientFormData({ clientId, firstName: "Jordan", lastName: "Ellis", notes: "Sensitive case detail." }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: expect.objectContaining({ notesChanged: true }),
      }),
    });
    const call = prismaMock.auditEvent.create.mock.calls.at(0)?.[0];
    expect(JSON.stringify(call)).not.toContain("Sensitive case detail.");
  });

  it("writes no audit event when nothing actually changed", async () => {
    prismaMock.client.findUnique.mockResolvedValue({
      id: clientId,
      firstName: "Jordan",
      lastName: "Ellis",
      dateOfBirth: null,
      email: "jordan.ellis@example.com",
      phone: null,
      address: null,
      notes: null,
    });
    prismaMock.client.update.mockResolvedValue({});
    await expect(updateClient({ error: null }, clientFormData(validFields))).rejects.toThrow("NEXT_REDIRECT");
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
  });
});
