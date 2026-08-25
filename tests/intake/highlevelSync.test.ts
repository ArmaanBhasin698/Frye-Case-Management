import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, fetchContactsPageMock, ingestHighLevelContactEventMock } = vi.hoisted(() => ({
  prismaMock: {
    highLevelSyncState: { upsert: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
  fetchContactsPageMock: vi.fn(),
  ingestHighLevelContactEventMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/intake/highlevelClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/intake/highlevelClient")>();
  return { ...actual, fetchContactsPage: fetchContactsPageMock };
});
vi.mock("@/lib/intake/ingest", () => ({ ingestHighLevelContactEvent: ingestHighLevelContactEventMock }));

const { runHighLevelContactSync } = await import("@/lib/intake/highlevelSync");
const { HighLevelApiError, HighLevelMalformedResponseError } = await import("@/lib/intake/highlevelClient");

function contact(overrides: Partial<{ id: string; dateAdded: string; firstName: string; lastName: string; email: string; phone: string; contactName: string }>) {
  return {
    id: "fictional-contact-0001",
    dateAdded: "2026-01-01T12:00:00.000Z",
    firstName: "Jordan",
    lastName: "Ellis",
    email: "jordan.ellis.fictional@example.com",
    phone: "+15550142000",
    ...overrides,
  };
}

function page(contacts: unknown[], meta: { startAfter?: number; startAfterId?: string; nextPage?: number | null } = {}) {
  return { contacts, meta };
}

/** Narrows SyncRunResult to its "completed" branch for tests that need the counts. */
function completed(result: Awaited<ReturnType<typeof runHighLevelContactSync>>) {
  if (result.outcome !== "completed") {
    throw new Error(`Expected a completed sync run, got outcome=${result.outcome}`);
  }
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Lock is free and claimable by default.
  prismaMock.highLevelSyncState.upsert.mockResolvedValue(undefined);
  prismaMock.highLevelSyncState.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.highLevelSyncState.findUnique.mockResolvedValue(null);
  prismaMock.highLevelSyncState.update.mockResolvedValue(undefined);
  ingestHighLevelContactEventMock.mockResolvedValue({ outcome: "recorded", intakeLeadId: "lead-1", created: true });
});

describe("runHighLevelContactSync — concurrency", () => {
  it("returns already_running without calling the API when the lock can't be claimed", async () => {
    prismaMock.highLevelSyncState.updateMany.mockResolvedValue({ count: 0 });

    const result = await runHighLevelContactSync("manual", "user-1");

    expect(result).toEqual({ outcome: "already_running" });
    expect(fetchContactsPageMock).not.toHaveBeenCalled();
  });

  it("claims the lock via an atomic conditional update, not a plain write", async () => {
    fetchContactsPageMock.mockResolvedValue(page([]));

    await runHighLevelContactSync("manual", "user-1");

    expect(prismaMock.highLevelSyncState.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "highlevel",
          OR: expect.arrayContaining([{ runningSince: null }]),
        }),
      }),
    );
  });

  it("always releases the lock (runningSince: null) even after a successful run", async () => {
    fetchContactsPageMock.mockResolvedValue(page([]));

    await runHighLevelContactSync("manual", "user-1");

    expect(prismaMock.highLevelSyncState.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ runningSince: null }) }),
    );
  });
});

describe("runHighLevelContactSync — first sync", () => {
  it("processes every contact when there is no checkpoint yet and sets one afterward", async () => {
    const c1 = contact({ id: "c1", dateAdded: "2026-01-03T00:00:00.000Z" });
    const c2 = contact({ id: "c2", dateAdded: "2026-01-02T00:00:00.000Z" });
    fetchContactsPageMock.mockResolvedValue(page([c1, c2], { nextPage: null }));

    const result = await runHighLevelContactSync("scheduled", null);

    expect(result).toEqual({
      outcome: "completed",
      contactsChecked: 2,
      newLeadsCreated: 2,
      pendingLeadsUpdated: 0,
      linkedOrSkipped: 0,
      failureCount: 0,
      lastRunOutcome: "success",
    });
    expect(prismaMock.highLevelSyncState.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastSuccessfulCheckpoint: new Date("2026-01-02T00:00:00.000Z") }),
      }),
    );
  });

  it("audits one event per run, with counts only — never a contact name/email/phone", async () => {
    fetchContactsPageMock.mockResolvedValue(page([contact({})], { nextPage: null }));

    await runHighLevelContactSync("manual", "user-1");

    expect(prismaMock.auditEvent.create).toHaveBeenCalledTimes(1);
    const call = prismaMock.auditEvent.create.mock.calls[0]![0];
    expect(call.data.entityType).toBe("HighLevelSyncState");
    expect(call.data.actorId).toBe("user-1");
    const serialized = JSON.stringify(call.data.metadata);
    expect(serialized).not.toMatch(/Jordan|Ellis|jordan\.ellis|5550142000/);
  });
});

