import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireCurrentUserMock,
  prismaMock,
  revalidatePathMock,
  redirectMock,
  linkExternalContactToClientMock,
  createClientRecordMock,
  readClientFieldsMock,
  runHighLevelContactSyncMock,
} = vi.hoisted(() => ({
  requireCurrentUserMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  redirectMock: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
  linkExternalContactToClientMock: vi.fn(),
  createClientRecordMock: vi.fn(),
  readClientFieldsMock: vi.fn(),
  runHighLevelContactSyncMock: vi.fn(),
  prismaMock: {
    intakeLead: { findUnique: vi.fn(), updateMany: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/auth/session", () => ({ requireCurrentUser: requireCurrentUserMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/intake/linking", () => ({ linkExternalContactToClient: linkExternalContactToClientMock }));
vi.mock("@/lib/clients/clientFields", () => ({
  createClientRecord: createClientRecordMock,
  readClientFields: readClientFieldsMock,
}));
vi.mock("@/lib/intake/highlevelSync", () => ({ runHighLevelContactSync: runHighLevelContactSyncMock }));

const {
  createClientFromIntakeLead,
  dismissIntakeLead,
  linkIntakeLeadToExistingClient,
  triggerHighLevelSync,
} = await import("@/lib/intake/reviewActions");

const admin = { id: "user-admin", role: "ADMIN" as const };
const staff = { id: "user-staff", role: "STAFF" as const };

const pendingLead = {
  id: "lead-1",
  provider: "LOOP_HIGHLEVEL" as const,
  externalContactId: "fictional-contact-0001",
  firstName: "Jordan",
  lastName: "Ellis",
  email: "jordan.ellis.fictional@example.com",
  phone: "+15550142000",
  status: "PENDING" as const,
};

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireCurrentUserMock.mockResolvedValue(admin);
  prismaMock.intakeLead.findUnique.mockResolvedValue(pendingLead);
  prismaMock.intakeLead.updateMany.mockResolvedValue({ count: 1 });
});

describe("dismissIntakeLead", () => {
  it("denies a role that isn't ADMIN or ATTORNEY", async () => {
    requireCurrentUserMock.mockResolvedValue(staff);
    const result = await dismissIntakeLead({ ok: false, error: "" }, formData({ intakeLeadId: "lead-1" }));
    expect(result).toEqual({ ok: false, error: "Not found or access denied." });
    expect(prismaMock.intakeLead.updateMany).not.toHaveBeenCalled();
  });

  it("marks a PENDING lead DISMISSED and audits it without any PII", async () => {
    const result = await dismissIntakeLead({ ok: false, error: "" }, formData({ intakeLeadId: "lead-1" }));

    expect(result).toEqual({ ok: true, data: undefined });
    expect(prismaMock.intakeLead.updateMany).toHaveBeenCalledWith({
      where: { id: "lead-1", status: "PENDING" },
      data: expect.objectContaining({ status: "DISMISSED", reviewedById: "user-admin" }),
    });
    const auditCall = prismaMock.auditEvent.create.mock.calls[0]![0];
    expect(auditCall.data.entityType).toBe("IntakeLead");
    expect(JSON.stringify(auditCall.data.metadata)).not.toMatch(/Jordan|Ellis|jordan\.ellis|5550142000/);
  });

  it("returns not-found for a lead that is already LINKED (settled outcome, never reopened)", async () => {
    prismaMock.intakeLead.findUnique.mockResolvedValue({ ...pendingLead, status: "LINKED" });

    const result = await dismissIntakeLead({ ok: false, error: "" }, formData({ intakeLeadId: "lead-1" }));

    expect(result).toEqual({ ok: false, error: "Not found or access denied." });
    expect(prismaMock.intakeLead.updateMany).not.toHaveBeenCalled();
  });

  it("returns not-found for a nonexistent lead id", async () => {
    prismaMock.intakeLead.findUnique.mockResolvedValue(null);

    const result = await dismissIntakeLead({ ok: false, error: "" }, formData({ intakeLeadId: "does-not-exist" }));

    expect(result).toEqual({ ok: false, error: "Not found or access denied." });
  });

  it("reports a lost race rather than silently succeeding when another reviewer resolved the lead first", async () => {
    // The fast-path read still sees PENDING, but the atomic conditional
    // update affects zero rows because another reviewer's write already
    // flipped status away from PENDING between the read and this write.
    prismaMock.intakeLead.updateMany.mockResolvedValue({ count: 0 });

    const result = await dismissIntakeLead({ ok: false, error: "" }, formData({ intakeLeadId: "lead-1" }));

    expect(result).toEqual({ ok: false, error: "This lead was already resolved by another reviewer." });
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
  });
});

describe("linkIntakeLeadToExistingClient", () => {
  it("denies a role that isn't ADMIN or ATTORNEY", async () => {
    requireCurrentUserMock.mockResolvedValue(staff);
    const result = await linkIntakeLeadToExistingClient(
      { ok: false, error: "" },
      formData({ intakeLeadId: "lead-1", clientId: "client-1" }),
    );
    expect(result).toEqual({ ok: false, error: "Not found or access denied." });
    expect(linkExternalContactToClientMock).not.toHaveBeenCalled();
  });

  it("links, marks the lead LINKED, and redirects to the client on success", async () => {
    linkExternalContactToClientMock.mockResolvedValue({ outcome: "linked", linkId: "link-1" });

    await expect(
      linkIntakeLeadToExistingClient({ ok: false, error: "" }, formData({ intakeLeadId: "lead-1", clientId: "client-1" })),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(linkExternalContactToClientMock).toHaveBeenCalledWith({
      provider: "LOOP_HIGHLEVEL",
      externalId: "fictional-contact-0001",
      clientId: "client-1",
      actorId: "user-admin",
    });
    expect(prismaMock.intakeLead.updateMany).toHaveBeenCalledWith({
      where: { id: "lead-1", status: "PENDING" },
      data: expect.objectContaining({ status: "LINKED", linkedClientId: "client-1" }),
    });
    expect(redirectMock).toHaveBeenCalledWith("/clients/client-1");
  });

  it("surfaces a conflict rather than silently marking the lead linked", async () => {
    linkExternalContactToClientMock.mockResolvedValue({
      outcome: "conflict_linked_to_different_client",
      existingClientId: "client-999",
    });

    const result = await linkIntakeLeadToExistingClient(
      { ok: false, error: "" },
      formData({ intakeLeadId: "lead-1", clientId: "client-1" }),
    );

    expect(result.ok).toBe(false);
    expect(prismaMock.intakeLead.updateMany).not.toHaveBeenCalled();
  });

  it("surfaces a clear error for a forged/nonexistent clientId", async () => {
    linkExternalContactToClientMock.mockResolvedValue({ outcome: "client_not_found" });

    const result = await linkIntakeLeadToExistingClient(
      { ok: false, error: "" },
      formData({ intakeLeadId: "lead-1", clientId: "does-not-exist" }),
    );

    expect(result).toEqual({ ok: false, error: "That client id does not exist." });
    expect(prismaMock.intakeLead.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a lead that is no longer PENDING", async () => {
    prismaMock.intakeLead.findUnique.mockResolvedValue({ ...pendingLead, status: "DISMISSED" });

    const result = await linkIntakeLeadToExistingClient(
      { ok: false, error: "" },
      formData({ intakeLeadId: "lead-1", clientId: "client-1" }),
    );

    expect(result).toEqual({ ok: false, error: "Not found or access denied." });
    expect(linkExternalContactToClientMock).not.toHaveBeenCalled();
  });

  it("reports a lost race rather than silently succeeding when another reviewer resolved the lead first", async () => {
    linkExternalContactToClientMock.mockResolvedValue({ outcome: "linked", linkId: "link-1" });
    prismaMock.intakeLead.updateMany.mockResolvedValue({ count: 0 });

    const result = await linkIntakeLeadToExistingClient(
      { ok: false, error: "" },
      formData({ intakeLeadId: "lead-1", clientId: "client-1" }),
    );

    expect(result).toEqual({ ok: false, error: "This lead was already resolved by another reviewer." });
    expect(redirectMock).not.toHaveBeenCalled();
  });
});

describe("createClientFromIntakeLead", () => {
  it("denies a role that isn't ADMIN or ATTORNEY", async () => {
    requireCurrentUserMock.mockResolvedValue(staff);
    const result = await createClientFromIntakeLead({ error: null }, formData({ intakeLeadId: "lead-1" }));
    expect(result).toEqual({ error: "Not found or access denied." });
    expect(createClientRecordMock).not.toHaveBeenCalled();
  });

  it("creates the client, links it, marks the lead LINKED, and redirects", async () => {
    readClientFieldsMock.mockReturnValue({ success: true, data: { firstName: "Jordan", lastName: "Ellis" } });
    createClientRecordMock.mockResolvedValue({ id: "client-new" });
    linkExternalContactToClientMock.mockResolvedValue({ outcome: "linked", linkId: "link-1" });

    await expect(
      createClientFromIntakeLead({ error: null }, formData({ intakeLeadId: "lead-1", firstName: "Jordan", lastName: "Ellis" })),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(createClientRecordMock).toHaveBeenCalledWith({ firstName: "Jordan", lastName: "Ellis" }, "user-admin");
    expect(linkExternalContactToClientMock).toHaveBeenCalledWith({
      provider: "LOOP_HIGHLEVEL",
      externalId: "fictional-contact-0001",
      clientId: "client-new",
      actorId: "user-admin",
    });
    expect(prismaMock.intakeLead.updateMany).toHaveBeenCalledWith({
      where: { id: "lead-1", status: "PENDING" },
      data: expect.objectContaining({ status: "LINKED", linkedClientId: "client-new" }),
    });
    expect(redirectMock).toHaveBeenCalledWith("/clients/client-new");
  });

  it("surfaces invalid form input without creating a client", async () => {
    readClientFieldsMock.mockReturnValue({
      success: false,
      error: { issues: [{ message: "First name is required." }] },
    });

    const result = await createClientFromIntakeLead({ error: null }, formData({ intakeLeadId: "lead-1" }));

    expect(result).toEqual({ error: "First name is required." });
    expect(createClientRecordMock).not.toHaveBeenCalled();
  });

  it("does not silently drop a just-created client on a vanishingly unlikely link conflict", async () => {
    readClientFieldsMock.mockReturnValue({ success: true, data: { firstName: "Jordan", lastName: "Ellis" } });
    createClientRecordMock.mockResolvedValue({ id: "client-new" });
    linkExternalContactToClientMock.mockResolvedValue({
      outcome: "conflict_linked_to_different_client",
      existingClientId: "client-999",
    });

    const result = await createClientFromIntakeLead({ error: null }, formData({ intakeLeadId: "lead-1" }));

    expect(result.error).toBeTruthy();
    expect(prismaMock.intakeLead.updateMany).not.toHaveBeenCalled();
  });

  it("reports a lost race (client still created) rather than silently succeeding when another reviewer resolved the lead first", async () => {
    readClientFieldsMock.mockReturnValue({ success: true, data: { firstName: "Jordan", lastName: "Ellis" } });
    createClientRecordMock.mockResolvedValue({ id: "client-new" });
    linkExternalContactToClientMock.mockResolvedValue({ outcome: "linked", linkId: "link-1" });
    prismaMock.intakeLead.updateMany.mockResolvedValue({ count: 0 });

    const result = await createClientFromIntakeLead({ error: null }, formData({ intakeLeadId: "lead-1" }));

    expect(result.error).toBeTruthy();
    expect(createClientRecordMock).toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });
});

describe("triggerHighLevelSync", () => {
  it("denies a role that isn't ADMIN or ATTORNEY, without calling the sync service", async () => {
    requireCurrentUserMock.mockResolvedValue(staff);

    const result = await triggerHighLevelSync();

    expect(result).toEqual({ ok: false, error: "Not found or access denied." });
    expect(runHighLevelContactSyncMock).not.toHaveBeenCalled();
  });

  it("calls the exact same runHighLevelContactSync used by the cron endpoint, as a manual trigger", async () => {
    runHighLevelContactSyncMock.mockResolvedValue({
      outcome: "completed",
      contactsChecked: 3,
      newLeadsCreated: 1,
      pendingLeadsUpdated: 0,
      linkedOrSkipped: 2,
      failureCount: 0,
      lastRunOutcome: "success",
    });

    const result = await triggerHighLevelSync();

    expect(runHighLevelContactSyncMock).toHaveBeenCalledWith("manual", "user-admin");
    expect(result).toEqual({
      ok: true,
      result: {
        outcome: "completed",
        contactsChecked: 3,
        newLeadsCreated: 1,
        pendingLeadsUpdated: 0,
        linkedOrSkipped: 2,
        failureCount: 0,
        lastRunOutcome: "success",
      },
    });
  });

  it("surfaces already_running as a normal (not error) result rather than double-triggering", async () => {
    runHighLevelContactSyncMock.mockResolvedValue({ outcome: "already_running" });

    const result = await triggerHighLevelSync();

    expect(result).toEqual({ ok: true, result: { outcome: "already_running" } });
  });

  it("returns a concise safe error message rather than the raw error when the sync throws", async () => {
    runHighLevelContactSyncMock.mockRejectedValue(new Error("HighLevel token invalid: super-secret-detail"));

    const result = await triggerHighLevelSync();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain("super-secret-detail");
    }
  });
});
