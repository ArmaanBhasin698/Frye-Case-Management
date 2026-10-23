import type {
  CalendarEventStatus,
  CalendarEventType,
  DeadlineType,
  MeetingProvider,
  Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import { matterIdFilterFor, matterScopeFilterFor } from "@/lib/auth/access";
import type { AuthorizableUser } from "@/lib/auth/authorization";
import { contactVisibilityFilterFor } from "@/lib/contacts/visibility";
import { eventVisibilityFilterFor } from "@/lib/calendar/access";
import { expandOccurrences } from "@/lib/calendar/recurrence";
import { FIRM_TIME_ZONE, addDaysToKey, startOfDayUtc } from "@/lib/calendar/timezone";

/**
 * Calendar reads. CalendarEvents are scoped by `eventVisibilityFilterFor`
 * (matter-linked → matter access; matterless → ADMIN/creator/attendee) and
 * Deadlines by the existing `matterScopeFilterFor`; nothing here returns
 * an unscoped row. Recurring events are expanded into per-occurrence items
 * (lib/calendar/recurrence.ts). Deadlines are date-only and shown as
 * all-day items on their stored calendar date.
 */

type MatterSummary = { id: string; caseNumber: string; client: { firstName: string; lastName: string } };

export type CalendarItem = {
  /** Unique per occurrence (event id + occurrence index, or deadline id). */
  key: string;
  kind: "event" | "deadline";
  id: string;
  title: string;
  start: Date;
  end: Date | null;
  allDay: boolean;
  timeZone: string;
  eventType: CalendarEventType | null;
  deadlineType: DeadlineType | null;
  status: CalendarEventStatus | null;
  satisfied: boolean | null;
  matter: MatterSummary | null;
  location: string | null;
  meetingUrl: string | null;
  meetingProvider: MeetingProvider | null;
  reminderMinutesBefore: number | null;
  recurring: boolean;
};

export type CalendarRangeFilters = {
  start: Date;
  end: Date;
  /** Wall dates covered (for date-only Deadlines), inclusive. */
  firstDay: string;
  lastDay: string;
  matterId?: string;
  staffId?: string;
  type?: CalendarEventType;
  includeCancelled?: boolean;
};

const matterSummarySelect = {
  select: { id: true, caseNumber: true, client: { select: { firstName: true, lastName: true } } },
} as const;

/** Events whose (possibly recurring) span can intersect [start, end). */
function rangeCondition(start: Date, end: Date): Prisma.CalendarEventWhereInput {
  return {
    startTime: { lt: end },
    OR: [
      { recurrenceFrequency: "NONE", OR: [{ endTime: { gte: start } }, { startTime: { gte: start } }] },
      { recurrenceFrequency: { not: "NONE" }, OR: [{ recurrenceUntil: null }, { recurrenceUntil: { gte: start } }] },
    ],
  };
}

type EventRow = Prisma.CalendarEventGetPayload<{ include: { matter: typeof matterSummarySelect } }>;

export function eventToItems(event: EventRow, start: Date, end: Date): CalendarItem[] {
  return expandOccurrences(event, start, end).map((occurrence) => ({
    key: `${event.id}:${occurrence.index}`,
    kind: "event" as const,
    id: event.id,
    title: event.title,
    start: occurrence.start,
    end: occurrence.end,
    allDay: event.allDay,
    timeZone: event.timeZone,
    eventType: event.type,
    deadlineType: null,
    status: event.status,
    satisfied: null,
    matter: event.matter,
    location: event.location,
    meetingUrl: event.meetingUrl,
    meetingProvider: event.meetingProvider,
    reminderMinutesBefore: event.reminderMinutesBefore,
    recurring: event.recurrenceFrequency !== "NONE",
  }));
}

export async function getCalendarItems(user: AuthorizableUser, filters: CalendarRangeFilters): Promise<CalendarItem[]> {
  const visibility = await eventVisibilityFilterFor(user);
  const conditions: Prisma.CalendarEventWhereInput[] = [visibility, rangeCondition(filters.start, filters.end)];
  if (filters.matterId) conditions.push({ matterId: filters.matterId });
  if (filters.staffId) {
    conditions.push({ OR: [{ createdById: filters.staffId }, { attendees: { some: { userId: filters.staffId } } }] });
  }
  if (filters.type) conditions.push({ type: filters.type });
  if (!filters.includeCancelled) conditions.push({ status: { not: "CANCELLED" } });

  // Deadlines carry no type/staff, so a type or staff filter means "events only".
  const includeDeadlines = !filters.type && !filters.staffId;
  const deadlineScope = await matterScopeFilterFor(user);
  const deadlineConditions: Prisma.DeadlineWhereInput[] = [
    deadlineScope,
    {
      date: {
        gte: new Date(`${filters.firstDay}T00:00:00.000Z`),
        lt: new Date(`${addDaysToKey(filters.lastDay, 1)}T00:00:00.000Z`),
      },
    },
  ];
  if (filters.matterId) deadlineConditions.push({ matterId: filters.matterId });

  const [events, deadlines] = await Promise.all([
    prisma.calendarEvent.findMany({
      where: { AND: conditions },
      include: { matter: matterSummarySelect },
      orderBy: { startTime: "asc" },
      take: 2_000,
    }),
    includeDeadlines
      ? prisma.deadline.findMany({
          where: { AND: deadlineConditions },
          include: { matter: matterSummarySelect },
          orderBy: { date: "asc" },
        })
      : Promise.resolve([]),
  ]);

  const items: CalendarItem[] = events.flatMap((event) => eventToItems(event, filters.start, filters.end));
  for (const deadline of deadlines) {
    const key = deadline.date.toISOString().slice(0, 10);
    items.push({
      key: `deadline:${deadline.id}`,
      kind: "deadline",
      id: deadline.id,
      title: deadline.description,
      start: startOfDayUtc(key, FIRM_TIME_ZONE),
      end: startOfDayUtc(addDaysToKey(key, 1), FIRM_TIME_ZONE),
      allDay: true,
      timeZone: FIRM_TIME_ZONE,
      eventType: null,
      deadlineType: deadline.type,
      status: null,
      satisfied: deadline.satisfied,
      matter: deadline.matter,
      location: null,
      meetingUrl: null,
      meetingProvider: null,
      reminderMinutesBefore: null,
      recurring: false,
    });
  }
  return items.sort((a, b) => a.start.getTime() - b.start.getTime() || Number(b.allDay) - Number(a.allDay));
}

/** Full detail for one event, or null when it doesn't exist or isn't visible. Linked contacts are filtered to ones the viewer can see. */
export async function getEventDetail(user: AuthorizableUser, eventId: string) {
  const [visibility, contactVisibility] = await Promise.all([
    eventVisibilityFilterFor(user),
    contactVisibilityFilterFor(user),
  ]);
  return prisma.calendarEvent.findFirst({
    where: { AND: [{ id: eventId }, visibility] },
    include: {
      matter: { select: { id: true, caseNumber: true, status: true, client: { select: { firstName: true, lastName: true } } } },
      attendees: { include: { user: { select: { id: true, name: true } } } },
      contacts: {
        where: { contact: contactVisibility },
        include: { contact: { select: { id: true, displayName: true } } },
      },
      createdBy: { select: { name: true } },
    },
  });
}

/** Events on one matter, including closed matters. Caller must already have asserted matter access. */
export function getMatterEvents(matterId: string) {
  return prisma.calendarEvent.findMany({
    where: { matterId },
    include: { attendees: { include: { user: { select: { name: true } } } } },
    orderBy: { startTime: "asc" },
  });
}

const UPCOMING_WINDOW_DAYS = 14;

/**
 * Next meetings for the dashboard plus reminders whose window has opened
 * (now ≥ start − reminderMinutesBefore, and the occurrence hasn't started).
 * In-app only — no email or push delivery exists.
 */
export async function getUpcomingMeetings(user: AuthorizableUser, limit = 5, now = new Date()) {
  const end = new Date(now.getTime() + UPCOMING_WINDOW_DAYS * 86_400_000);
  const visibility = await eventVisibilityFilterFor(user);
  const events = await prisma.calendarEvent.findMany({
    where: { AND: [visibility, rangeCondition(now, end), { status: { not: "CANCELLED" } }] },
    include: { matter: matterSummarySelect },
    orderBy: { startTime: "asc" },
    take: 500,
  });
  const occurrences = events
    .flatMap((event) => eventToItems(event, now, end))
    .filter((item) => item.start >= now)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const reminders = occurrences.filter(
    (item) =>
      item.reminderMinutesBefore !== null && item.start.getTime() - item.reminderMinutesBefore * 60_000 <= now.getTime(),
  );
  return { meetings: occurrences.slice(0, limit), reminders };
}

/** Events the viewer can see that are linked to `contactId`, newest first. Caller must have checked the contact is visible. */
export async function getContactMeetingHistory(user: AuthorizableUser, contactId: string) {
  const visibility = await eventVisibilityFilterFor(user);
  return prisma.calendarEvent.findMany({
    where: { AND: [visibility, { contacts: { some: { contactId } } }] },
    include: { matter: matterSummarySelect },
    orderBy: { startTime: "desc" },
    take: 100,
  });
}

/** Picker options for the event form and filters, already scoped. */
export async function getCalendarFormOptions(user: AuthorizableUser) {
  const [matterWhere, contactVisibility] = await Promise.all([matterIdFilterFor(user), contactVisibilityFilterFor(user)]);
  const [matters, staff, contacts] = await Promise.all([
    prisma.matter.findMany({
      where: matterWhere,
      select: { id: true, caseNumber: true, status: true, client: { select: { lastName: true } } },
      orderBy: { openedDate: "desc" },
    }),
    prisma.user.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.contact.findMany({
      where: { AND: [contactVisibility, { archived: false }] },
      select: { id: true, displayName: true },
      orderBy: { displayName: "asc" },
      take: 1_000,
    }),
  ]);
  return {
    matters: matters.map((m) => ({
      id: m.id,
      label: `${m.caseNumber} — State v. ${m.client.lastName}${m.status === "CLOSED" ? " (closed)" : ""}`,
    })),
    staff: staff.map((s) => ({ id: s.id, label: s.name })),
    contacts: contacts.map((c) => ({ id: c.id, label: c.displayName })),
  };
}
