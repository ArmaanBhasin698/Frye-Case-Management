import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireCurrentUserMock,
  hasMatterAccessMock,
  canViewContactMock,
  prismaMock,
  revalidatePathMock,
  redirectMock,
} = vi.hoisted(() => ({
  requireCurrentUserMock: vi.fn(),
  hasMatterAccessMock: vi.fn(),
  canViewContactMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  redirectMock: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
  prismaMock: {
    contact: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    contactPhone: { deleteMany: vi.fn(), createMany: vi.fn() },
    contactEmail: { deleteMany: vi.fn(), createMany: vi.fn() },
    matterContact: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    contactRelationship: { create: vi.fn(), delete: vi.fn(), findUnique: vi.fn() },
    contactInteraction: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    user: { count: vi.fn() },
    auditEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/auth/session", () => ({ requireCurrentUser: requireCurrentUserMock }));
vi.mock("@/lib/auth/access", () => ({ hasMatterAccess: hasMatterAccessMock }));
vi.mock("@/lib/contacts/visibility", () => ({
  canViewContact: canViewContactMock,
  contactVisibilityFilterFor: vi.fn(async () => ({ VISIBILITY: true })),
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

const {
  addContactToMatter,
  archiveContact,
  createContact,
  createContactRelationship,
  deleteContactRelationship,
  recordContactInteraction,
  removeContactFromMatter,
  setInteractionFollowUpStatus,
  updateContact,
} = await import("@/lib/contacts/actions");

const attorney = { id: "u-att", role: "ATTORNEY" as const };
const staff = { id: "u-staff", role: "STAFF" as const };
const NOT_FOUND = "Not found or access denied.";

function fd(fields: Record<string, string | string[]>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const v of Array.isArray(value) ? value : [value]) formData.append(key, v);
  }
  return formData;
}

function auditCalls() {
  return prismaMock.auditEvent.create.mock.calls.map((c) => c[0].data);
}

beforeEach(() => {
  vi.clearAllMocks();
  requireCurrentUserMock.mockResolvedValue(attorney);
  hasMatterAccessMock.mockResolvedValue(true);
  canViewContactMock.mockResolvedValue(true);
  prismaMock.contact.findMany.mockResolvedValue([]);
  prismaMock.user.count.mockResolvedValue(1);
  prismaMock.$transaction.mockImplementation((arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: unknown) => unknown)(prismaMock) : Promise.all(arg as Promise<unknown>[]),
  );
  redirectMock.mockImplementation(() => {
    throw new Error("NEXT_REDIRECT");
  });
});

describe("createContact", () => {
  const witness = { firstName: "Riley", lastName: "Chen", categories: ["WITNESS"], notes: "Saw the incident from the bus stop." };

  it("warns about a possible duplicate instead of creating, listing only visible matches", async () => {
    prismaMock.contact.findMany.mockResolvedValue([{ id: "c-old", displayName: "Riley Chen", emails: [], phones: [] }]);
    const result = await createContact({ error: null }, fd(witness));
    expect(result).toEqual({ error: null, duplicates: [{ id: "c-old", displayName: "Riley Chen", reasons: ["name"] }] });
    expect(prismaMock.contact.findMany.mock.calls[0]![0].where.AND[0]).toEqual({ VISIBILITY: true });
    expect(prismaMock.contact.create).not.toHaveBeenCalled();
  });

  it("creates anyway once the user confirms it's a different person", async () => {
    prismaMock.contact.create.mockResolvedValue({ id: "c-new", kind: "INDIVIDUAL", categories: ["WITNESS"] });
    await expect(createContact({ error: null }, fd({ ...witness, confirmDuplicate: "1" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(prismaMock.contact.findMany).not.toHaveBeenCalled();
    expect(prismaMock.contact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ displayName: "Riley Chen", createdById: attorney.id, categories: ["WITNESS"] }),
    });
    expect(redirectMock).toHaveBeenCalledWith("/contacts/c-new");
  });

  it("audits the creation without copying notes or names", async () => {
    prismaMock.contact.create.mockResolvedValue({ id: "c-new", kind: "INDIVIDUAL", categories: ["WITNESS"] });
    await expect(createContact({ error: null }, fd(witness))).rejects.toThrow("NEXT_REDIRECT");
    expect(auditCalls()).toEqual([
      expect.objectContaining({ action: "CREATE", entityType: "Contact", entityId: "c-new", metadata: { kind: "INDIVIDUAL", categories: ["WITNESS"] } }),
    ]);
    expect(JSON.stringify(auditCalls())).not.toContain("bus stop");
    expect(JSON.stringify(auditCalls())).not.toContain("Riley");
  });

  it("links the new contact to a matter in the same transaction when asked", async () => {
    prismaMock.contact.create.mockResolvedValue({ id: "c-new", kind: "INDIVIDUAL", categories: [] });
    prismaMock.matterContact.create.mockResolvedValue({ id: "mc-1" });
    await expect(
      createContact({ error: null }, fd({ ...witness, linkMatterId: "m-1", linkRole: "WITNESS" })),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.matterContact.create).toHaveBeenCalledWith({
      data: { matterId: "m-1", contactId: "c-new", role: "WITNESS", addedById: attorney.id },
    });
    expect(redirectMock).toHaveBeenCalledWith("/matters/m-1/contacts");
  });

  it("refuses to link to a matter the user can't access", async () => {
    hasMatterAccessMock.mockResolvedValue(false);
    const result = await createContact({ error: null }, fd({ ...witness, linkMatterId: "m-x", linkRole: "WITNESS" }));
    expect(result.error).toBe(NOT_FOUND);
    expect(prismaMock.contact.create).not.toHaveBeenCalled();
  });

  it("rejects a forged organization id the user can't see", async () => {
    prismaMock.contact.count.mockResolvedValue(0);
    const result = await createContact({ error: null }, fd({ ...witness, organizationId: "org-hidden" }));
    expect(result.error).toBe("Choose a valid organization.");
    expect(prismaMock.contact.create).not.toHaveBeenCalled();
  });

  it("rejects assigning an inactive or nonexistent staff member", async () => {
    prismaMock.user.count.mockResolvedValue(0);
    const result = await createContact({ error: null }, fd({ ...witness, assignedStaffId: "u-gone" }));
    expect(result.error).toBe("Choose an active staff member.");
  });
});

describe("updateContact", () => {
  it("returns the generic denial for a contact the user can't see", async () => {
    canViewContactMock.mockResolvedValue(false);
    const result = await updateContact({ error: null }, fd({ contactId: "c-hidden", firstName: "A", lastName: "B" }));
    expect(result.error).toBe(NOT_FOUND);
    expect(prismaMock.contact.findUnique).not.toHaveBeenCalled();
  });

  it("keeps a client's directory names from the client record, ignoring submitted names", async () => {
    prismaMock.contact.findUnique.mockResolvedValue({
      id: "c-client",
      clientId: "client-1",
      kind: "INDIVIDUAL",
      firstName: "Jordan",
      lastName: "Ellis",
      categories: [],
      notes: null,
    });
    await expect(
      updateContact({ error: null }, fd({ contactId: "c-client", firstName: "Forged", lastName: "Name", jobTitle: "Mechanic" })),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(prismaMock.contact.update).toHaveBeenCalledWith({
      where: { id: "c-client" },
      data: expect.objectContaining({ firstName: "Jordan", lastName: "Ellis", displayName: "Jordan Ellis", jobTitle: "Mechanic" }),
    });
  });

  it("records changed field names and categories, but only a flag for notes", async () => {
    prismaMock.contact.findUnique.mockResolvedValue({
      id: "c-1",
      clientId: null,
      kind: "INDIVIDUAL",
      firstName: "Riley",
      lastName: "Chen",
      displayName: "Riley Chen",
      jobTitle: null,
      categories: ["WITNESS"],
      notes: "old private note",
    });
    await expect(
      updateContact(
        { error: null },
        fd({ contactId: "c-1", firstName: "Riley", lastName: "Chen", jobTitle: "Clerk", categories: ["WITNESS", "FAMILY_MEMBER"], notes: "new private note" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT");
    const metadata = auditCalls()[0].metadata;
    expect(metadata.changed).toEqual({ jobTitle: { before: null, after: "Clerk" } });
    expect(metadata.categories).toEqual(["WITNESS", "FAMILY_MEMBER"]);
    expect(metadata.notesChanged).toBe(true);
    expect(JSON.stringify(metadata)).not.toContain("private note");
  });
});

describe("updateContact — organization kind change", () => {
  it("refuses to turn an organization with linked people into an individual", async () => {
    prismaMock.contact.findUnique.mockResolvedValue({ id: "org-1", clientId: null, kind: "ORGANIZATION", categories: [] });
    prismaMock.contact.count.mockResolvedValue(2);
    const result = await updateContact({ error: null }, fd({ contactId: "org-1", kind: "INDIVIDUAL", firstName: "A", lastName: "B" }));
    expect(result.error).toMatch(/still linked/);
    expect(prismaMock.contact.update).not.toHaveBeenCalled();
  });
});

describe("archiveContact", () => {
  it("is limited to ADMIN/ATTORNEY", async () => {
    requireCurrentUserMock.mockResolvedValue(staff);
    expect(await archiveContact({ contactId: "c-1" })).toEqual({ ok: false, error: NOT_FOUND });
    expect(prismaMock.contact.update).not.toHaveBeenCalled();
  });

  it("archives (never deletes) and audits", async () => {
    expect(await archiveContact({ contactId: "c-1" })).toEqual({ ok: true, data: undefined });
    expect(prismaMock.contact.update).toHaveBeenCalledWith({
      where: { id: "c-1" },
      data: expect.objectContaining({ archived: true, archivedById: attorney.id }),
    });
    expect(auditCalls()[0]).toMatchObject({ entityType: "Contact", metadata: { archived: true } });
  });
});

describe("addContactToMatter / removeContactFromMatter", () => {
  const link = { matterId: "m-1", contactId: "c-1", role: "JUDGE" };

  it("requires both matter access and contact visibility", async () => {
    hasMatterAccessMock.mockResolvedValue(false);
    expect((await addContactToMatter({ error: null }, fd(link))).error).toBe(NOT_FOUND);
    hasMatterAccessMock.mockResolvedValue(true);
    canViewContactMock.mockResolvedValue(false);
    expect((await addContactToMatter({ error: null }, fd(link))).error).toBe(NOT_FOUND);
    expect(prismaMock.matterContact.create).not.toHaveBeenCalled();
  });

  it("creates a new link and audits it against the matter", async () => {
    prismaMock.matterContact.findUnique.mockResolvedValue(null);
    prismaMock.matterContact.create.mockResolvedValue({ id: "mc-1" });
    expect((await addContactToMatter({ error: null }, fd({ ...link, roleDetail: "Presiding" }))).error).toBeNull();
    expect(prismaMock.matterContact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ matterId: "m-1", contactId: "c-1", role: "JUDGE", roleDetail: "Presiding" }),
    });
    expect(auditCalls()[0]).toMatchObject({ action: "CREATE", entityType: "MatterContact", matterId: "m-1" });
  });

  it("restores a previously removed link rather than duplicating it", async () => {
    prismaMock.matterContact.findUnique.mockResolvedValue({ id: "mc-old", removedAt: new Date() });
    prismaMock.matterContact.update.mockResolvedValue({ id: "mc-old" });
    expect((await addContactToMatter({ error: null }, fd(link))).error).toBeNull();
    expect(prismaMock.matterContact.create).not.toHaveBeenCalled();
    expect(prismaMock.matterContact.update).toHaveBeenCalledWith({
      where: { id: "mc-old" },
      data: expect.objectContaining({ removedAt: null }),
    });
  });

  it("refuses an exact duplicate active link", async () => {
    prismaMock.matterContact.findUnique.mockResolvedValue({ id: "mc-1", removedAt: null });
    expect((await addContactToMatter({ error: null }, fd(link))).error).toMatch(/already on the matter/);
  });

  it("rejects an end date before the start date", async () => {
    const result = await addContactToMatter({ error: null }, fd({ ...link, startDate: "2026-05-01", endDate: "2026-04-01" }));
    expect(result.error).toMatch(/End date/);
  });

  it("removes by stamping removedAt — the contact and the link row both survive", async () => {
    prismaMock.matterContact.findUnique.mockResolvedValue({ id: "mc-1", matterId: "m-1", contactId: "c-1", role: "JUDGE", removedAt: null });
    expect(await removeContactFromMatter({ matterContactId: "mc-1" })).toEqual({ ok: true, data: undefined });
    expect(prismaMock.matterContact.update).toHaveBeenCalledWith({ where: { id: "mc-1" }, data: { removedAt: expect.any(Date) } });
    expect(prismaMock.contact.update).not.toHaveBeenCalled();
    expect(auditCalls()[0]).toMatchObject({ action: "UPDATE", matterId: "m-1", metadata: expect.objectContaining({ removed: true }) });
  });

  it("refuses to remove from a matter the user can't access", async () => {
    prismaMock.matterContact.findUnique.mockResolvedValue({ id: "mc-1", matterId: "m-x", contactId: "c-1", removedAt: null });
    hasMatterAccessMock.mockResolvedValue(false);
    expect(await removeContactFromMatter({ matterContactId: "mc-1" })).toEqual({ ok: false, error: NOT_FOUND });
    expect(prismaMock.matterContact.update).not.toHaveBeenCalled();
  });
});

describe("relationships", () => {
  const base = { contactId: "c-child", otherContactId: "c-parent", type: "PARENT", scope: "PERMANENT" };

  it("stores '<other> is <type> of this contact' and drops a matter id on permanent relationships", async () => {
    prismaMock.contactRelationship.create.mockResolvedValue({ id: "r-1" });
    expect((await createContactRelationship({ error: null }, fd({ ...base, matterId: "m-1" }))).error).toBeNull();
    expect(prismaMock.contactRelationship.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ fromContactId: "c-parent", toContactId: "c-child", type: "PARENT", matterId: null }),
    });
    expect(hasMatterAccessMock).not.toHaveBeenCalled();
  });

  it("requires a matter, and access to it, for a matter-specific relationship", async () => {
    expect((await createContactRelationship({ error: null }, fd({ ...base, scope: "MATTER" }))).error).toMatch(/Choose the matter/);
    hasMatterAccessMock.mockResolvedValue(false);
    expect((await createContactRelationship({ error: null }, fd({ ...base, scope: "MATTER", matterId: "m-x" }))).error).toBe(NOT_FOUND);
    expect(prismaMock.contactRelationship.create).not.toHaveBeenCalled();
  });

  it("refuses when either contact is invisible to the user", async () => {
    canViewContactMock.mockImplementation(async (_user: unknown, id: string) => id !== "c-parent");
    expect((await createContactRelationship({ error: null }, fd(base))).error).toBe(NOT_FOUND);
  });

  it("refuses to relate a contact to itself", async () => {
    expect((await createContactRelationship({ error: null }, fd({ ...base, otherContactId: "c-child" }))).error).toMatch(/itself/);
  });

  it("never copies relationship context into the audit log", async () => {
    prismaMock.contactRelationship.create.mockResolvedValue({ id: "r-1" });
    await createContactRelationship({ error: null }, fd({ ...base, context: "Lives with the client on weekends" }));
    expect(JSON.stringify(auditCalls())).not.toContain("weekends");
  });

  it("deleting a matter-specific relationship requires access to that matter", async () => {
    prismaMock.contactRelationship.findUnique.mockResolvedValue({
      id: "r-1",
      fromContactId: "a",
      toContactId: "b",
      matterId: "m-x",
      type: "ARRESTING_OFFICER",
      scope: "MATTER",
    });
    hasMatterAccessMock.mockResolvedValue(false);
    expect(await deleteContactRelationship({ relationshipId: "r-1" })).toEqual({ ok: false, error: NOT_FOUND });
    expect(prismaMock.contactRelationship.delete).not.toHaveBeenCalled();
  });
});

describe("recordContactInteraction", () => {
  const past = { contactId: "c-1", type: "MEETING", occurredAt: "2026-01-15T10:00", summary: "Discussed bond conditions privately." };

  it("refuses a future date — a scheduled event is not an interaction", async () => {
    const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    const result = await recordContactInteraction({ error: null }, fd({ ...past, occurredAt: future }));
    expect(result.error).toMatch(/already happened/);
    expect(prismaMock.contactInteraction.create).not.toHaveBeenCalled();
  });

  it("requires access to the matter it's filed against", async () => {
    hasMatterAccessMock.mockResolvedValue(false);
    expect((await recordContactInteraction({ error: null }, fd({ ...past, matterId: "m-x" }))).error).toBe(NOT_FOUND);
  });

  it("defaults the staff member to the caller, advances last-contacted, and keeps the summary out of the audit log", async () => {
    prismaMock.contactInteraction.create.mockResolvedValue({ id: "i-1" });
    expect((await recordContactInteraction({ error: null }, fd(past))).error).toBeNull();
    expect(prismaMock.contactInteraction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ staffId: attorney.id, recordedById: attorney.id, followUpStatus: "NONE" }),
    });
    expect(prismaMock.contact.updateMany).toHaveBeenCalledWith({
      where: { id: "c-1", OR: [{ lastContactedAt: null }, { lastContactedAt: { lt: new Date(past.occurredAt) } }] },
      data: { lastContactedAt: new Date(past.occurredAt) },
    });
    expect(JSON.stringify(auditCalls())).not.toContain("bond conditions");
  });

  it("rejects attributing the interaction to an inactive staff member", async () => {
    prismaMock.user.count.mockResolvedValue(0);
    expect((await recordContactInteraction({ error: null }, fd({ ...past, staffId: "u-gone" }))).error).toMatch(/active staff/);
  });
});

describe("setInteractionFollowUpStatus", () => {
  it("re-checks matter access for a matter-filed interaction", async () => {
    prismaMock.contactInteraction.findUnique.mockResolvedValue({ id: "i-1", contactId: "c-1", matterId: "m-x", followUpStatus: "PENDING" });
    hasMatterAccessMock.mockResolvedValue(false);
    expect(await setInteractionFollowUpStatus({ interactionId: "i-1", followUpStatus: "COMPLETED" })).toEqual({
      ok: false,
      error: NOT_FOUND,
    });
  });

  it("updates and audits the before/after status", async () => {
    prismaMock.contactInteraction.findUnique.mockResolvedValue({ id: "i-1", contactId: "c-1", matterId: null, followUpStatus: "PENDING" });
    expect(await setInteractionFollowUpStatus({ interactionId: "i-1", followUpStatus: "COMPLETED" })).toEqual({ ok: true, data: undefined });
    expect(auditCalls()[0].metadata).toEqual({ followUpStatus: { before: "PENDING", after: "COMPLETED" } });
  });

  it("rejects an invalid status value", async () => {
    expect((await setInteractionFollowUpStatus({ interactionId: "i-1", followUpStatus: "DONE-ISH" })).ok).toBe(false);
  });
});
