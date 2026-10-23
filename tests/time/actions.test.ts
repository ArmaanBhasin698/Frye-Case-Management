import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const { requireCurrentUserMock, hasMatterAccessMock, prismaMock } = vi.hoisted(() => ({
  requireCurrentUserMock: vi.fn(),
  hasMatterAccessMock: vi.fn(),
  prismaMock: {
    matter: { findUnique: vi.fn() },
    user: { count: vi.fn() },
    timeEntry: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
    activeTimer: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    auditEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireCurrentUser: requireCurrentUserMock }));
vi.mock("@/lib/auth/access", () => ({ hasMatterAccess: hasMatterAccessMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

const { createTimeEntry, discardTimer, getMyTimerState, startTimer, stopTimer, updateTimeEntry, voidTimeEntry } = await import(
  "@/lib/time/actions"
);

const admin = { id: "u-admin", role: "ADMIN" as const };
const attorney = { id: "u-att", role: "ATTORNEY" as const };
const paralegal = { id: "u-para", role: "PARALEGAL" as const };
const NOT_FOUND = "Not found or access denied.";

function fd(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}
const entryFields = {
  matterId: "m-1",
  workDate: "2026-10-05",
  hours: "1",
  minutes: "15",
  category: "DISCOVERY_REVIEW",
  description: "Reviewed body-cam footage (fictional)",
  billable: "on",
};
const audits = () => prismaMock.auditEvent.create.mock.calls.map((c) => c[0].data);

beforeEach(() => {
  vi.clearAllMocks();
  requireCurrentUserMock.mockResolvedValue(paralegal);
  hasMatterAccessMock.mockResolvedValue(true);
  prismaMock.matter.findUnique.mockResolvedValue({ status: "OPEN" });
  prismaMock.user.count.mockResolvedValue(1);
  prismaMock.timeEntry.findMany.mockResolvedValue([]);
  prismaMock.timeEntry.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "te-1", ...data }));
  prismaMock.$transaction.mockImplementation((arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: unknown) => unknown)(prismaMock) : Promise.all(arg as Promise<unknown>[]),
  );
});

describe("createTimeEntry", () => {
  it("records the caller's own time on an accessible matter and audits without the description", async () => {
    expect((await createTimeEntry({ error: null }, fd(entryFields))).error).toBeNull();
    expect(prismaMock.timeEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: paralegal.id, durationMinutes: 75, billable: true, status: "SUBMITTED", source: "MANUAL" }),
    });
    expect(audits()[0]).toMatchObject({ entityType: "TimeEntry", matterId: "m-1", metadata: expect.objectContaining({ durationMinutes: 75 }) });
    expect(JSON.stringify(audits())).not.toContain("body-cam");
  });

  it("denies a forged / inaccessible matter id with the generic error", async () => {
    hasMatterAccessMock.mockResolvedValue(false);
    expect((await createTimeEntry({ error: null }, fd(entryFields))).error).toBe(NOT_FOUND);
    expect(prismaMock.timeEntry.create).not.toHaveBeenCalled();
  });

  it("denies a nonexistent matter even for ADMIN", async () => {
    requireCurrentUserMock.mockResolvedValue(admin);
    prismaMock.matter.findUnique.mockResolvedValue(null);
    expect((await createTimeEntry({ error: null }, fd(entryFields))).error).toBe(NOT_FOUND);
  });

  it("limits new time on CLOSED matters to ADMIN/ATTORNEY", async () => {
    prismaMock.matter.findUnique.mockResolvedValue({ status: "CLOSED" });
    expect((await createTimeEntry({ error: null }, fd(entryFields))).error).toBe(NOT_FOUND);
    requireCurrentUserMock.mockResolvedValue(attorney);
    expect((await createTimeEntry({ error: null }, fd(entryFields))).error).toBeNull();
  });

  it("refuses recording time for someone else unless ADMIN", async () => {
    expect((await createTimeEntry({ error: null }, fd({ ...entryFields, userId: "u-other" }))).error).toBe(NOT_FOUND);
    requireCurrentUserMock.mockResolvedValue(admin);
    expect((await createTimeEntry({ error: null }, fd({ ...entryFields, userId: "u-other" }))).error).toBeNull();
    expect(prismaMock.timeEntry.create.mock.calls.at(-1)![0].data.userId).toBe("u-other");
  });

  it("ignores a rate submitted by a non-admin, keeps it for ADMIN", async () => {
    await createTimeEntry({ error: null }, fd({ ...entryFields, hourlyRate: "300" }));
    expect(prismaMock.timeEntry.create.mock.calls[0]![0].data.hourlyRateCents).toBeNull();
    requireCurrentUserMock.mockResolvedValue(admin);
    await createTimeEntry({ error: null }, fd({ ...entryFields, hourlyRate: "300" }));
    expect(prismaMock.timeEntry.create.mock.calls[1]![0].data.hourlyRateCents).toBe(30_000);
  });

  it("warns (but saves) when the entry overlaps another of the user's timed entries", async () => {
    prismaMock.timeEntry.findMany.mockResolvedValue([
      { id: "te-1", startedAt: new Date("2026-10-05T09:00:00"), endedAt: new Date("2026-10-05T10:00:00") },
      { id: "te-0", startedAt: new Date("2026-10-05T09:30:00"), endedAt: new Date("2026-10-05T11:00:00") },
    ]);
    const result = await createTimeEntry({ error: null }, fd({ ...entryFields, startTime: "09:00", endTime: "10:00" }));
    expect(result.error).toBeNull();
    expect(result.warning).toMatch(/overlap/);
  });
});