describe("runHighLevelContactSync — incremental second sync", () => {
  it("stops once it reaches the checkpoint, without walking the rest of the roster", async () => {
    prismaMock.highLevelSyncState.findUnique.mockResolvedValue({
      lastSuccessfulCheckpoint: new Date("2026-01-02T00:00:00.000Z"),
    });
    const newC = contact({ id: "new", dateAdded: "2026-01-05T00:00:00.000Z" });
    const oldC = contact({ id: "old", dateAdded: "2026-01-01T00:00:00.000Z" }); // well before checkpoint
    fetchContactsPageMock.mockResolvedValue(page([newC, oldC], { nextPage: null }));

    const result = await runHighLevelContactSync("scheduled", null);

    expect(completed(result).contactsChecked).toBe(1);
    expect(ingestHighLevelContactEventMock).toHaveBeenCalledTimes(1);
  });

  it("does not advance the checkpoint when zero new contacts are found", async () => {
    const checkpoint = new Date("2026-01-02T00:00:00.000Z");
    prismaMock.highLevelSyncState.findUnique.mockResolvedValue({ lastSuccessfulCheckpoint: checkpoint });
    const oldC = contact({ id: "old", dateAdded: "2026-01-01T00:00:00.000Z" });
    fetchContactsPageMock.mockResolvedValue(page([oldC], { nextPage: null }));

    const result = await runHighLevelContactSync("scheduled", null);

    expect(result).toMatchObject({ contactsChecked: 0, newLeadsCreated: 0 });
    expect(prismaMock.highLevelSyncState.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lastSuccessfulCheckpoint: checkpoint }) }),
    );
  });
});

describe("runHighLevelContactSync — overlap window", () => {
  it("re-examines a small window before the checkpoint rather than stopping exactly at it", async () => {
    const checkpoint = new Date("2026-01-02T00:00:00.000Z");
    prismaMock.highLevelSyncState.findUnique.mockResolvedValue({ lastSuccessfulCheckpoint: checkpoint });
    // 60 seconds before checkpoint: inside the 2-minute overlap window, must still be processed.
    const withinOverlap = contact({ id: "overlap", dateAdded: "2026-01-01T23:59:00.000Z" });
    fetchContactsPageMock.mockResolvedValue(page([withinOverlap], { nextPage: null }));

    const result = await runHighLevelContactSync("scheduled", null);

    expect(completed(result).contactsChecked).toBe(1);
    expect(ingestHighLevelContactEventMock).toHaveBeenCalledTimes(1);
  });

  it("still stops at a contact older than the overlap window", async () => {
    const checkpoint = new Date("2026-01-02T00:00:00.000Z");
    prismaMock.highLevelSyncState.findUnique.mockResolvedValue({ lastSuccessfulCheckpoint: checkpoint });
    // 5 minutes before checkpoint: outside the 2-minute overlap window.
    const beforeOverlap = contact({ id: "too-old", dateAdded: "2026-01-01T23:55:00.000Z" });
    fetchContactsPageMock.mockResolvedValue(page([beforeOverlap], { nextPage: null }));

    const result = await runHighLevelContactSync("scheduled", null);

    expect(completed(result).contactsChecked).toBe(0);
    expect(ingestHighLevelContactEventMock).not.toHaveBeenCalled();
  });

  it("relies on ingest idempotency to absorb a re-processed overlap contact safely", async () => {
    const checkpoint = new Date("2026-01-02T00:00:00.000Z");
    prismaMock.highLevelSyncState.findUnique.mockResolvedValue({ lastSuccessfulCheckpoint: checkpoint });
    const withinOverlap = contact({ id: "overlap", dateAdded: "2026-01-01T23:59:00.000Z" });
    fetchContactsPageMock.mockResolvedValue(page([withinOverlap], { nextPage: null }));
    // Already linked last time — reprocessing must be a safe no-op, not a duplicate.
    ingestHighLevelContactEventMock.mockResolvedValue({ outcome: "already_linked", clientId: "client-1" });

    const result = await runHighLevelContactSync("scheduled", null);

    expect(result).toMatchObject({ newLeadsCreated: 0, linkedOrSkipped: 1 });
  });
});

