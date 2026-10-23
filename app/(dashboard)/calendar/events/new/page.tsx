import { notFound } from "next/navigation";

import { requireCurrentUser } from "@/lib/auth/session";
import { getCalendarFormOptions } from "@/lib/calendar/queries";
import { newEventInitial } from "@/lib/calendar/form-initial";
import { EventForm } from "@/components/shared/calendar/event-form";

export default async function NewEventPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requireCurrentUser();
  const params = await searchParams;
  const matterId = typeof params.matterId === "string" ? params.matterId : undefined;
  const date = typeof params.date === "string" ? params.date : undefined;

  const options = await getCalendarFormOptions(user);
  // A matter the user can't access is indistinguishable from one that doesn't exist.
  if (matterId && !options.matters.some((m) => m.id === matterId)) notFound();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="page-title">{matterId ? "Schedule meeting" : "New event"}</h1>
        <p className="text-sm text-muted-foreground">Fictional/test data only — see CLAUDE.md and docs/SECURITY.md.</p>
      </div>
      <EventForm
        initial={newEventInitial({ matterId, date })}
        matters={options.matters}
        staff={options.staff}
        contacts={options.contacts}
        cancelHref={matterId ? `/matters/${matterId}/deadlines` : "/calendar"}
      />
    </div>
  );
}
