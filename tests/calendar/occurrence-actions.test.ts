import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, requireCurrentUserMock, hasMatterAccessMock, getAssignedMatterIdsMock, canViewContactMock, redirectMock } =
  vi.hoisted(() => ({
    prismaMock: {
      calendarEvent: { count: vi.fn(), update: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
      calendarEventException: { upsert: vi.fn(), findUnique: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
      calendarEventAttendee: { deleteMany: vi.fn(), createMany: vi.fn() },
      calendarEventContact: { deleteMany: vi.fn(), createMany: vi.fn() },
      contact: { findUnique: vi.fn() },
      matter: { findMany: vi.fn() },
      task: { findMany: vi.fn() },
      deadline: { findMany: vi.fn() },
      user: { count: vi.fn() },
      auditEvent: { create: vi.fn() },
      $transaction: vi.fn(),
    },
    requireCurrentUserMock: vi.fn(),
    hasMatterAccessMock: vi.fn(),
    getAssignedMatterIdsMock: vi.fn(),
    canViewContactMock: vi.fn(),
    redirectMock: vi.fn(() => {
      throw new Error("NEXT_REDIRECT");
    }),
  }));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/auth/session", () => ({ requireCurrentUser: requireCurrentUserMock }));
vi.mock("@/lib/auth/access", () => ({
  hasMatterAccess: hasMatterAccessMock,
  getAssignedMatterIds: getAssignedMatterIdsMock,
  matterIdFilterFor: vi.fn(async (u: { role: string }) => (u.role === "ADMIN" ? {} : { id: { in: ["m-1"] } })),
  matterScopeFilterFor: vi.fn(async (u: { role: string }) => (u.role === "ADMIN" ? {} : { matterId: { in: ["m-1"] } })),
}));
vi.mock("@/lib/contacts/visibility", () => ({
  canViewContact: canViewContactMock,
  contactVisibilityFilterFor: vi.fn(async () => ({ VISIBLE: true })),
}));

const { cancelOccurrence, restoreOccurrence, updateEvent, updateOccurrence } = await import("@/lib/calendar/actions");
const { getCalendarItems, getTaskCalendarItems, getUpcomingMeetings } = await import("@/lib/calendar/queries");
const { resolveContactPrefill } = await import("@/lib/calendar/prefill");

const staff = { id: "u-staff", role: "STAFF" as const };
const attorney = { id: "u-att", role: "ATTORNEY" as const };
const NOT_FOUND = "Not found or access denied.";

const series = {
  id: "ev-1",
  matterId: "m-1",
  title: "Weekly client check-in",
  type: "CLIENT_MEETING",
  status: "SCHEDULED",
  startTime: new Date("2026-10-19T14:00:00Z"),
  endTime: new Date("2026-10-19T15:00:00Z"),
  allDay: false,
  timeZone: "America/New_York",
  location: "Conference room A",
  description: null,
  meetingUrl: null,
  meetingProvider: null,
  reminderMinutesBefore: 60,
  reminderOffsetsMinutes: [1440],
  recurrenceFrequency: "WEEKLY",
  recurrenceInterval: 1,
  recurrenceUntil: null,
  recurrenceCount: 10,
};
const NOV2 = "2026-11-02T15:00:00.000Z";

function fd(fields: Record<string, string | string[]>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireCurrentUserMock.mockResolvedValue(staff);
  hasMatterAccessMock.mockResolvedValue(true);
  getAssignedMatterIdsMock.mockResolvedValue(["m-1"]);
  canViewContactMock.mockResolvedValue(true);
  prismaMock.calendarEvent.count.mockResolvedValue(1);
  prismaMock.calendarEvent.findUnique.mockResolvedValue(series);
  prismaMock.calendarEvent.findMany.mockResolvedValue([]);
  prismaMock.deadline.findMany.mockResolvedValue([]);
  prismaMock.task.findMany.mockResolvedValue([]);
  prismaMock.calendarEventException.upsert.mockResolvedValue({ id: "x-1" });
  prismaMock.$transaction.mockImplementation((arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: unknown) => unknown)(prismaMock) : Promise.all(arg as Promise<unknown>[]),
  );
  redirectMock.mockImplementation(() => {
    throw new Error("NEXT_REDIRECT");
  });
});

