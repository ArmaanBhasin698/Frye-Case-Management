import { notFound } from "next/navigation";

import { prisma } from "@/lib/db";
import { requireCurrentUser } from "@/lib/auth/session";
import { canAccessEvent } from "@/lib/calendar/access";
import { getCalendarFormOptions } from "@/lib/calendar/queries";
import { eventToFormInitial } from "@/lib/calendar/form-initial";
import { EventForm } from "@/components/shared/calendar/event-form";

export default async function EditEventPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const user = await requireCurrentUser();
  if (!(await canAccessEvent(user, eventId))) notFound();

  const [event, options] = await Promise.all([
    prisma.calendarEvent.findUnique({
      where: { id: eventId },
      include: { attendees: { select: { userId: true } }, contacts: { select: { contactId: true } } },
    }),
    getCalendarFormOptions(user),
  ]);
  if (!event) notFound();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="page-title">Edit event</h1>
      <EventForm
        initial={eventToFormInitial(event)}
        matters={options.matters}
        staff={options.staff}
        contacts={options.contacts}
        cancelHref={`/calendar/events/${event.id}`}
      />
    </div>
  );
}
