import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  process.env.MFA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

const { findUniqueMock, createMock, updateManyMock, deleteManyMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  createMock: vi.fn(),
  updateManyMock: vi.fn(),
  deleteManyMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    mfaChallengeTicket: {
      findUnique: findUniqueMock,
      create: createMock,
      updateMany: updateManyMock,
      deleteMany: deleteManyMock,
    },
  },
}));

const cookieStore = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (cookieStore.has(name) ? { value: cookieStore.get(name) } : undefined),
    set: (name: string, value: string) => {
      cookieStore.set(name, value);
    },
    delete: (name: string) => {
      cookieStore.delete(name);
    },
  })),
}));

const {
  clearPendingTicket,
  completeChallenge,
  consumeVerifiedTicket,
  createPendingTicket,
  readPendingTicket,
} = await import("@/lib/auth/mfa/tickets");

beforeEach(() => {
  cookieStore.clear();
  findUniqueMock.mockReset();
  createMock.mockReset();
  updateManyMock.mockReset();
  deleteManyMock.mockReset();
});

describe("createPendingTicket / readPendingTicket", () => {
  it("round-trips through a signed cookie reference to the same ticket row", async () => {
    createMock.mockResolvedValueOnce({ id: "ticket-1" });
    await createPendingTicket("user-1");
    expect(cookieStore.has("frye_mfa_pending")).toBe(true);

    findUniqueMock.mockResolvedValueOnce({
      id: "ticket-1",
      userId: "user-1",
      purpose: "MFA_PENDING",
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const pending = await readPendingTicket();
    expect(pending).toEqual({ id: "ticket-1", userId: "user-1" });
  });

  it("rejects a tampered cookie value without even querying the database", async () => {
    createMock.mockResolvedValueOnce({ id: "ticket-1" });
    await createPendingTicket("user-1");

    const raw = cookieStore.get("frye_mfa_pending")!;
    const [ticketId] = raw.split(".");
    cookieStore.set("frye_mfa_pending", `${ticketId}.forged-signature-value`);

    const pending = await readPendingTicket();
    expect(pending).toBeNull();
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("returns null once the underlying ticket has expired", async () => {
    createMock.mockResolvedValueOnce({ id: "ticket-1" });
    await createPendingTicket("user-1");

    findUniqueMock.mockResolvedValueOnce({
      id: "ticket-1",
      userId: "user-1",
      purpose: "MFA_PENDING",
      consumedAt: null,
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(await readPendingTicket()).toBeNull();
  });

  it("returns null with no cookie at all (e.g. a direct hit on /login/mfa)", async () => {
    const pending = await readPendingTicket();
    expect(pending).toBeNull();
    expect(findUniqueMock).not.toHaveBeenCalled();
  });
});

describe("completeChallenge / consumeVerifiedTicket", () => {
  it("consumes the pending ticket and mints a one-shot verified ticket", async () => {
    updateManyMock.mockResolvedValueOnce({ count: 1 });
    createMock.mockResolvedValueOnce({ id: "verified-1" });
    const verifiedId = await completeChallenge("pending-1", "user-1");
    expect(verifiedId).toBe("verified-1");
  });

  it("refuses to complete an already-consumed or expired pending ticket", async () => {
    updateManyMock.mockResolvedValueOnce({ count: 0 });
    await expect(completeChallenge("pending-1", "user-1")).rejects.toThrow();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("consumes a verified ticket and returns its owner exactly once", async () => {
    updateManyMock.mockResolvedValueOnce({ count: 1 });
    findUniqueMock.mockResolvedValueOnce({ userId: "user-1" });
    const result = await consumeVerifiedTicket("verified-1");
    expect(result).toEqual({ userId: "user-1" });
  });

  it("rejects a forged, unknown, expired, or already-used verified ticket id — the actual anti-bypass check", async () => {
    updateManyMock.mockResolvedValueOnce({ count: 0 });
    const result = await consumeVerifiedTicket("guessed-or-replayed-ticket-id");
    expect(result).toBeNull();
    // No user lookup happens on a failed consumption — nothing about the
    // ticket's owner is revealed to a caller who can't consume it.
    expect(findUniqueMock).not.toHaveBeenCalled();
  });
});

describe("clearPendingTicket", () => {
  it("removes the pending cookie so a stale ticket reference can't be reused next login", async () => {
    cookieStore.set("frye_mfa_pending", "whatever.value");
    await clearPendingTicket();
    expect(cookieStore.has("frye_mfa_pending")).toBe(false);
  });
});
