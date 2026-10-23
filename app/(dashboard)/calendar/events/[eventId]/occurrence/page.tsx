import { notFound } from "next/navigation";

import { prisma } from "@/lib/db";
import { requireCurrentUser } from "@/lib/auth/session";
import { canAccessEvent } from "@/lib/calendar/access";
import { occurrenceHref, resolveSingleOccurrence } from "@/lib/calendar/occurrences";
import { addDaysToKey, dateKeyInZone, formatInZone, toDateTimeLocalInZone } from "@/lib/calendar/timezone";
import { OccurrenceForm } from "@/components/shared/calendar/occurrence-actions";

/**
 * Edit ONE occurrence of a repeating event: /calendar/events/<id>/occurrence?start=<original start ISO>.
 * Same visibility rule as the event itself; a start that isn't a real
 * occurrence (or a cancelled series/occurrence) is a 404. `updateOccurrence`
 * re-checks everything server-side.
 */
export default async function EditOccurrencePage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { eventId } = await params;
  const start = (await searchParams).start;
  const user = await requireCurrentUser();
  if (typeof start !== "string" || !(await canAccessEvent(user, eventId))) notFound();

  const event = await prisma.calendarEvent.findUnique({ where: { id: eventId }, include: { exceptions: true } });
  if (!event || event.status === "CANCELLED") notFound();
  const occurrence = resolveSingleOccurrence(event, event.exceptions, new Date(start));
  if (!occurrence || occurrence.cancelled) notFound();

  const tz = event.timeZone;
  const asInput = (date: Date) => (event.allDay ? dateKeyInZone(date, tz) : toDateTimeLocalInZone(date, tz));
  const endInput = occurrence.end
    ? event.allDay
      ? addDaysToKey(dateKeyInZone(occurrence.end, tz), -1)
      : toDateTimeLocalInZone(occurrence.end, tz)
    : "";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="page-title">Edit one occurrence</h1>
        <p className="text-sm text-muted-foreground">
          {event.title} — originally{" "}
          {formatInZone(occurrence.originalStart, tz, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
        </p>
      </div>
      <OccurrenceForm
        initial={{
          eventId: event.id,
          originalStart: occurrence.originalStart.toISOString(),
          allDay: event.allDay,
          timeZone: tz,
          start: asInput(occurrence.start),
          end: endInput,
          title: occurrence.title ?? "",
          location: occurrence.location ?? "",
          meetingUrl: occurrence.meetingUrl ?? "",
        }}
        cancelHref={occurrenceHref(event.id, occurrence.originalStart)}
      />
    </div>
  );
}
