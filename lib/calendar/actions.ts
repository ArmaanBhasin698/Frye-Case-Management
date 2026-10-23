"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { hasMatterAccess } from "@/lib/auth/access";
import { requireCurrentUser } from "@/lib/auth/session";
import type { AuthorizableUser } from "@/lib/auth/authorization";
import { canViewContact } from "@/lib/contacts/visibility";
import { canAccessEvent } from "@/lib/calendar/access";
import { readEventForm, type ParsedEventForm } from "@/lib/calendar/fields";
import type { ActionResult } from "@/lib/matters/actions";

/**
 * Calendar event writes. Every action re-checks the session, event
 * visibility (lib/calendar/access.ts), matter access for a matter-linked
 * event, that attendees are active users, and that each linked contact is
 * visible to the caller — none of it is trusted from the form. Audit
 * metadata holds ids, enum values, and changed field names only; titles,
 * descriptions, locations, and meeting links are never copied into it.
 */

const NOT_FOUND_ERROR = "Not found or access denied.";

export type EventFormState = { error: string | null };

async function validateReferences(user: AuthorizableUser, data: ParsedEventForm): Promise<string | null> {
  if (data.matterId && !(await hasMatterAccess(user, data.matterId))) return NOT_FOUND_ERROR;
  if (data.attendeeIds.length > 0) {
    const active = await prisma.user.count({ where: { id: { in: data.attendeeIds }, status: "ACTIVE" } });
    if (active !== data.attendeeIds.length) return "Choose active staff members as attendees.";
  }
  for (const contactId of data.contactIds) {
    if (!(await canViewContact(user, contactId))) return NOT_FOUND_ERROR;
  }
  return null;
}

function columns(data: ParsedEventForm) {
  return {
    matterId: data.matterId,
    title: data.title,
    type: data.type,
    status: data.status,
    startTime: data.startTime,
    endTime: data.endTime,
    allDay: data.allDay,
    timeZone: data.timeZone,
    location: data.location,
    description: data.description,
    meetingUrl: data.meetingUrl,
    meetingProvider: data.meetingProvider,
    reminderMinutesBefore: data.reminderMinutesBefore,
    recurrenceFrequency: data.recurrenceFrequency,
    recurrenceInterval: data.recurrenceInterval,
    recurrenceUntil: data.recurrenceUntil,
    recurrenceCount: data.recurrenceCount,
  };
}

function revalidateCalendar(matterIds: (string | null)[]) {
  revalidatePath("/calendar");
  revalidatePath("/");
  for (const matterId of matterIds) {
    if (matterId) {
      revalidatePath(`/matters/${matterId}/deadlines`);
      revalidatePath(`/matters/${matterId}`);
    }
  }
}

function isForeignKeyError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003";
}

export async function createEvent(_prev: EventFormState, formData: FormData): Promise<EventFormState> {
  const user = await requireCurrentUser();
  const parsed = readEventForm(formData);
  if (!parsed.ok) return { error: parsed.error };
  const data = parsed.data;

  const referenceError = await validateReferences(user, data);
  if (referenceError) return { error: referenceError };

  let eventId: string;
  try {
    eventId = await prisma.$transaction(async (tx) => {
      const event = await tx.calendarEvent.create({
        data: {
          ...columns(data),
          createdById: user.id,
          attendees: { create: data.attendeeIds.map((userId) => ({ userId })) },
          contacts: { create: data.contactIds.map((contactId) => ({ contactId })) },
        },
      });
      await tx.auditEvent.create({
        data: {
          actorId: user.id,
          action: "CREATE",
          entityType: "CalendarEvent",
          entityId: event.id,
          matterId: data.matterId,
          metadata: {
            type: data.type,
            startTime: data.startTime.toISOString(),
            allDay: data.allDay,
            recurrence: data.recurrenceFrequency,
            meetingProvider: data.meetingProvider,
            attendeeCount: data.attendeeIds.length,
            contactCount: data.contactIds.length,
          },
        },
      });
      return event.id;
    });
  } catch (error) {
    if (isForeignKeyError(error)) return { error: NOT_FOUND_ERROR };
    throw error;
  }

  revalidateCalendar([data.matterId]);
  redirect(`/calendar/events/${eventId}`);
}

