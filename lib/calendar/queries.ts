import type {
  CalendarEventStatus,
  CalendarEventType,
  DeadlineType,
  MeetingProvider,
  Prisma,
  TaskStatus,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import { matterIdFilterFor, matterScopeFilterFor } from "@/lib/auth/access";
import type { AuthorizableUser } from "@/lib/auth/authorization";
import { contactVisibilityFilterFor } from "@/lib/contacts/visibility";
import { eventVisibilityFilterFor } from "@/lib/calendar/access";
import { detectMeetingProvider } from "@/lib/calendar/meeting-url";
import {
  MAX_OCCURRENCE_SHIFT_DAYS,
  allReminderOffsets,
  occurrenceKey,
  reminderWindowOpen,
  resolveOccurrences,
} from "@/lib/calendar/occurrences";
import { FIRM_TIME_ZONE, addDaysToKey, startOfDayUtc } from "@/lib/calendar/timezone";

/**
 * Calendar reads. CalendarEvents are scoped by `eventVisibilityFilterFor`
 * (matter-linked → matter access; matterless → ADMIN/creator/attendee) and
 * Deadlines by the existing `matterScopeFilterFor`; nothing here returns
 * an unscoped row. Recurring events are expanded into per-occurrence items
 * with their per-occurrence exceptions applied (lib/calendar/occurrences.ts).
 * Deadlines are date-only and shown as all-day items on their stored
 * calendar date. Tasks appear only as an optional read-only layer built
 * from existing Task rows (never copied into CalendarEvent).
 */

type MatterSummary = { id: string; caseNumber: string; client: { firstName: string; lastName: string } };

export type CalendarItem = {
  /** Unique per occurrence (event id + original start, or deadline/task id). */
  key: string;
  kind: "event" | "deadline" | "task";
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
  /** Every reminder offset in minutes (primary + additional), largest first. */
  reminderOffsetsMinutes: number[];
  recurring: boolean;
  /** For a recurring event: the occurrence's original (rule-generated) start — its stable identity. */
  originalStart: Date | null;
  /** This occurrence was individually edited. */
  modified: boolean;
  taskStatus: TaskStatus | null;
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
  /** Include the read-only task due-date layer. */
  includeTasks?: boolean;
};

const matterSummarySelect = {
  select: { id: true, caseNumber: true, client: { select: { firstName: true, lastName: true } } },
} as const;

const SHIFT_MS = MAX_OCCURRENCE_SHIFT_DAYS * 86_400_000;

/**
 * Events whose (possibly recurring) span can intersect [start, end). A
 * recurring series is widened by the maximum occurrence shift so an
 * occurrence moved into the range by an exception is still found.
 */
function rangeCondition(start: Date, end: Date): Prisma.CalendarEventWhereInput {
  const widenedStart = new Date(start.getTime() - SHIFT_MS);
  const widenedEnd = new Date(end.getTime() + SHIFT_MS);
  return {
    OR: [
      { recurrenceFrequency: "NONE", startTime: { lt: end }, OR: [{ endTime: { gte: start } }, { startTime: { gte: start } }] },
      {
        recurrenceFrequency: { not: "NONE" },
        startTime: { lt: widenedEnd },
        OR: [{ recurrenceUntil: null }, { recurrenceUntil: { gte: widenedStart } }],
      },
    ],
  };
}

const exceptionSelect = {
  select: { originalStart: true, kind: true, startTime: true, endTime: true, title: true, location: true, meetingUrl: true },
} as const;

type EventRow = Prisma.CalendarEventGetPayload<{
  include: { matter: typeof matterSummarySelect; exceptions: typeof exceptionSelect };
}>;

export function eventToItems(event: EventRow, start: Date, end: Date, options: { includeCancelled?: boolean } = {}): CalendarItem[] {
  const recurring = event.recurrenceFrequency !== "NONE";
  return resolveOccurrences(event, event.exceptions ?? [], start, end, options).map((occurrence) => ({
    key: recurring ? occurrenceKey(event.id, occurrence.originalStart) : event.id,
    kind: "event" as const,
    id: event.id,
    title: occurrence.title ?? event.title,
    start: occurrence.start,
    end: occurrence.end,
    allDay: event.allDay,
    timeZone: event.timeZone,
    eventType: event.type,
    deadlineType: null,
    status: occurrence.cancelled ? "CANCELLED" : event.status,
    satisfied: null,
    matter: event.matter,
    // Blank occurrence overrides fall back to the series values.
    location: occurrence.location ?? event.location,
    meetingUrl: occurrence.meetingUrl ?? event.meetingUrl,
    meetingProvider: occurrence.meetingUrl ? detectMeetingProvider(new URL(occurrence.meetingUrl)) : event.meetingProvider,
    reminderMinutesBefore: event.reminderMinutesBefore,
    reminderOffsetsMinutes: allReminderOffsets(event.reminderMinutesBefore, event.reminderOffsetsMinutes),
    recurring,
    originalStart: recurring ? occurrence.originalStart : null,
    modified: occurrence.modified,
    taskStatus: null,
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

  const [events, deadlines, tasks] = await Promise.all([
    prisma.calendarEvent.findMany({
      where: { AND: conditions },
      include: { matter: matterSummarySelect, exceptions: exceptionSelect },
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
    filters.includeTasks && !filters.type ? getTaskCalendarItems(user, filters) : Promise.resolve([]),
  ]);

  const items: CalendarItem[] = events.flatMap((event) =>
    eventToItems(event, filters.start, filters.end, { includeCancelled: filters.includeCancelled }),
  );
  items.push(...tasks);
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
      reminderOffsetsMinutes: [],
      recurring: false,
      originalStart: null,
      modified: false,
      taskStatus: null,
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
      exceptions: { orderBy: { originalStart: "asc" } },
    },
  });
}

/**
 * Read-only task layer: open/in-progress/done tasks with a due date in the
 * range, from existing Task rows, scoped exactly like the firm Tasks page
 * (`matterScopeFilterFor`, archived matters excluded). The staff filter
 * means the task's assignee. Task due dates are stored as calendar dates
 * (UTC midnight), so they render as all-day items on that date.
 */
export async function getTaskCalendarItems(
  user: AuthorizableUser,
  filters: Pick<CalendarRangeFilters, "firstDay" | "lastDay" | "matterId" | "staffId">,
): Promise<CalendarItem[]> {
  const conditions: Prisma.TaskWhereInput[] = [
    await matterScopeFilterFor(user),
    { matter: { archived: false } },
    { status: { not: "CANCELLED" } },
    {
      dueDate: {
        gte: new Date(`${filters.firstDay}T00:00:00.000Z`),
        lt: new Date(`${addDaysToKey(filters.lastDay, 1)}T00:00:00.000Z`),
      },
    },
  ];
  if (filters.matterId) conditions.push({ matterId: filters.matterId });
  if (filters.staffId) conditions.push({ assignedToId: filters.staffId });
  const tasks = await prisma.task.findMany({
    where: { AND: conditions },
    select: { id: true, title: true, dueDate: true, status: true, matter: matterSummarySelect },
    orderBy: { dueDate: "asc" },
    take: 1_000,
  });
  return tasks.flatMap((task): CalendarItem[] => {
    if (!task.dueDate) return [];
    const key = task.dueDate.toISOString().slice(0, 10);
    return [
      {
        key: `task:${task.id}`,
        kind: "task",
        id: task.id,
        title: task.title,
        start: startOfDayUtc(key, FIRM_TIME_ZONE),
        end: startOfDayUtc(addDaysToKey(key, 1), FIRM_TIME_ZONE),
        allDay: true,
        timeZone: FIRM_TIME_ZONE,
        eventType: null,
        deadlineType: null,
        status: null,
        satisfied: null,
        matter: task.matter,
        location: null,
        meetingUrl: null,
        meetingProvider: null,
        reminderMinutesBefore: null,
        reminderOffsetsMinutes: [],
        recurring: false,
        originalStart: null,
        modified: false,
        taskStatus: task.status,
      },
    ];
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
 * (now ≥ start − the largest of the event's reminder offsets, and the
 * occurrence hasn't started). Cancelled occurrences never remind; moved
 * occurrences remind relative to their new start. In-app only — no email
 * or push delivery exists.
 */
export async function getUpcomingMeetings(user: AuthorizableUser, limit = 5, now = new Date()) {
  const end = new Date(now.getTime() + UPCOMING_WINDOW_DAYS * 86_400_000);
  const visibility = await eventVisibilityFilterFor(user);
  const events = await prisma.calendarEvent.findMany({
    where: { AND: [visibility, rangeCondition(now, end), { status: { not: "CANCELLED" } }] },
    include: { matter: matterSummarySelect, exceptions: exceptionSelect },
    orderBy: { startTime: "asc" },
    take: 500,
  });
  const occurrences = events
    .flatMap((event) => eventToItems(event, now, end))
    .filter((item) => item.start >= now)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const reminders = occurrences.filter((item) => reminderWindowOpen(item.start, item.reminderOffsetsMinutes, now));
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