describe("runHighLevelContactSync — pagination", () => {
  it("walks a second page using the first page's cursor and processes both", async () => {
    const c1 = contact({ id: "c1", dateAdded: "2026-01-05T00:00:00.000Z" });
    const c2 = contact({ id: "c2", dateAdded: "2026-01-04T00:00:00.000Z" });
    fetchContactsPageMock
      .mockResolvedValueOnce(page([c1], { startAfter: 1234, startAfterId: "c1", nextPage: 2 }))
      .mockResolvedValueOnce(page([c2], { nextPage: null }));

    const result = await runHighLevelContactSync("scheduled", null);

    expect(completed(result).contactsChecked).toBe(2);
    expect(fetchContactsPageMock).toHaveBeenCalledTimes(2);
    expect(fetchContactsPageMock).toHaveBeenNthCalledWith(2, expect.any(Number), { startAfter: 1234, startAfterId: "c1" });
  });

  it("stops when the API stops returning pagination cursor fields, without inventing one", async () => {
    fetchContactsPageMock.mockResolvedValue(page([contact({})], {}));

    const result = await runHighLevelContactSync("scheduled", null);

    expect(fetchContactsPageMock).toHaveBeenCalledTimes(1);
    expect(result.outcome).toBe("completed");
  });
});

describe("runHighLevelContactSync — ingest outcomes", () => {
  it("counts an already-linked contact as linked/skipped, not a new lead", async () => {
    ingestHighLevelContactEventMock.mockResolvedValue({ outcome: "already_linked", clientId: "client-1" });
    fetchContactsPageMock.mockResolvedValue(page([contact({})], { nextPage: null }));

    const result = await runHighLevelContactSync("scheduled", null);

    expect(result).toMatchObject({ newLeadsCreated: 0, pendingLeadsUpdated: 0, linkedOrSkipped: 1 });
  });

  it("counts a refreshed existing pending lead as updated, not new", async () => {
    ingestHighLevelContactEventMock.mockResolvedValue({ outcome: "recorded", intakeLeadId: "lead-1", created: false });
    fetchContactsPageMock.mockResolvedValue(page([contact({})], { nextPage: null }));

    const result = await runHighLevelContactSync("scheduled", null);

    expect(result).toMatchObject({ newLeadsCreated: 0, pendingLeadsUpdated: 1, linkedOrSkipped: 0 });
  });

  it("counts a malformed individual contact as a failure and stops, rather than silently skipping it", async () => {
    const malformed = { id: "bad", dateAdded: "2026-01-01T00:00:00.000Z" }; // no firstName/lastName/contactName
    fetchContactsPageMock.mockResolvedValue(page([malformed], { nextPage: null }));

    const result = await runHighLevelContactSync("scheduled", null);

    expect(result).toMatchObject({ contactsChecked: 1, failureCount: 1, lastRunOutcome: "partial_failure" });
    expect(ingestHighLevelContactEventMock).not.toHaveBeenCalled();
    const call = prismaMock.auditEvent.create.mock.calls[0]![0];
    expect(call.data.metadata.failureCategory).toBe("malformed_contact");
  });

  it("does not advance the checkpoint past a malformed contact, so it can be retried once fixed in HighLevel", async () => {
    // dateAdded never changes even if this contact is later corrected in
    // HighLevel — advancing past it here would make it permanently
    // unreachable by every future run.
    const good = contact({ id: "good", dateAdded: "2026-01-05T00:00:00.000Z" });
    const malformed = { id: "bad", dateAdded: "2026-01-04T00:00:00.000Z" };
    fetchContactsPageMock.mockResolvedValue(page([good, malformed], { nextPage: null }));

    const result = await runHighLevelContactSync("scheduled", null);

    expect(result).toMatchObject({ newLeadsCreated: 1, failureCount: 1, lastRunOutcome: "partial_failure" });
    expect(prismaMock.highLevelSyncState.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastSuccessfulCheckpoint: new Date("2026-01-05T00:00:00.000Z") }),
      }),
    );
  });

  it("skips (without crashing) a contact with no parseable dateAdded", async () => {
    const noDate = { id: "no-date", firstName: "Jordan", lastName: "Ellis" };
    fetchContactsPageMock.mockResolvedValue(page([noDate], { nextPage: null }));

    const result = await runHighLevelContactSync("scheduled", null);

    expect(result).toMatchObject({ contactsChecked: 1, linkedOrSkipped: 1 });
  });
});

