import { z } from "zod";
import type { CalendarEventStatus, CalendarEventType, MeetingProvider, RecurrenceFrequency } from "@prisma/client";

import { validateMeetingUrl } from "@/lib/calendar/meeting-url";
import {
  addDaysToKey,
  fromDateTimeLocalInZone,
  isValidTimeZone,
  parseDateKey,
  startOfDayUtc,
} from "@/lib/calendar/timezone";

/**
 * Calendar event form parsing — a plain module so it's unit-testable and
 * never directly network-callable. Times arrive as wall-clock values plus
 * an IANA zone and are converted to UTC instants here.
 */

/** Form/filter order; labels come from lib/matters/format.ts#calendarEventTypeLabel. */
export const CALENDAR_EVENT_TYPE_VALUES = [
  "CLIENT_MEETING",
  "INTERNAL_MEETING",
  "HEARING",
  "TRIAL",
  "DEPOSITION",
  "CONSULTATION",
  "VIRTUAL_MEETING",
  "PHONE_CALL",
  "FILING_DEADLINE",
  "DISCOVERY_DEADLINE",
  "MEETING",
  "OTHER",
] as const satisfies readonly CalendarEventType[];

export const EVENT_STATUS_LABELS: Record<CalendarEventStatus, string> = {
  SCHEDULED: "Scheduled",
  CONFIRMED: "Confirmed",
  CANCELLED: "Cancelled",
  COMPLETED: "Completed",
};
export const EVENT_STATUS_VALUES = Object.keys(EVENT_STATUS_LABELS) as [CalendarEventStatus, ...CalendarEventStatus[]];

export const RECURRENCE_LABELS: Record<RecurrenceFrequency, string> = {
  NONE: "Does not repeat",
  DAILY: "Daily",
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
};
export const RECURRENCE_VALUES = Object.keys(RECURRENCE_LABELS) as [RecurrenceFrequency, ...RecurrenceFrequency[]];

