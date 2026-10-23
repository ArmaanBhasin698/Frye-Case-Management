import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, requireCurrentUserMock, hasMatterAccessMock, getAssignedMatterIdsMock, canViewContactMock, redirectMock } =
  vi.hoisted(() => ({
    prismaMock: {
      calendarEvent: { count: vi.fn(), create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
      calendarEventAttendee: { deleteMany: vi.fn(), createMany: vi.fn() },
      calendarEventContact: { deleteMany: vi.fn(), createMany: vi.fn() },
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

const { buildEventVisibilityFilter, canAccessEvent } = await import("@/lib/calendar/access");
const { cancelEvent, createEvent, updateEvent } = await import("@/lib/calendar/actions");
const { getCalendarItems, getUpcomingMeetings, getContactMeetingHistory } = await import("@/lib/calendar/queries");

const admin = { id: "u-admin", role: "ADMIN" as const };
const staff = { id: "u-staff", role: "STAFF" as const };
const NOT_FOUND = "Not found or access denied.";

function fd(fields: Record<string, string | string[]>) {
  const formData = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) formData.append(k, x);
  return formData;
}
const validEvent = {
  title: "Witness prep",
  type: "CLIENT_MEETING",
  timeZone: "America/New_York",
  start: "2026-10-26T10:00",
  end: "2026-10-26T11:00",
};

beforeEach(() => {
  vi.clearAllMocks();
  requireCurrentUserMock.mockResolvedValue(staff);
  hasMatterAccessMock.mockResolvedValue(true);
  getAssignedMatterIdsMock.mockResolvedValue(["m-1"]);
  canViewContactMock.mockResolvedValue(true);
  prismaMock.user.count.mockResolvedValue(0);
  prismaMock.calendarEvent.findMany.mockResolvedValue([]);
  prismaMock.deadline.findMany.mockResolvedValue([]);
  prismaMock.$transaction.mockImplementation((arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: unknown) => unknown)(prismaMock) : Promise.all(arg as Promise<unknown>[]),
  );
  redirectMock.mockImplementation(() => {
    throw new Error("NEXT_REDIRECT");
  });
});

describe("event visibility", () => {
  it("admins see every event", () => {
    expect(buildEventVisibilityFilter(admin, [])).toEqual({});
  });

  it("others see matter events on their matters, and matterless events they created or attend", () => {
    expect(buildEventVisibilityFilter(staff, ["m-1"])).toEqual({
      OR: [
        { matterId: { in: ["m-1"] } },
        { matterId: null, OR: [{ createdById: "u-staff" }, { attendees: { some: { userId: "u-staff" } } }] },
      ],
    });
  });

  it("attendance never grants access to another matter's event (the attendee branch requires matterId null)", () => {
    const filter = buildEventVisibilityFilter(staff, []) as { OR: Array<Record<string, unknown>> };
    expect(filter.OR[1]).toMatchObject({ matterId: null });
  });

  it("canAccessEvent checks the id AND visibility in one query (forged ids → false)", async () => {
    prismaMock.calendarEvent.count.mockResolvedValue(0);
    expect(await canAccessEvent(staff, "ev-forged")).toBe(false);
    expect(prismaMock.calendarEvent.count).toHaveBeenCalledWith({
      where: { AND: [{ id: "ev-forged" }, buildEventVisibilityFilter(staff, ["m-1"])] },
    });
  });
});

describe("createEvent", () => {
  it("refuses a matter the user can't access", async () => {
    hasMatterAccessMock.mockResolvedValue(false);
    expect((await createEvent({ error: null }, fd({ ...validEvent, matterId: "m-secret" }))).error).toBe(NOT_FOUND);
    expect(prismaMock.calendarEvent.create).not.toHaveBeenCalled();
  });

  it("refuses inactive or forged attendees and invisible contacts", async () => {
    prismaMock.user.count.mockResolvedValue(1);
    expect((await createEvent({ error: null }, fd({ ...validEvent, attendeeIds: ["u-1", "u-forged"] }))).error).toMatch(/active staff/);
    canViewContactMock.mockResolvedValue(false);
    expect((await createEvent({ error: null }, fd({ ...validEvent, contactIds: ["c-hidden"] }))).error).toBe(NOT_FOUND);
    expect(prismaMock.calendarEvent.create).not.toHaveBeenCalled();
  });

  it("creates with creator, attendees, contacts, provider, and an audit event without free text", async () => {
    prismaMock.user.count.mockResolvedValue(1);
    prismaMock.calendarEvent.create.mockResolvedValue({ id: "ev-1" });
    await expect(
      createEvent(
        { error: null },
        fd({
          ...validEvent,
          matterId: "m-1",
          description: "Discuss the private defense theory",
          location: "Conference room B",
          meetingUrl: "https://zoom.us/j/123",
          attendeeIds: ["u-1"],
          contactIds: ["c-1"],
        }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(prismaMock.calendarEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        matterId: "m-1",
        createdById: "u-staff",
        meetingProvider: "ZOOM",
        startTime: new Date("2026-10-26T14:00:00Z"),
        attendees: { create: [{ userId: "u-1" }] },
        contacts: { create: [{ contactId: "c-1" }] },
      }),
    });
    const audit = JSON.stringify(prismaMock.auditEvent.create.mock.calls[0]![0]);
    expect(audit).toContain('"matterId":"m-1"');
    expect(audit).not.toContain("defense theory");
    expect(audit).not.toContain("Conference room");
    expect(audit).not.toContain("zoom.us");
    expect(redirectMock).toHaveBeenCalledWith("/calendar/events/ev-1");
  });

  it("allows an internal event with no matter", async () => {
    prismaMock.calendarEvent.create.mockResolvedValue({ id: "ev-2" });
    await expect(createEvent({ error: null }, fd({ ...validEvent, type: "INTERNAL_MEETING" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(hasMatterAccessMock).not.toHaveBeenCalled();
    expect(prismaMock.calendarEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ matterId: null }) });
  });
});

describe("updateEvent / cancelEvent", () => {
  it("returns the generic denial for an event the user can't see", async () => {
    prismaMock.calendarEvent.count.mockResolvedValue(0);
    expect((await updateEvent({ error: null }, fd({ ...validEvent, eventId: "ev-x" }))).error).toBe(NOT_FOUND);
    expect(await cancelEvent({ eventId: "ev-x" })).toEqual({ ok: false, error: NOT_FOUND });
    expect(prismaMock.calendarEvent.update).not.toHaveBeenCalled();
  });

  it("refuses moving a visible event onto a matter the user can't access", async () => {
    prismaMock.calendarEvent.count.mockResolvedValue(1);
    prismaMock.calendarEvent.findUnique.mockResolvedValue({ id: "ev-1", matterId: null, attendees: [], contacts: [] });
    hasMatterAccessMock.mockResolvedValue(false);
    expect((await updateEvent({ error: null }, fd({ ...validEvent, eventId: "ev-1", matterId: "m-secret" }))).error).toBe(NOT_FOUND);
    expect(prismaMock.calendarEvent.update).not.toHaveBeenCalled();
  });

  it("keeps contacts linked by others that this user can't see, and audits only field names", async () => {
    prismaMock.calendarEvent.count.mockResolvedValue(1);
    prismaMock.calendarEvent.findUnique.mockResolvedValue({
      id: "ev-1",
      matterId: "m-1",
      title: "Old title",
      attendees: [],
      contacts: [{ contactId: "c-hidden" }],
    });
    canViewContactMock.mockImplementation(async (_u: unknown, id: string) => id !== "c-hidden");
    await expect(
      updateEvent({ error: null }, fd({ ...validEvent, eventId: "ev-1", matterId: "m-1", contactIds: ["c-1"] })),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(prismaMock.calendarEventContact.createMany).toHaveBeenCalledWith({
      data: [
        { eventId: "ev-1", contactId: "c-1" },
        { eventId: "ev-1", contactId: "c-hidden" },
      ],
    });
    const metadata = prismaMock.auditEvent.create.mock.calls[0]![0].data.metadata;
    expect(metadata.changedFields).toContain("title");
    expect(JSON.stringify(metadata)).not.toContain("Witness prep");
  });

  it("cancels (never deletes) and refuses a second cancel", async () => {
    prismaMock.calendarEvent.count.mockResolvedValue(1);
    prismaMock.calendarEvent.findUnique.mockResolvedValue({ id: "ev-1", status: "SCHEDULED", matterId: "m-1" });
    expect(await cancelEvent({ eventId: "ev-1" })).toEqual({ ok: true, data: undefined });
    expect(prismaMock.calendarEvent.update).toHaveBeenCalledWith({ where: { id: "ev-1" }, data: { status: "CANCELLED" } });
    prismaMock.calendarEvent.findUnique.mockResolvedValue({ id: "ev-1", status: "CANCELLED", matterId: "m-1" });
    expect((await cancelEvent({ eventId: "ev-1" })).ok).toBe(false);
  });
});

describe("queries", () => {
  const range = {
    start: new Date("2026-10-01T04:00Z"),
    end: new Date("2026-11-01T04:00Z"),
    firstDay: "2026-10-01",
    lastDay: "2026-10-31",
  };

  it("ANDs event visibility and scopes deadlines to the viewer's matters", async () => {
    await getCalendarItems(staff, range);
    const where = prismaMock.calendarEvent.findMany.mock.calls[0]![0].where;
    expect(where.AND[0]).toEqual(buildEventVisibilityFilter(staff, ["m-1"]));
    expect(where.AND).toContainEqual({ status: { not: "CANCELLED" } });
    expect(prismaMock.deadline.findMany.mock.calls[0]![0].where.AND[0]).toEqual({ matterId: { in: ["m-1"] } });
  });

  it("a staff or type filter excludes deadlines (they have neither)", async () => {
    await getCalendarItems(staff, { ...range, staffId: "u-1" });
    expect(prismaMock.deadline.findMany).not.toHaveBeenCalled();
    const where = prismaMock.calendarEvent.findMany.mock.calls[0]![0].where;
    expect(where.AND).toContainEqual({ OR: [{ createdById: "u-1" }, { attendees: { some: { userId: "u-1" } } }] });
  });

  it("expands recurring events and maps deadlines to all-day items on their stored date", async () => {
    prismaMock.calendarEvent.findMany.mockResolvedValue([
      {
        id: "ev-r",
        title: "Weekly team sync",
        type: "INTERNAL_MEETING",
        startTime: new Date("2026-10-05T14:00Z"),
        endTime: new Date("2026-10-05T14:30Z"),
        allDay: false,
        timeZone: "America/New_York",
        status: "SCHEDULED",
        matter: null,
        location: null,
        meetingUrl: null,
        meetingProvider: null,
        reminderMinutesBefore: null,
        recurrenceFrequency: "WEEKLY",
        recurrenceInterval: 1,
        recurrenceUntil: null,
        recurrenceCount: null,
      },
    ]);
    prismaMock.deadline.findMany.mockResolvedValue([
      { id: "d-1", description: "Motion due", type: "FILING", satisfied: false, date: new Date("2026-10-15T00:00Z"), matter: null },
    ]);
    const items = await getCalendarItems(admin, range);
    expect(items.filter((i) => i.id === "ev-r")).toHaveLength(4);
    const deadline = items.find((i) => i.kind === "deadline")!;
    expect(deadline.allDay).toBe(true);
    expect(deadline.start.toISOString()).toBe("2026-10-15T04:00:00.000Z");
  });

  it("surfaces reminders whose window has opened, and only future occurrences", async () => {
    const now = new Date("2026-10-23T13:00Z");
    prismaMock.calendarEvent.findMany.mockResolvedValue([
      {
        id: "ev-soon",
        title: "Bond hearing",
        type: "HEARING",
        startTime: new Date("2026-10-23T14:00Z"),
        endTime: null,
        allDay: false,
        timeZone: "America/New_York",
        status: "SCHEDULED",
        matter: null,
        location: null,
        meetingUrl: null,
        meetingProvider: null,
        reminderMinutesBefore: 60,
        recurrenceFrequency: "NONE",
        recurrenceInterval: 1,
        recurrenceUntil: null,
        recurrenceCount: null,
      },
      {
        id: "ev-later",
        title: "Later",
        type: "MEETING",
        startTime: new Date("2026-10-30T14:00Z"),
        endTime: null,
        allDay: false,
        timeZone: "America/New_York",
        status: "SCHEDULED",
        matter: null,
        location: null,
        meetingUrl: null,
        meetingProvider: null,
        reminderMinutesBefore: 60,
        recurrenceFrequency: "NONE",
        recurrenceInterval: 1,
        recurrenceUntil: null,
        recurrenceCount: null,
      },
    ]);
    const { meetings, reminders } = await getUpcomingMeetings(staff, 5, now);
    expect(meetings.map((m) => m.id)).toEqual(["ev-soon", "ev-later"]);
    expect(reminders.map((m) => m.id)).toEqual(["ev-soon"]);
  });

  it("contact meeting history is limited to events the viewer can see", async () => {
    await getContactMeetingHistory(staff, "c-1");
    expect(prismaMock.calendarEvent.findMany.mock.calls[0]![0].where).toEqual({
      AND: [buildEventVisibilityFilter(staff, ["m-1"]), { contacts: { some: { contactId: "c-1" } } }],
    });
  });
});