describe("corrections and voiding", () => {
  const own = { id: "te-1", userId: paralegal.id, matterId: "m-1", voidedAt: null, status: "SUBMITTED", description: "x", durationMinutes: 60, workDate: new Date(), startedAt: null, endedAt: null, category: "DRAFTING", billable: true, hourlyRateCents: null };

  it("lets the author correct their entry, auditing changed fields but not the description", async () => {
    prismaMock.timeEntry.findUnique.mockResolvedValue(own);
    const result = await updateTimeEntry({ error: null }, fd({ ...entryFields, entryId: "te-1", matterId: "m-forged" }));
    expect(result.error).toBeNull();
    const update = prismaMock.timeEntry.update.mock.calls[0]![0];
    expect(update.data).not.toHaveProperty("matterId");
    const meta = audits()[0].metadata;
    expect(meta.changed.durationMinutes).toEqual({ before: 60, after: 75 });
    expect(meta.descriptionChanged).toBe(true);
    expect(JSON.stringify(meta)).not.toContain("body-cam");
  });

  it("refuses to correct someone else's entry unless ADMIN", async () => {
    prismaMock.timeEntry.findUnique.mockResolvedValue({ ...own, userId: "u-other" });
    expect((await updateTimeEntry({ error: null }, fd({ ...entryFields, entryId: "te-1" }))).error).toBe(NOT_FOUND);
  });

  it("voids instead of deleting, and requires a reason", async () => {
    prismaMock.timeEntry.findUnique.mockResolvedValue(own);
    expect((await voidTimeEntry({ entryId: "te-1", reason: "" })).ok).toBe(false);
    expect(await voidTimeEntry({ entryId: "te-1", reason: "Entered on wrong matter" })).toEqual({ ok: true, data: undefined });
    expect(prismaMock.timeEntry.update).toHaveBeenCalledWith({
      where: { id: "te-1" },
      data: { voidedAt: expect.any(Date), voidReason: "Entered on wrong matter" },
    });
    expect(prismaMock.timeEntry.delete).not.toHaveBeenCalled();
    expect(prismaMock.timeEntry.deleteMany).not.toHaveBeenCalled();
  });

  it("refuses voiding when matter access has been revoked", async () => {
    prismaMock.timeEntry.findUnique.mockResolvedValue(own);
    hasMatterAccessMock.mockResolvedValue(false);
    expect((await voidTimeEntry({ entryId: "te-1", reason: "mistake" })).ok).toBe(false);
  });
});