export async function updateEvent(_prev: EventFormState, formData: FormData): Promise<EventFormState> {
  const user = await requireCurrentUser();
  const eventId = z.string().trim().min(1).max(100).safeParse(formData.get("eventId"));
  if (!eventId.success || !(await canAccessEvent(user, eventId.data))) return { error: NOT_FOUND_ERROR };

  const parsed = readEventForm(formData);
  if (!parsed.ok) return { error: parsed.error };
  const data = parsed.data;

  const before = await prisma.calendarEvent.findUnique({
    where: { id: eventId.data },
    include: { attendees: { select: { userId: true } }, contacts: { select: { contactId: true } } },
  });
  if (!before) return { error: NOT_FOUND_ERROR };

  // Moving an event to a different matter (or detaching it) requires access to the target too.
  const referenceError = await validateReferences(user, data);
  if (referenceError) return { error: referenceError };

  // A contact linked by someone else that this user can't see stays linked — the
  // form only ever offered (and so only ever submits) contacts visible to this user.
  const hiddenContactIds: string[] = [];
  for (const { contactId } of before.contacts) {
    if (!data.contactIds.includes(contactId) && !(await canViewContact(user, contactId))) hiddenContactIds.push(contactId);
  }
  const nextContactIds = [...new Set([...data.contactIds, ...hiddenContactIds])];

  const next = columns(data);
  const changedFields = (Object.keys(next) as (keyof typeof next)[]).filter((key) => {
    const a = before[key];
    const b = next[key];
    return (a instanceof Date ? a.getTime() : a) !== (b instanceof Date ? b.getTime() : b);
  });
  const attendeesChanged =
    [...before.attendees.map((a) => a.userId)].sort().join() !== [...data.attendeeIds].sort().join();
  const contactsChanged = [...before.contacts.map((c) => c.contactId)].sort().join() !== [...nextContactIds].sort().join();

  try {
    await prisma.$transaction(async (tx) => {
      await tx.calendarEvent.update({ where: { id: before.id }, data: next });
      await tx.calendarEventAttendee.deleteMany({ where: { eventId: before.id } });
      await tx.calendarEventContact.deleteMany({ where: { eventId: before.id } });
      if (data.attendeeIds.length > 0) {
        await tx.calendarEventAttendee.createMany({ data: data.attendeeIds.map((userId) => ({ eventId: before.id, userId })) });
      }
      if (nextContactIds.length > 0) {
        await tx.calendarEventContact.createMany({ data: nextContactIds.map((contactId) => ({ eventId: before.id, contactId })) });
      }
      await tx.auditEvent.create({
        data: {
          actorId: user.id,
          action: "UPDATE",
          entityType: "CalendarEvent",
          entityId: before.id,
          matterId: data.matterId ?? before.matterId,
          metadata: { changedFields, attendeesChanged, contactsChanged },
        },
      });
    });
  } catch (error) {
    if (isForeignKeyError(error)) return { error: NOT_FOUND_ERROR };
    throw error;
  }

  revalidateCalendar([before.matterId, data.matterId]);
  revalidatePath(`/calendar/events/${before.id}`);
  redirect(`/calendar/events/${before.id}`);
}

/** Cancels (never deletes) an event — the whole series for a recurring event. */
export async function cancelEvent(input: { eventId: string }): Promise<ActionResult> {
  const user = await requireCurrentUser();
  const parsed = z.object({ eventId: z.string().trim().min(1).max(100) }).safeParse(input);
  if (!parsed.success || !(await canAccessEvent(user, parsed.data.eventId))) return { ok: false, error: NOT_FOUND_ERROR };

  const event = await prisma.calendarEvent.findUnique({ where: { id: parsed.data.eventId }, select: { id: true, status: true, matterId: true } });
  if (!event) return { ok: false, error: NOT_FOUND_ERROR };
  if (event.status === "CANCELLED") return { ok: false, error: "This event is already cancelled." };

  await prisma.$transaction([
    prisma.calendarEvent.update({ where: { id: event.id }, data: { status: "CANCELLED" } }),
    prisma.auditEvent.create({
      data: {
        actorId: user.id,
        action: "UPDATE",
        entityType: "CalendarEvent",
        entityId: event.id,
        matterId: event.matterId,
        metadata: { status: { before: event.status, after: "CANCELLED" } },
      },
    }),
  ]);

  revalidateCalendar([event.matterId]);
  revalidatePath(`/calendar/events/${event.id}`);
  return { ok: true, data: undefined };
}