describe("cancelOccurrence", () => {
  it("records a CANCELLED exception keyed by the occurrence's original start", async () => {
    expect(await cancelOccurrence({ eventId: "ev-1", originalStart: NOV2 })).toEqual({ ok: true, data: undefined });
    expect(prismaMock.calendarEventException.upsert).toHaveBeenCalledWith({
      where: { eventId_originalStart: { eventId: "ev-1", originalStart: new Date(NOV2) } },
      create: { eventId: "ev-1", originalStart: new Date(NOV2), kind: "CANCELLED", createdById: staff.id },
      update: { kind: "CANCELLED" },
    });
    expect(prismaMock.calendarEvent.update).not.toHaveBeenCalled();
  });

  it("rejects a forged start that isn't an occurrence of the series", async () => {
    for (const originalStart of ["2026-11-02T14:00:00.000Z", "2026-11-03T15:00:00.000Z", "garbage"]) {
      expect(await cancelOccurrence({ eventId: "ev-1", originalStart })).toEqual({ ok: false, error: NOT_FOUND });
    }
    expect(prismaMock.calendarEventException.upsert).not.toHaveBeenCalled();
  });

  it("applies the same visibility rule as the event (inaccessible → generic denial)", async () => {
    prismaMock.calendarEvent.count.mockResolvedValue(0);
    expect(await cancelOccurrence({ eventId: "ev-1", originalStart: NOV2 })).toEqual({ ok: false, error: NOT_FOUND });
    expect(prismaMock.calendarEvent.findUnique).not.toHaveBeenCalled();
  });

  it("refuses non-recurring and cancelled series", async () => {
    prismaMock.calendarEvent.findUnique.mockResolvedValue({ ...series, recurrenceFrequency: "NONE" });
    expect((await cancelOccurrence({ eventId: "ev-1", originalStart: series.startTime.toISOString() })).ok).toBe(false);
    prismaMock.calendarEvent.findUnique.mockResolvedValue({ ...series, status: "CANCELLED" });
    expect((await cancelOccurrence({ eventId: "ev-1", originalStart: NOV2 })).ok).toBe(false);
  });

  it("restore removes only that occurrence's exception", async () => {
    prismaMock.calendarEventException.findUnique.mockResolvedValue({ id: "x-1", kind: "CANCELLED" });
    expect(await restoreOccurrence({ eventId: "ev-1", originalStart: NOV2 })).toEqual({ ok: true, data: undefined });
    expect(prismaMock.calendarEventException.delete).toHaveBeenCalledWith({ where: { id: "x-1" } });
  });
});

describe("updateOccurrence", () => {
  it("stores a MODIFIED exception with overrides, without copying text into the audit log", async () => {
    await expect(
      updateOccurrence(
        { error: null },
        fd({ eventId: "ev-1", originalStart: NOV2, start: "2026-11-03T11:00", end: "2026-11-03T12:00", title: "Private strategy session" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(prismaMock.calendarEventException.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          kind: "MODIFIED",
          startTime: new Date("2026-11-03T16:00:00Z"),
          endTime: new Date("2026-11-03T17:00:00Z"),
          title: "Private strategy session",
        }),
      }),
    );
    const metadata = prismaMock.auditEvent.create.mock.calls[0]![0].data.metadata;
    expect(metadata).toMatchObject({ kind: "MODIFIED", moved: true, overrides: ["title"] });
    expect(JSON.stringify(metadata)).not.toContain("Private strategy");
    expect(redirectMock).toHaveBeenCalledWith(`/calendar/events/ev-1?occurrence=${encodeURIComponent(NOV2)}`);
  });

  it("rejects a forged occurrence and an unsafe meeting link", async () => {
    expect(
      (await updateOccurrence({ error: null }, fd({ eventId: "ev-1", originalStart: "2026-11-04T15:00:00.000Z", start: "2026-11-03T11:00" })))
        .error,
    ).toBe(NOT_FOUND);
    expect(
      (await updateOccurrence({ error: null }, fd({ eventId: "ev-1", originalStart: NOV2, start: "2026-11-03T11:00", meetingUrl: "http://zoom.us/j/1" })))
        .error,
    ).toBeTruthy();
    expect(prismaMock.calendarEventException.upsert).not.toHaveBeenCalled();
  });

  it("denies a user who can't see the event", async () => {
    prismaMock.calendarEvent.count.mockResolvedValue(0);
    expect((await updateOccurrence({ error: null }, fd({ eventId: "ev-1", originalStart: NOV2, start: "2026-11-03T11:00" }))).error).toBe(
      NOT_FOUND,
    );
  });
});