describe("timer", () => {
  const runningTimer = (secondsAgo: number) => ({
    id: "t-1",
    userId: paralegal.id,
    matterId: "m-old",
    startedAt: new Date(Date.now() - secondsAgo * 1000),
    runningSince: new Date(Date.now() - secondsAgo * 1000),
    accumulatedSeconds: 0,
    category: "DRAFTING",
    description: "Drafting (fictional)",
  });

  it("starts a timer when none is running", async () => {
    prismaMock.activeTimer.findUnique.mockResolvedValue(null);
    expect(await startTimer({ matterId: "m-1" })).toEqual({ ok: true });
    expect(prismaMock.activeTimer.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: paralegal.id, matterId: "m-1" }) });
  });

  it("enforces one timer per user: refuses a second start without an explicit switch", async () => {
    prismaMock.activeTimer.findUnique.mockResolvedValue(runningTimer(600));
    expect(await startTimer({ matterId: "m-1" })).toMatchObject({ ok: false, code: "TIMER_RUNNING" });
    expect(prismaMock.activeTimer.create).not.toHaveBeenCalled();
  });

  it("switching stops the old timer into a DRAFT entry (never discarded) and starts the new one", async () => {
    prismaMock.activeTimer.findUnique.mockResolvedValue(runningTimer(600));
    expect(await startTimer({ matterId: "m-1", switchFromExisting: true })).toEqual({ ok: true });
    expect(prismaMock.timeEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ matterId: "m-old", status: "DRAFT", source: "TIMER", durationMinutes: 10 }),
    });
    expect(prismaMock.activeTimer.create).toHaveBeenCalled();
  });

  it("treats a concurrent duplicate start (unique userId) as TIMER_RUNNING", async () => {
    prismaMock.activeTimer.findUnique.mockResolvedValue(null);
    prismaMock.activeTimer.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "t" }));
    expect(await startTimer({ matterId: "m-1" })).toMatchObject({ ok: false, code: "TIMER_RUNNING" });
  });

  it("won't start a timer on an inaccessible matter", async () => {
    hasMatterAccessMock.mockResolvedValue(false);
    expect(await startTimer({ matterId: "m-x" })).toMatchObject({ ok: false });
    expect(prismaMock.activeTimer.findUnique).not.toHaveBeenCalled();
  });

  it("stops into a DRAFT entry for confirmation", async () => {
    prismaMock.activeTimer.findUnique.mockResolvedValue(runningTimer(45 * 60));
    expect(await stopTimer()).toEqual({ ok: true });
    expect(prismaMock.timeEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: "DRAFT", durationMinutes: 45, userId: paralegal.id }),
    });
    expect(prismaMock.activeTimer.delete).toHaveBeenCalledWith({ where: { id: "t-1" } });
  });

  it("requires confirmation for a timer running over 12 hours, then records the adjusted time", async () => {
    prismaMock.activeTimer.findUnique.mockResolvedValue(runningTimer(14 * 3600));
    expect(await stopTimer()).toMatchObject({ ok: false, code: "NEEDS_CONFIRMATION", elapsedMinutes: 840 });
    expect(prismaMock.timeEntry.create).not.toHaveBeenCalled();
    expect(await stopTimer({ confirmLongRunning: true, adjustedMinutes: 120 })).toEqual({ ok: true });
    expect(prismaMock.timeEntry.create.mock.calls[0]![0].data.durationMinutes).toBe(120);
  });

  it("discard deletes only the timer and audits it", async () => {
    prismaMock.activeTimer.findUnique.mockResolvedValue(runningTimer(60));
    expect(await discardTimer()).toEqual({ ok: true });
    expect(prismaMock.timeEntry.create).not.toHaveBeenCalled();
    expect(audits()[0]).toMatchObject({ entityType: "ActiveTimer", action: "DELETE" });
  });

  it("getMyTimerState only ever reads the caller's own timer", async () => {
    prismaMock.activeTimer.findUnique.mockResolvedValue(null);
    expect(await getMyTimerState()).toBeNull();
    expect(prismaMock.activeTimer.findUnique.mock.calls[0]![0].where).toEqual({ userId: paralegal.id });
  });
});
