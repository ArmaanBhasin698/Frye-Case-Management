import Link from "next/link";
import { Bell, Video } from "lucide-react";

import type { CalendarItem } from "@/lib/calendar/queries";
import { FIRM_TIME_ZONE, formatInZone } from "@/lib/calendar/timezone";
import { calendarEventTypeLabel } from "@/lib/matters/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Dashboard card fed by lib/calendar/queries.ts#getUpcomingMeetings (already
 * scoped to the viewer). Reminders are in-app only.
 */
export function UpcomingMeetingsCard({ meetings, reminders }: { meetings: CalendarItem[]; reminders: CalendarItem[] }) {
  const when = (item: CalendarItem) =>
    item.allDay
      ? `${formatInZone(item.start, FIRM_TIME_ZONE, { weekday: "short", month: "short", day: "numeric" })} · All day`
      : formatInZone(item.start, FIRM_TIME_ZONE, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle>Upcoming meetings</CardTitle>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/calendar?view=week">Calendar</Link>
          </Button>
          <Button size="sm" asChild>
            <Link href="/calendar/events/new">New event</Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {reminders.length > 0 && (
          <ul className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm" aria-label="Reminders">
            {reminders.map((item) => (
              <li key={`r-${item.key}`} className="flex items-center gap-2 text-amber-900">
                <Bell className="h-3.5 w-3.5 shrink-0" />
                <Link href={`/calendar/events/${item.id}`} className="truncate hover:underline">
                  {item.title}
                </Link>
                <span className="shrink-0 text-xs">{when(item)}</span>
              </li>
            ))}
          </ul>
        )}
        {meetings.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing scheduled in the next two weeks.</p>
        ) : (
          <ul className="divide-y divide-border">
            {meetings.map((item) => (
              <li key={item.key} className="flex items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <Link href={`/calendar/events/${item.id}`} className="block truncate text-sm font-medium hover:underline">
                    {item.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {when(item)}
                    {item.eventType ? ` · ${calendarEventTypeLabel(item.eventType)}` : ""}
                    {item.matter ? ` · ${item.matter.caseNumber}` : ""}
                  </p>
                </div>
                {item.meetingUrl ? (
                  <a
                    href={item.meetingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex shrink-0 items-center rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-muted"
                  >
                    <Video className="mr-1 h-3 w-3" />
                    Join
                  </a>
                ) : (
                  item.status === "CONFIRMED" && <Badge variant="success">Confirmed</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
