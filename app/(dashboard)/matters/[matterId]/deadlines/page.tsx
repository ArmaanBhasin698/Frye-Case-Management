import Link from "next/link";
import { Repeat } from "lucide-react";

import { requireCurrentUser } from "@/lib/auth/session";
import { assertMatterAccess } from "@/lib/auth/access";
import { getMatterDeadlines } from "@/lib/matters/queries";
import { getMatterEvents } from "@/lib/calendar/queries";
import { describeRecurrence } from "@/lib/calendar/recurrence";
import { EVENT_STATUS_LABELS } from "@/lib/calendar/fields";
import { MEETING_PROVIDER_LABELS } from "@/lib/calendar/meeting-url";
import { formatInZone, zoneAbbreviation } from "@/lib/calendar/timezone";
import { calendarEventTypeLabel } from "@/lib/matters/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DeadlineList } from "@/components/shared/deadline-list";
import { NewDeadlineForm } from "@/components/shared/new-deadline-form";
import { MeetingLinkActions } from "@/components/shared/calendar/meeting-link-actions";

/**
 * Matter Deadlines & Calendar tab. Appointments stay listed after the matter
 * closes (history is never removed); scheduling goes through the shared
 * calendar event form, pre-linked to this matter.
 */
export default async function MatterDeadlinesPage({ params }: { params: Promise<{ matterId: string }> }) {
  const { matterId } = await params;
  const user = await requireCurrentUser();
  await assertMatterAccess(user, matterId);

  const [deadlines, events] = await Promise.all([getMatterDeadlines(matterId), getMatterEvents(matterId)]);
  const now = new Date();
  const upcoming = events.filter((e) => (e.endTime ?? e.startTime) >= now || e.recurrenceFrequency !== "NONE");
  const past = events.filter((e) => !upcoming.includes(e)).reverse();

  const renderEvent = (event: (typeof events)[number]) => {
    const cancelled = event.status === "CANCELLED";
    const recurrence = describeRecurrence(event);
    return (
      <Card key={event.id}>
        <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/calendar/events/${event.id}`}
                className={cancelled ? "text-sm font-medium text-muted-foreground line-through" : "text-sm font-medium hover:underline"}
              >
                {event.title}
              </Link>
              <Badge variant="outline">{calendarEventTypeLabel(event.type)}</Badge>
              {event.status !== "SCHEDULED" && <Badge variant="secondary">{EVENT_STATUS_LABELS[event.status]}</Badge>}
            </div>
            <p className="text-xs text-muted-foreground">
              {event.allDay
                ? `${formatInZone(event.startTime, event.timeZone, { month: "short", day: "numeric", year: "numeric" })} · All day`
                : `${formatInZone(event.startTime, event.timeZone, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })} ${zoneAbbreviation(event.startTime, event.timeZone)}`}
              {event.location ? ` · ${event.location}` : ""}
              {event.attendees.length > 0 ? ` · ${event.attendees.map((a) => a.user.name).join(", ")}` : ""}
            </p>
            {recurrence && (
              <p className="text-xs text-muted-foreground">
                <Repeat className="mr-1 inline h-3 w-3" />
                {recurrence}
              </p>
            )}
          </div>
          {event.meetingUrl && !cancelled && (
            <MeetingLinkActions url={event.meetingUrl} providerLabel={MEETING_PROVIDER_LABELS[event.meetingProvider ?? "OTHER"]} compact />
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-foreground">Deadlines</h2>
          <NewDeadlineForm matterId={matterId} />
        </div>
        <DeadlineList matterId={matterId} deadlines={deadlines} />
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-foreground">Appointments & meetings</h2>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/calendar?view=agenda&matterId=${matterId}`}>Open in calendar</Link>
            </Button>
            <Button size="sm" asChild>
              <Link href={`/calendar/events/new?matterId=${matterId}`}>Schedule meeting</Link>
            </Button>
          </div>
        </div>
        {upcoming.length === 0 && past.length === 0 && (
          <p className="text-sm text-muted-foreground">No appointments scheduled for this matter.</p>
        )}
        {upcoming.length > 0 && <div className="space-y-2">{upcoming.map(renderEvent)}</div>}
        {past.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-muted-foreground">Past appointments</h3>
            {past.map(renderEvent)}
          </div>
        )}
      </section>
    </div>
  );
}
