import Link from "next/link";
import { notFound } from "next/navigation";
import { Bell, Repeat } from "lucide-react";

import { requireCurrentUser } from "@/lib/auth/session";
import { getEventDetail } from "@/lib/calendar/queries";
import { describeRecurrence } from "@/lib/calendar/recurrence";
import { EVENT_STATUS_LABELS, reminderOffsetLabel } from "@/lib/calendar/fields";
import { MEETING_PROVIDER_LABELS, detectMeetingProvider } from "@/lib/calendar/meeting-url";
import { allReminderOffsets, occurrenceHref, resolveSingleOccurrence } from "@/lib/calendar/occurrences";
import { addDaysToKey, dateKeyInZone, formatInZone, zoneAbbreviation } from "@/lib/calendar/timezone";
import { calendarEventTypeLabel, matterStatusLabel } from "@/lib/matters/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MeetingLinkActions } from "@/components/shared/calendar/meeting-link-actions";
import { CancelEventButton } from "@/components/shared/calendar/cancel-event-button";
import { CancelOccurrenceButton, RestoreOccurrenceButton } from "@/components/shared/calendar/occurrence-actions";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p>
      <span className="text-muted-foreground">{label}: </span>
      {children}
    </p>
  );
}

function describeWhen(start: Date, end: Date | null, allDay: boolean, tz: string) {
  if (allDay) {
    const first = dateKeyInZone(start, tz);
    const last = end ? addDaysToKey(dateKeyInZone(end, tz), -1) : first;
    const fmt = (key: string) =>
      formatInZone(new Date(`${key}T12:00:00Z`), "UTC", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
    return first === last ? `${fmt(first)} · All day` : `${fmt(first)} – ${fmt(last)} · All day`;
  }
  return `${formatInZone(start, tz, { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}${
    end ? ` – ${formatInZone(end, tz, { hour: "numeric", minute: "2-digit" })}` : ""
  } ${zoneAbbreviation(start, tz)}`;
}

/**
 * Event detail. `getEventDetail` returns null for an invisible or
 * nonexistent id → same 404. For a recurring event, `?occurrence=<original
 * start ISO>` shows that single occurrence (with any exception applied);
 * an instant that isn't a real occurrence of the series is a 404 too.
 */
export default async function EventDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { eventId } = await params;
  const occurrenceParam = (await searchParams).occurrence;
  const user = await requireCurrentUser();
  const event = await getEventDetail(user, eventId);
  if (!event) notFound();

  const recurring = event.recurrenceFrequency !== "NONE";
  const occurrence =
    recurring && typeof occurrenceParam === "string"
      ? resolveSingleOccurrence(event, event.exceptions, new Date(occurrenceParam))
      : null;
  if (typeof occurrenceParam === "string" && !occurrence) notFound();

  const tz = event.timeZone;
  const seriesCancelled = event.status === "CANCELLED";
  const cancelled = seriesCancelled || Boolean(occurrence?.cancelled);
  const title = occurrence?.title ?? event.title;
  // Blank occurrence overrides fall back to the series values.
  const location = occurrence?.location ?? event.location;
  const meetingUrl = occurrence?.meetingUrl ?? event.meetingUrl;
  const provider = occurrence?.meetingUrl ? detectMeetingProvider(new URL(occurrence.meetingUrl)) : event.meetingProvider;
  const when = occurrence
    ? describeWhen(occurrence.start, occurrence.end, event.allDay, tz)
    : describeWhen(event.startTime, event.endTime, event.allDay, tz);
  const recurrence = describeRecurrence(event);
  const reminderOffsets = allReminderOffsets(event.reminderMinutesBefore, event.reminderOffsetsMinutes);
  const originalIso = occurrence?.originalStart.toISOString();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/calendar" className="text-sm text-muted-foreground hover:text-foreground">
            &larr; Calendar
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className={cancelled ? "page-title line-through" : "page-title"}>{title}</h1>
            <Badge variant="outline">{calendarEventTypeLabel(event.type)}</Badge>
            <Badge variant={cancelled ? "secondary" : event.status === "CONFIRMED" ? "success" : "outline"}>
              {occurrence?.cancelled ? "Occurrence cancelled" : EVENT_STATUS_LABELS[event.status]}
            </Badge>
            {occurrence?.modified && <Badge variant="warning">This occurrence changed</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{when}</p>
          {occurrence && (
            <p className="mt-1 text-xs text-muted-foreground">
              One occurrence of a repeating series (originally{" "}
              {describeWhen(occurrence.originalStart, null, event.allDay, tz)}).{" "}
              <Link href={occurrenceHref(event.id, null)} className="text-primary hover:underline">
                View series
              </Link>
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-start gap-2">
          {occurrence && originalIso && !seriesCancelled ? (
            <>
              {!occurrence.cancelled && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/calendar/events/${event.id}/occurrence?start=${encodeURIComponent(originalIso)}`}>Edit this occurrence</Link>
                </Button>
              )}
              {!occurrence.cancelled && <CancelOccurrenceButton eventId={event.id} originalStart={originalIso} />}
              {(occurrence.cancelled || occurrence.modified) && (
                <RestoreOccurrenceButton eventId={event.id} originalStart={originalIso} />
              )}
              <Button variant="ghost" size="sm" asChild>
                <Link href={`/calendar/events/${event.id}/edit`}>Edit entire series</Link>
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" asChild>
                <Link href={`/calendar/events/${event.id}/edit`}>{recurring ? "Edit entire series" : "Edit"}</Link>
              </Button>
              {!seriesCancelled && <CancelEventButton eventId={event.id} recurring={recurring} />}
            </>
          )}
        </div>
      </div>

      {meetingUrl && !cancelled && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">{MEETING_PROVIDER_LABELS[provider ?? "OTHER"]}</p>
              <p className="truncate text-xs text-muted-foreground">{meetingUrl}</p>
            </div>
            <MeetingLinkActions url={meetingUrl} providerLabel={MEETING_PROVIDER_LABELS[provider ?? "OTHER"]} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 text-sm">
          <Row label="Matter">
            {event.matter ? (
              <Link href={`/matters/${event.matter.id}`} className="text-primary hover:underline">
                {event.matter.caseNumber} — State v. {event.matter.client.lastName} ({matterStatusLabel(event.matter.status)})
              </Link>
            ) : (
              "Internal (no matter)"
            )}
          </Row>
          <Row label="Location">{location || "—"}</Row>
          <Row label="Time zone">{tz.replace("_", " ")}</Row>
          {recurrence && (
            <Row label="Repeats">
              <Repeat className="mr-1 inline h-3.5 w-3.5" />
              {recurrence}
            </Row>
          )}
          {reminderOffsets.length > 0 && (
            <Row label="Reminders">
              <Bell className="mr-1 inline h-3.5 w-3.5" />
              {reminderOffsets.map(reminderOffsetLabel).join(", ")} (in-app)
            </Row>
          )}
          <Row label="Staff attendees">{event.attendees.map((a) => a.user.name).join(", ") || "—"}</Row>
          <Row label="Contacts">
            {event.contacts.length === 0
              ? "—"
              : event.contacts.map((c, i) => (
                  <span key={c.contact.id}>
                    {i > 0 && ", "}
                    <Link href={`/contacts/${c.contact.id}`} className="text-primary hover:underline">
                      {c.contact.displayName}
                    </Link>
                  </span>
                ))}
          </Row>
          <Row label="Created">
            {formatInZone(event.createdAt, tz, { month: "short", day: "numeric", year: "numeric" })}
            {event.createdBy ? ` by ${event.createdBy.name}` : ""}
          </Row>
          {event.description && <p className="whitespace-pre-wrap pt-2">{event.description}</p>}
          {event.notes && <p className="whitespace-pre-wrap pt-2 text-muted-foreground">{event.notes}</p>}
        </CardContent>
      </Card>

      {recurring && !occurrence && event.exceptions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Changed occurrences</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm">
              {event.exceptions.map((ex) => (
                <li key={ex.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <Link href={occurrenceHref(event.id, ex.originalStart)} className="hover:underline">
                    {describeWhen(ex.originalStart, null, event.allDay, tz)}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {ex.kind === "CANCELLED"
                      ? "Cancelled"
                      : `Changed${ex.startTime && ex.startTime.getTime() !== ex.originalStart.getTime() ? ` → ${describeWhen(ex.startTime, ex.endTime, event.allDay, tz)}` : ""}`}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