describe("whole-series edit", () => {
  it("drops orphaned exceptions in the same transaction and audits only counts", async () => {
    prismaMock.calendarEvent.findUnique.mockResolvedValue({
      ...series,
      attendees: [],
      contacts: [],
      exceptions: [
        { id: "x-oct26", originalStart: new Date("2026-10-26T14:00:00Z") },
        { id: "x-nov2", originalStart: new Date(NOV2) },
      ],
    });
    await expect(
      updateEvent(
        { error: null },
        fd({
          eventId: "ev-1",
          matterId: "m-1",
          title: series.title,
          type: "CLIENT_MEETING",
          timeZone: "America/New_York",
          start: "2026-10-19T10:00",
          end: "2026-10-19T11:00",
          recurrenceFrequency: "WEEKLY",
          recurrenceInterval: "2",
          recurrenceCount: "10",
        }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(prismaMock.calendarEventException.deleteMany).toHaveBeenCalledWith({ where: { eventId: "ev-1", id: { in: ["x-oct26"] } } });
    const metadata = prismaMock.auditEvent.create.mock.calls[0]![0].data.metadata;
    expect(metadata).toMatchObject({ exceptionsKept: 1, exceptionsDropped: 1 });
  });
});

describe("queries", () => {
  it("applies exceptions when listing the calendar", async () => {
    prismaMock.calendarEvent.findMany.mockResolvedValue([
      {
        ...series,
        matter: null,
        exceptions: [
          { originalStart: new Date("2026-10-26T14:00:00Z"), kind: "CANCELLED", startTime: null, endTime: null, title: null, location: null, meetingUrl: null },
          {
            originalStart: new Date(NOV2),
            kind: "MODIFIED",
            startTime: new Date("2026-11-03T16:00:00Z"),
            endTime: null,
            title: "Moved",
            location: null,
            meetingUrl: "https://example.zoom.us/j/123",
          },
        ],
      },
    ]);
    const items = await getCalendarItems(staff, {
      start: new Date("2026-10-25T00:00:00Z"),
      end: new Date("2026-11-08T00:00:00Z"),
      firstDay: "2026-10-25",
      lastDay: "2026-11-07",
    });
    expect(items.map((i) => [i.key, i.title, i.location, i.meetingProvider, i.modified])).toEqual([
      [`ev-1@${NOV2}`, "Moved", "Conference room A", "ZOOM", true],
    ]);
  });

  it("reminds using every offset, and never for a cancelled occurrence", async () => {
    prismaMock.calendarEvent.findMany.mockResolvedValue([
      {
        ...series,
        matter: null,
        exceptions: [
          { originalStart: new Date("2026-10-26T14:00:00Z"), kind: "CANCELLED", startTime: null, endTime: null, title: null, location: null, meetingUrl: null },
        ],
      },
    ]);
    // 20h before Nov 2 15:00Z: only the 1-day offset is open; Oct 26 is cancelled.
    const { reminders } = await getUpcomingMeetings(staff, 5, new Date("2026-11-01T19:00:00Z"));
    expect(reminders.map((r) => r.key)).toEqual([`ev-1@${NOV2}`]);
    expect(reminders[0]!.reminderOffsetsMinutes).toEqual([1440, 60]);
  });

  it("scopes the task layer to the viewer's matters and filters staff by assignee", async () => {
    await getTaskCalendarItems(staff, { firstDay: "2026-11-01", lastDay: "2026-11-30", staffId: "u-x" });
    const where = prismaMock.task.findMany.mock.calls[0]![0].where;
    expect(where.AND[0]).toEqual({ matterId: { in: ["m-1"] } });
    expect(where.AND).toContainEqual({ matter: { archived: false } });
    expect(where.AND).toContainEqual({ status: { not: "CANCELLED" } });
    expect(where.AND).toContainEqual({ assignedToId: "u-x" });
  });

  it("maps tasks to read-only all-day items and only includes them when requested", async () => {
    prismaMock.task.findMany.mockResolvedValue([
      { id: "t-1", title: "File motion", dueDate: new Date("2026-11-05T00:00:00Z"), status: "OPEN", matter: { id: "m-1", caseNumber: "X", client: { firstName: "A", lastName: "B" } } },
    ]);
    const range = { start: new Date("2026-11-01T04:00:00Z"), end: new Date("2026-12-01T05:00:00Z"), firstDay: "2026-11-01", lastDay: "2026-11-30" };
    expect((await getCalendarItems(staff, range)).some((i) => i.kind === "task")).toBe(false);
    expect(prismaMock.task.findMany).not.toHaveBeenCalled();
    const task = (await getCalendarItems(staff, { ...range, includeTasks: true })).find((i) => i.kind === "task")!;
    expect(task).toMatchObject({ key: "task:t-1", allDay: true, taskStatus: "OPEN", start: new Date("2026-11-05T05:00:00Z") });
    // A type filter means "events only".
    prismaMock.task.findMany.mockClear();
    await getCalendarItems(staff, { ...range, includeTasks: true, type: "HEARING" });
    expect(prismaMock.task.findMany).not.toHaveBeenCalled();
  });
});

describe("schedule-with-contact prefill", () => {
  it("ignores a contact the user can't see, without querying matters", async () => {
    canViewContactMock.mockResolvedValue(false);
    expect(await resolveContactPrefill(staff, "c-hidden")).toEqual({ contact: null, matterIds: [] });
    expect(prismaMock.matter.findMany).not.toHaveBeenCalled();
  });

  it("returns only the viewer's matters that actively link the contact", async () => {
    prismaMock.contact.findUnique.mockResolvedValue({ id: "c-1", displayName: "Jane Doe", archived: false });
    prismaMock.matter.findMany.mockResolvedValue([{ id: "m-1" }]);
    expect(await resolveContactPrefill(attorney, "c-1")).toEqual({ contact: { id: "c-1", displayName: "Jane Doe" }, matterIds: ["m-1"] });
    const where = prismaMock.matter.findMany.mock.calls[0]![0].where;
    expect(where.AND[0]).toEqual({ id: { in: ["m-1"] } });
    expect(JSON.stringify(where)).toContain('"removedAt":null');
  });

  it("ignores archived contacts and missing ids", async () => {
    prismaMock.contact.findUnique.mockResolvedValue({ id: "c-1", displayName: "Jane Doe", archived: true });
    expect((await resolveContactPrefill(staff, "c-1")).contact).toBeNull();
    expect(await resolveContactPrefill(staff, undefined)).toEqual({ contact: null, matterIds: [] });
  });
});
