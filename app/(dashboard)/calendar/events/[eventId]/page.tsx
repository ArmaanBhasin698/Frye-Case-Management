import Link from "next/link";
import { notFound } from "next/navigation";
import { Bell, Repeat } from "lucide-react";

import { requireCurrentUser } from "@/lib/auth/session";
import { getEventDetail } from "@/lib/calendar/queries";
import { describeRecurrence } from "@/lib/calendar/recurrence";
import { EVENT_STATUS_LABELS, REMINDER_OPTIONS } from "@/lib/calendar/fields";
import { MEETING_PROVIDER_LABELS } from "@/lib/calendar/meeting-url";
import { addDaysToKey, dateKeyInZone, formatInZone, zoneAbbreviation } from "@/lib/calendar/timezone";
import { calendarEventTypeLabel, matterStatusLabel } from "@/lib/matters/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MeetingLinkActions } from "@/components/shared/calendar/meeting-link-actions";
import { CancelEventButton } from "@/components/shared/calendar/cancel-event-button";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p>
      <span className="text-muted-foreground">{label}: </span>
      {children}
    </p>
  );
}

/** Event detail. `getEventDetail` returns null for an invisible or nonexistent id → same 404. */
export default async function EventDetailPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const user = await requireCurrentUser();
  const event = await getEventDetail(user, eventId);
  if (!event) notFound();

  const tz = event.timeZone;
  const when = event.allDay
    ? (() => {
        const first = dateKeyInZone(event.startTime, tz);
        const last = event.endTime ? addDaysToKey(dateKeyInZone(event.endTime, tz), -1) : first;
        const fmt = (key: string) =>
          formatInZone(new Date(`${key}T12:00:00Z`), "UTC", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
        return first === last ? `${fmt(first)} · All day` : `${fmt(first)} – ${fmt(last)} · All day`;
      })()
    : `${formatInZone(event.startTime, tz, { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}${
        event.endTime ? ` – ${formatInZone(event.endTime, tz, { hour: "numeric", minute: "2-digit" })}` : ""
      } ${zoneAbbreviation(event.startTime, tz)}`;
  const recurrence = describeRecurrence(event);
  const reminder = REMINDER_OPTIONS.find((r) => r.value === String(event.reminderMinutesBefore ?? ""))?.label;
  const cancelled = event.status === "CANCELLED";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/calendar" className="text-sm text-muted-foreground hover:text-foreground">
            &larr; Calendar
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className={cancelled ? "page-title line-through" : "page-title"}>{event.title}</h1>
            <Badge variant="outline">{calendarEventTypeLabel(event.type)}</Badge>
            <Badge variant={cancelled ? "secondary" : event.status === "CONFIRMED" ? "success" : "outline"}>
              {EVENT_STATUS_LABELS[event.status]}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{when}</p>
        </div>
        <div className="flex items-start gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/calendar/events/${event.id}/edit`}>Edit</Link>
          </Button>
          {!cancelled && <CancelEventButton eventId={event.id} recurring={event.recurrenceFrequency !== "NONE"} />}
        </div>
      </div>

      {event.meetingUrl && !cancelled && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">{MEETING_PROVIDER_LABELS[event.meetingProvider ?? "OTHER"]}</p>
              <p className="truncate text-xs text-muted-foreground">{event.meetingUrl}</p>
            </div>
            <MeetingLinkActions url={event.meetingUrl} providerLabel={MEETING_PROVIDER_LABELS[event.meetingProvider ?? "OTHER"]} />
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
          <Row label="Location">{event.location || "—"}</Row>
          <Row label="Time zone">{tz.replace("_", " ")}</Row>
          {recurrence && (
            <Row label="Repeats">
              <Repeat className="mr-1 inline h-3.5 w-3.5" />
              {recurrence}
            </Row>
          )}
          {reminder && event.reminderMinutesBefore !== null && (
            <Row label="Reminder">
              <Bell className="mr-1 inline h-3.5 w-3.5" />
              {reminder} (in-app)
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
    </div>
  );
}
