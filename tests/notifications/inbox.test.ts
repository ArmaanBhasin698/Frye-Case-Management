import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, requireCurrentUserMock, getCurrentUserMock, getAssignedMatterIdsMock, readableConversationIdsMock } = vi.hoisted(() => ({
  prismaMock: {
    notification: { count: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    notificationPreference: { upsert: vi.fn(), findMany: vi.fn() },
    calendarEvent: { findMany: vi.fn() },
    task: { findMany: vi.fn() },
    deadline: { findMany: vi.fn() },
    matter: { findMany: vi.fn() },
  },
  requireCurrentUserMock: vi.fn(),
  getCurrentUserMock: vi.fn(),
  getAssignedMatterIdsMock: vi.fn(),
  readableConversationIdsMock: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/session", () => ({ requireCurrentUser: requireCurrentUserMock, getCurrentUser: getCurrentUserMock }));
vi.mock("@/lib/auth/access", () => ({
  getAssignedMatterIds: getAssignedMatterIdsMock,
  matterScopeFilterFor: vi.fn(async () => ({ matterId: { in: ["m1"] } })),
}));
vi.mock("@/lib/calendar/access", () => ({ eventVisibilityFilterFor: vi.fn(async () => ({ VISIBLE_EVENTS: true })) }));
vi.mock("@/lib/chat/access", () => ({ readableConversationIds: readableConversationIdsMock }));

const { buildAccessibleNotificationFilter, countUnreadNotifications, listNotifications, viewFilter } = await import("@/lib/notifications/queries");
const { dismissNotification, markAllNotificationsRead, markNotificationRead, setNotificationPreference } = await import("@/lib/notifications/actions");
const { GET: unreadCountRoute } = await import("@/app/api/notifications/unread-count/route");

const staff = { id: "u-staff", role: "STAFF" as const };
const admin = { id: "u-admin", role: "ADMIN" as const };

beforeEach(() => {
  vi.clearAllMocks();
  requireCurrentUserMock.mockResolvedValue(staff);
  getAssignedMatterIdsMock.mockResolvedValue(["m1"]);
  readableConversationIdsMock.mockResolvedValue(["c1"]);
  prismaMock.calendarEvent.findMany.mockResolvedValue([{ id: "internal-1" }]);
  prismaMock.notification.findMany.mockResolvedValue([]);
  prismaMock.task.findMany.mockResolvedValue([]);
  prismaMock.deadline.findMany.mockResolvedValue([]);
  prismaMock.matter.findMany.mockResolvedValue([]);
});

describe("access-scoped listing and counts", () => {
  it("builds a filter limited to the user's own rows and currently reachable records", () => {
    expect(
      buildAccessibleNotificationFilter({ userId: "u", admin: false, assignedMatterIds: ["m1"], visibleInternalEventIds: ["e9"], readableConversationIds: ["c1"] }),
    ).toEqual({
      userId: "u",
      OR: [
        { matterId: { in: ["m1"] } },
        { matterId: null, entityType: "CalendarEvent", entityId: { in: ["e9"] } },
        { matterId: null, entityType: "ChatConversation", entityId: { in: ["c1"] } },
      ],
    });
  });

  it("drops a notification for a matter the user lost access to — from the count as well as the list", async () => {
    getAssignedMatterIdsMock.mockResolvedValue([]); // unassigned from m1
    prismaMock.notification.count.mockResolvedValue(0);
    await countUnreadNotifications(staff);
    const where = prismaMock.notification.count.mock.calls[0]![0].where;
    expect(where.AND[0].OR[0]).toEqual({ matterId: { in: [] } });
    expect(where.AND[1]).toEqual(viewFilter("unread"));
  });

  it("scopes conversation notifications to conversations the user can still read (left/revoked excluded)", async () => {
    readableConversationIdsMock.mockResolvedValue([]);
    await listNotifications(staff, "unread");
    const where = prismaMock.notification.findMany.mock.calls[0]![0].where;
    expect(where.AND[0].OR[2]).toEqual({ matterId: null, entityType: "ChatConversation", entityId: { in: [] } });
  });

  it("resolves display text under the viewer's current scope, never by bare id", async () => {
    prismaMock.notification.findMany.mockResolvedValue([
      { id: "n1", kind: "TASK_DUE", title: "Task due soon", entityType: "Task", entityId: "t1", matterId: "m1", createdAt: new Date(), readAt: null, dismissedAt: null },
      { id: "n2", kind: "EVENT_REMINDER", title: "Event reminder: Hearing", entityType: "CalendarEvent", entityId: "e1", matterId: "m1", createdAt: new Date(), readAt: null, dismissedAt: null },
    ]);
    prismaMock.task.findMany.mockResolvedValue([{ id: "t1", title: "Fictional: subpoena custodian" }]);
    prismaMock.calendarEvent.findMany.mockResolvedValueOnce([{ id: "internal-1" }]).mockResolvedValueOnce([]);
    const rows = await listNotifications(staff, "unread");
    expect(prismaMock.task.findMany.mock.calls[0]![0].where.AND[1]).toEqual({ matterId: { in: ["m1"] } });
    expect(prismaMock.calendarEvent.findMany.mock.calls[1]![0].where.AND[1]).toEqual({ VISIBLE_EVENTS: true });
    expect(rows.map((r) => [r.detail, r.href])).toEqual([
      ["Fictional: subpoena custodian", "/matters/m1/tasks"],
      [null, "/calendar/events/e1"],
    ]);
  });

  it("gives admins every matter but still only their own rows", async () => {
    prismaMock.notification.count.mockResolvedValue(2);
    await countUnreadNotifications(admin);
    const where = prismaMock.notification.count.mock.calls[0]![0].where;
    expect(where.AND[0].userId).toBe("u-admin");
    expect(where.AND[0].OR[0]).toEqual({ matterId: { not: null } });
    expect(getAssignedMatterIdsMock).not.toHaveBeenCalled();
  });

  it("unread-count route requires a session", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    expect((await unreadCountRoute()).status).toBe(401);
    getCurrentUserMock.mockResolvedValue(staff);
    prismaMock.notification.count.mockResolvedValue(4);
    const ok = await unreadCountRoute();
    expect(await ok.json()).toEqual({ unread: 4 });
  });
});

describe("inbox actions", () => {
  it("only ever updates the caller's own notification (forged id matches nothing)", async () => {
    prismaMock.notification.updateMany.mockResolvedValue({ count: 0 });
    expect(await markNotificationRead({ notificationId: "someone-elses" })).toEqual({ ok: false, error: "Not found or access denied." });
    expect(prismaMock.notification.updateMany).toHaveBeenCalledWith({
      where: { id: "someone-elses", userId: "u-staff" },
      data: { readAt: expect.any(Date) },
    });
  });

  it("dismisses and marks all read for the caller only", async () => {
    prismaMock.notification.updateMany.mockResolvedValue({ count: 1 });
    expect((await dismissNotification({ notificationId: "n1" })).ok).toBe(true);
    await markAllNotificationsRead();
    expect(prismaMock.notification.updateMany).toHaveBeenLastCalledWith({
      where: { userId: "u-staff", readAt: null, dismissedAt: null },
      data: { readAt: expect.any(Date) },
    });
  });

  it("stores a preference for the caller and rejects unknown kinds", async () => {
    expect((await setNotificationPreference({ kind: "NOT_A_KIND", inApp: false })).ok).toBe(false);
    await setNotificationPreference({ kind: "TASK_DUE", inApp: false });
    expect(prismaMock.notificationPreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId_kind: { userId: "u-staff", kind: "TASK_DUE" } } }),
    );
  });
});
