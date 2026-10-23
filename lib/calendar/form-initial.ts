import type { CalendarEvent, CalendarEventStatus, CalendarEventType, RecurrenceFrequency } from "@prisma/client";

import { addDaysToKey, dateKeyInZone, FIRM_TIME_ZONE, parseDateKey, toDateTimeLocalInZone } from "@/lib/calendar/timezone";

export type EventFormInitial = {
  id?: string;
  title: string;
  type: CalendarEventType;
  status: CalendarEventStatus;
  matterId: string;
  allDay: boolean;
  timeZone: string;
  /** "yyyy-MM-ddTHH:mm" (timed) or "yyyy-MM-dd" (all-day), wall time in `timeZone`. */
  start: string;
  end: string;
  location: string;
  description: string;
  meetingUrl: string;
  reminderMinutesBefore: string;
  reminderOffsetsMinutes: number[];
  recurrenceFrequency: RecurrenceFrequency;
  recurrenceInterval: string;
  recurrenceUntil: string;
  recurrenceCount: string;
  attendeeIds: string[];
  contactIds: string[];
};

/** Blank form for a new event, optionally pre-linked to a matter, a contact, and a day. */
export function newEventInitial(options: { matterId?: string; date?: string; contactId?: string }): EventFormInitial {
  const date = options.date && parseDateKey(options.date) ? options.date : dateKeyInZone(new Date(), FIRM_TIME_ZONE);
  return {
    title: "",
    type: options.matterId ? "CLIENT_MEETING" : "INTERNAL_MEETING",
    status: "SCHEDULED",
    matterId: options.matterId ?? "",
    allDay: false,
    timeZone: FIRM_TIME_ZONE,
    start: `${date}T09:00`,
    end: `${date}T10:00`,
    location: "",
    description: "",
    meetingUrl: "",
    reminderMinutesBefore: "",
    reminderOffsetsMinutes: [],
    recurrenceFrequency: "NONE",
    recurrenceInterval: "1",
    recurrenceUntil: "",
    recurrenceCount: "",
    attendeeIds: [],
    contactIds: options.contactId ? [options.contactId] : [],
  };
}

/** Form values for editing a stored event, shown in the event's own time zone. */
export function eventToFormInitial(
  event: CalendarEvent & { attendees: { userId: string }[]; contacts: { contactId: string }[] },
): EventFormInitial {
  const tz = event.timeZone;
  const allDayEnd = event.endTime ? addDaysToKey(dateKeyInZone(event.endTime, tz), -1) : dateKeyInZone(event.startTime, tz);
  return {
    id: event.id,
    title: event.title,
    type: event.type,
    status: event.status,
    matterId: event.matterId ?? "",
    allDay: event.allDay,
    timeZone: tz,
    start: event.allDay ? dateKeyInZone(event.startTime, tz) : toDateTimeLocalInZone(event.startTime, tz),
    end: event.allDay ? allDayEnd : event.endTime ? toDateTimeLocalInZone(event.endTime, tz) : "",
    location: event.location ?? "",
    description: event.description ?? "",
    meetingUrl: event.meetingUrl ?? "",
    reminderMinutesBefore: event.reminderMinutesBefore?.toString() ?? "",
    reminderOffsetsMinutes: event.reminderOffsetsMinutes ?? [],
    recurrenceFrequency: event.recurrenceFrequency,
    recurrenceInterval: String(event.recurrenceInterval),
    recurrenceUntil: event.recurrenceUntil ? addDaysToKey(dateKeyInZone(event.recurrenceUntil, tz), -1) : "",
    recurrenceCount: event.recurrenceCount?.toString() ?? "",
    attendeeIds: event.attendees.map((a) => a.userId),
    contactIds: event.contacts.map((c) => c.contactId),
  };
}
