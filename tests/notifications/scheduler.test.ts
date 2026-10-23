import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

const { LOCK_TTL_MS, claimSchedulerLock, runNotificationScheduler } = await import("@/lib/notifications/scheduler");

const NOW = new Date("2026-11-10T15:00:00Z");

/**
 * In-memory stand-in for the tables the scheduler touches, honoring the
 * two database guarantees it relies on: the conditional lock update and
 * the (userId, dedupeKey) unique index behind createMany skipDuplicates.
 */
function fakeDb(options: { taskDue?: Date; failOnInsert?: boolean } = {}) {
  const lock: { name: string; lockedUntil: Date | null; lastOutcome?: string | null } = { name: "notifications", lockedUntil: null };
  const notifications = new Map<string, Record<string, unknown>>();
  const db = {
    lock,
    notifications,
    schedulerLock: {
      upsert: vi.fn(async () => lock),
      updateMany: vi.fn(async ({ data }: { data: { lockedUntil: Date } }) => {
        const free = lock.lockedUntil === null || lock.lockedUntil < NOW_REF.now;
        if (!free) return { count: 0 };
        lock.lockedUntil = data.lockedUntil;
        return { count: 1 };
      }),
      update: vi.fn(async ({ data }: { data: { lockedUntil: null; lastOutcome: string } }) => {
        lock.lockedUntil = data.lockedUntil;
        lock.lastOutcome = data.lastOutcome;
        return lock;
      }),
    },
    notification: {
      createMany: vi.fn(async ({ data }: { data: { userId: string; dedupeKey: string }[]; skipDuplicates: boolean }) => {
        if (options.failOnInsert) throw new Error("db down");
        let count = 0;
        for (const row of data) {
          const key = `${row.userId}|${row.dedupeKey}`;
          if (!notifications.has(key)) {
            notifications.set(key, row);
            count++;
          }
        }
        return { count };
      }),
    },
    user: { findMany: vi.fn(async () => [{ id: "att", role: "ATTORNEY" }, { id: "para", role: "PARALEGAL" }]) },
    matterAssignment: { findMany: vi.fn(async () => [{ userId: "att", matterId: "m1" }, { userId: "para", matterId: "m1" }]) },
    notificationPreference: { findMany: vi.fn(async () => []) },
    task: {
      findMany: vi.fn(async () => [
        {
          id: "t1",
          matterId: "m1",
          assignedToId: "att",
          dueDate: options.taskDue ?? new Date("2026-11-11T00:00:00Z"),
          status: "OPEN",
          reminderOffsetsMinutes: [],
          updatedAt: new Date("2026-09-01T00:00:00Z"),
        },
      ]),
    },
    deadline: {
      findMany: vi.fn(async () => [
        { id: "d1", matterId: "m1", date: new Date("2026-11-12T00:00:00Z"), reminderDaysBefore: 7, satisfied: false },
      ]),
    },
    calendarEvent: { findMany: vi.fn(async () => []) },
    auditEvent: { findMany: vi.fn(async () => []) },
    chatConversation: { findMany: vi.fn(async () => []) },
  };
  return db;
}
const NOW_REF = { now: NOW };

type Db = Parameters<typeof runNotificationScheduler>[0] extends infer O ? (O extends { db?: infer D } ? D : never) : never;
const asDb = (db: ReturnType<typeof fakeDb>) => db as unknown as Db;

describe("runNotificationScheduler", () => {
  it("creates planned notifications in bounded batches and releases the lock with counts only", async () => {
    const db = fakeDb();
    const result = await runNotificationScheduler({ now: NOW, batchSize: 1, db: asDb(db) });
    // 1 task reminder (att) + 1 deadline reminder each for att and para.
    expect(result).toEqual({ status: "completed", planned: 3, created: 3, batches: 3 });
    expect(db.lock.lockedUntil).toBeNull();
    expect(db.lock.lastOutcome).toBe("completed: planned=3 created=3");
  });

  it("is idempotent: re-running creates nothing new", async () => {
    const db = fakeDb();
    await runNotificationScheduler({ now: NOW, db: asDb(db) });
    const second = await runNotificationScheduler({ now: NOW, db: asDb(db) });
    expect(second).toEqual(expect.objectContaining({ planned: 3, created: 0 }));
    expect(db.notifications.size).toBe(3);
  });

  it("re-arms after a due date is rescheduled", async () => {
    const db = fakeDb();
    await runNotificationScheduler({ now: NOW, db: asDb(db) });
    db.task.findMany.mockResolvedValueOnce([
      { id: "t1", matterId: "m1", assignedToId: "att", dueDate: new Date("2026-11-10T20:00:00Z"), status: "OPEN", reminderOffsetsMinutes: [], updatedAt: new Date("2026-09-01T00:00:00Z") },
    ]);
    const second = await runNotificationScheduler({ now: NOW, db: asDb(db) });
    expect(second).toEqual(expect.objectContaining({ created: 1 }));
  });

  it("skips while another run holds a live lock (concurrent runs never double-insert)", async () => {
    const db = fakeDb();
    db.lock.lockedUntil = new Date(NOW.getTime() + 60_000);
    expect(await runNotificationScheduler({ now: NOW, db: asDb(db) })).toEqual({ status: "skipped", reason: "locked" });
    expect(db.notification.createMany).not.toHaveBeenCalled();
  });

  it("reclaims a stale lock left by a crashed run", async () => {
    const db = fakeDb();
    db.lock.lockedUntil = new Date(NOW.getTime() - 1);
    expect(await claimSchedulerLock(asDb(db), NOW)).toBe(true);
    expect(db.lock.lockedUntil!.getTime()).toBe(NOW.getTime() + LOCK_TTL_MS);
  });

  it("releases the lock even when an insert fails", async () => {
    const db = fakeDb({ failOnInsert: true });
    await expect(runNotificationScheduler({ now: NOW, db: asDb(db) })).rejects.toThrow("db down");
    expect(db.lock.lockedUntil).toBeNull();
    expect(db.lock.lastOutcome).toBe("failed");
  });

  it("never stores notification titles containing record text", async () => {
    const db = fakeDb();
    await runNotificationScheduler({ now: NOW, db: asDb(db) });
    for (const row of db.notifications.values()) {
      expect(["Task due soon", "Deadline approaching"]).toContain(row.title);
    }
  });
});