describe("runHighLevelContactSync — partial failure", () => {
  it("does not advance the checkpoint past a page-fetch failure", async () => {
    const c1 = contact({ id: "c1", dateAdded: "2026-01-05T00:00:00.000Z" });
    fetchContactsPageMock
      .mockResolvedValueOnce(page([c1], { startAfter: 1, startAfterId: "c1", nextPage: 2 }))
      .mockRejectedValueOnce(new HighLevelApiError(429));

    const result = await runHighLevelContactSync("scheduled", null);

    expect(result).toMatchObject({ contactsChecked: 1, failureCount: 1, lastRunOutcome: "partial_failure" });
    expect(prismaMock.highLevelSyncState.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastSuccessfulCheckpoint: new Date("2026-01-05T00:00:00.000Z") }),
      }),
    );
  });

  it("categorizes a rate-limit failure distinctly in audit metadata, never the raw error", async () => {
    fetchContactsPageMock.mockRejectedValue(new HighLevelApiError(429));

    await runHighLevelContactSync("scheduled", null);

    const call = prismaMock.auditEvent.create.mock.calls[0]![0];
    expect(call.data.metadata.failureCategory).toBe("rate_limited");
  });

  it("categorizes an auth failure distinctly", async () => {
    fetchContactsPageMock.mockRejectedValue(new HighLevelApiError(401));
    await runHighLevelContactSync("scheduled", null);
    expect(prismaMock.auditEvent.create.mock.calls[0]![0].data.metadata.failureCategory).toBe("auth_failed");
  });

  it("categorizes a missing-scope failure distinctly", async () => {
    fetchContactsPageMock.mockRejectedValue(new HighLevelApiError(403));
    await runHighLevelContactSync("scheduled", null);
    expect(prismaMock.auditEvent.create.mock.calls[0]![0].data.metadata.failureCategory).toBe("missing_scopes");
  });

  it("categorizes a malformed HighLevel response distinctly", async () => {
    fetchContactsPageMock.mockRejectedValue(new HighLevelMalformedResponseError());
    const result = await runHighLevelContactSync("scheduled", null);
    expect(result).toMatchObject({ failureCount: 1, lastRunOutcome: "partial_failure" });
    expect(prismaMock.auditEvent.create.mock.calls[0]![0].data.metadata.failureCategory).toBe("malformed_response");
  });

  it("does not advance the checkpoint past a database error during ingest", async () => {
    const c1 = contact({ id: "c1", dateAdded: "2026-01-05T00:00:00.000Z" });
    const c2 = contact({ id: "c2", dateAdded: "2026-01-04T00:00:00.000Z" });
    fetchContactsPageMock.mockResolvedValue(page([c1, c2], { nextPage: null }));
    ingestHighLevelContactEventMock
      .mockResolvedValueOnce({ outcome: "recorded", intakeLeadId: "lead-1", created: true })
      .mockRejectedValueOnce(new Error("connection lost"));

    const result = await runHighLevelContactSync("scheduled", null);

    expect(result).toMatchObject({ newLeadsCreated: 1, failureCount: 1, lastRunOutcome: "partial_failure" });
    expect(prismaMock.highLevelSyncState.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastSuccessfulCheckpoint: new Date("2026-01-05T00:00:00.000Z") }),
      }),
    );
  });

  it("releases the lock and re-throws on a genuinely unexpected error, without leaking it into the return value", async () => {
    prismaMock.highLevelSyncState.findUnique.mockRejectedValue(new Error("db is down"));

    await expect(runHighLevelContactSync("scheduled", null)).rejects.toThrow("db is down");
    expect(prismaMock.highLevelSyncState.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ runningSince: null }) }),
    );
  });
});