export const REMINDER_OPTIONS = [
  { value: "", label: "No reminder" },
  { value: "15", label: "15 minutes before" },
  { value: "60", label: "1 hour before" },
  { value: "1440", label: "1 day before" },
  { value: "10080", label: "1 week before" },
] as const;

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} is too long.`)
    .optional()
    .transform((v) => (v ? v : undefined));

const MAX_EVENT_DAYS = 31;

const eventFormSchema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(200, "Title is too long."),
  type: z.enum(CALENDAR_EVENT_TYPE_VALUES),
  status: z.enum(EVENT_STATUS_VALUES).default("SCHEDULED"),
  matterId: optionalText(100, "Matter"),
  allDay: z.boolean(),
  timeZone: z.string().trim().min(1).max(64).refine(isValidTimeZone, "Choose a valid time zone."),
  start: z.string().min(1, "Start is required."),
  end: z.string().optional(),
  location: optionalText(300, "Location"),
  description: optionalText(5_000, "Description"),
  meetingUrl: optionalText(2_100, "Meeting link"),
  reminderMinutesBefore: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : undefined))
    .refine((v) => v === undefined || (Number.isInteger(v) && v >= 0 && v <= 60 * 24 * 30), "Invalid reminder."),
  recurrenceFrequency: z.enum(RECURRENCE_VALUES).default("NONE"),
  recurrenceInterval: z.coerce.number().int().min(1).max(52).default(1),
  recurrenceUntil: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => !v || parseDateKey(v) !== null, "Invalid repeat-until date."),
  recurrenceCount: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : undefined))
    .refine((v) => v === undefined || (Number.isInteger(v) && v >= 1 && v <= 500), "Repeat count must be 1–500."),
  attendeeIds: z.array(z.string().trim().min(1).max(100)).max(50),
  contactIds: z.array(z.string().trim().min(1).max(100)).max(50),
});

export type ParsedEventForm = {
  title: string;
  type: CalendarEventType;
  status: CalendarEventStatus;
  matterId: string | null;
  allDay: boolean;
  timeZone: string;
  startTime: Date;
  endTime: Date | null;
  location: string | null;
  description: string | null;
  meetingUrl: string | null;
  meetingProvider: MeetingProvider | null;
  reminderMinutesBefore: number | null;
  recurrenceFrequency: RecurrenceFrequency;
  recurrenceInterval: number;
  recurrenceUntil: Date | null;
  recurrenceCount: number | null;
  attendeeIds: string[];
  contactIds: string[];
};

export function readEventForm(formData: FormData): { ok: true; data: ParsedEventForm } | { ok: false; error: string } {
  const get = (key: string) => {
    const value = formData.get(key);
    return value === null ? undefined : String(value);
  };
  const parsed = eventFormSchema.safeParse({
    title: get("title"),
    type: get("type"),
    status: get("status") || undefined,
    matterId: get("matterId"),
    allDay: get("allDay") === "on",
    timeZone: get("timeZone") || "",
    start: get("start") ?? "",
    end: get("end"),
    location: get("location"),
    description: get("description"),
    meetingUrl: get("meetingUrl"),
    reminderMinutesBefore: get("reminderMinutesBefore"),
    recurrenceFrequency: get("recurrenceFrequency") || undefined,
    recurrenceInterval: get("recurrenceInterval") || undefined,
    recurrenceUntil: get("recurrenceUntil"),
    recurrenceCount: get("recurrenceCount"),
    attendeeIds: [...new Set(formData.getAll("attendeeIds").map(String))],
    contactIds: [...new Set(formData.getAll("contactIds").map(String))],
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  let startTime: Date | null;
  let endTime: Date | null = null;
  if (d.allDay) {
    // All-day events span whole local days: [start-of-first-day, start-of-day-after-last).
    const first = parseDateKey(d.start.slice(0, 10)) ? d.start.slice(0, 10) : null;
    const last = d.end ? (parseDateKey(d.end.slice(0, 10)) ? d.end.slice(0, 10) : null) : first;
    if (!first || !last) return { ok: false, error: "Enter valid dates." };
    if (last < first) return { ok: false, error: "End date must be on or after the start date." };
    startTime = startOfDayUtc(first, d.timeZone);
    endTime = startOfDayUtc(addDaysToKey(last, 1), d.timeZone);
  } else {
    startTime = fromDateTimeLocalInZone(d.start, d.timeZone);
    if (!startTime) return { ok: false, error: "Enter a valid start date and time." };
    if (d.end) {
      endTime = fromDateTimeLocalInZone(d.end, d.timeZone);
      if (!endTime) return { ok: false, error: "Enter a valid end date and time." };
      if (endTime <= startTime) return { ok: false, error: "End time must be after start time." };
    }
  }
  if (endTime && endTime.getTime() - startTime.getTime() > MAX_EVENT_DAYS * 86_400_000) {
    return { ok: false, error: "A single event can't span more than 31 days — use a repeating event instead." };
  }

  let meetingUrl: string | null = null;
  let meetingProvider: MeetingProvider | null = null;
  if (d.meetingUrl) {
    const result = validateMeetingUrl(d.meetingUrl);
    if (!result.ok) return { ok: false, error: result.error };
    meetingUrl = result.url;
    meetingProvider = result.provider;
  }

  const recurring = d.recurrenceFrequency !== "NONE";
  const recurrenceUntil = recurring && d.recurrenceUntil ? startOfDayUtc(addDaysToKey(d.recurrenceUntil, 1), d.timeZone) : null;
  if (recurrenceUntil && recurrenceUntil <= startTime) {
    return { ok: false, error: "Repeat-until date must be after the first occurrence." };
  }

  return {
    ok: true,
    data: {
      title: d.title,
      type: d.type,
      status: d.status,
      matterId: d.matterId ?? null,
      allDay: d.allDay,
      timeZone: d.timeZone,
      startTime,
      endTime,
      location: d.location ?? null,
      description: d.description ?? null,
      meetingUrl,
      meetingProvider,
      reminderMinutesBefore: d.reminderMinutesBefore ?? null,
      recurrenceFrequency: d.recurrenceFrequency,
      recurrenceInterval: recurring ? d.recurrenceInterval : 1,
      recurrenceUntil,
      recurrenceCount: recurring ? (d.recurrenceCount ?? null) : null,
      attendeeIds: d.attendeeIds,
      contactIds: d.contactIds,
    },
  };
}
