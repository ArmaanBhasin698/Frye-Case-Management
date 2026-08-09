import { getMatterCalendarEvents, getMatterDeadlines } from "@/lib/matters/queries";
import { DeadlineList } from "@/components/shared/deadline-list";
import { NewDeadlineForm } from "@/components/shared/new-deadline-form";
import { CalendarEventList } from "@/components/shared/calendar-event-list";
import { NewCalendarEventForm } from "@/components/shared/new-calendar-event-form";

export default async function MatterDeadlinesPage({
  params,
}: {
  params: Promise<{ matterId: string }>;
}) {
  const { matterId } = await params;
  const [deadlines, events] = await Promise.all([
    getMatterDeadlines(matterId),
    getMatterCalendarEvents(matterId),
  ]);

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
          <h2 className="text-lg font-semibold text-foreground">Calendar Events</h2>
          <NewCalendarEventForm matterId={matterId} />
        </div>
        <CalendarEventList matterId={matterId} events={events} />
      </section>
    </div>
  );
}
