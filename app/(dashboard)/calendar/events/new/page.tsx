import { notFound } from "next/navigation";

import { requireCurrentUser } from "@/lib/auth/session";
import { getCalendarFormOptions } from "@/lib/calendar/queries";
import { newEventInitial } from "@/lib/calendar/form-initial";
import { resolveContactPrefill } from "@/lib/calendar/prefill";
import { EventForm } from "@/components/shared/calendar/event-form";

/**
 * New event. `?matterId=` pre-links a matter (404 if not accessible);
 * `?contactId=` pre-links a contact the user can see (silently ignored
 * otherwise) and, when that contact is on exactly one of the user's
 * matters, preselects it.
 */
export default async function NewEventPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requireCurrentUser();
  const params = await searchParams;
  const requestedMatterId = typeof params.matterId === "string" ? params.matterId : undefined;
  const date = typeof params.date === "string" ? params.date : undefined;
  const contactId = typeof params.contactId === "string" ? params.contactId : undefined;

  const [options, prefill] = await Promise.all([getCalendarFormOptions(user), resolveContactPrefill(user, contactId)]);
  // A matter the user can't access is indistinguishable from one that doesn't exist.
  if (requestedMatterId && !options.matters.some((m) => m.id === requestedMatterId)) notFound();

  const matterId = requestedMatterId ?? (prefill.matterIds.length === 1 ? prefill.matterIds[0] : undefined);
  const notice =
    prefill.contact && !requestedMatterId && prefill.matterIds.length > 1
      ? `${prefill.contact.displayName} is on ${prefill.matterIds.length} of your matters — choose the matter this meeting belongs to.`
      : undefined;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="page-title">
          {prefill.contact ? `Schedule meeting with ${prefill.contact.displayName}` : matterId ? "Schedule meeting" : "New event"}
        </h1>
        <p className="text-sm text-muted-foreground">Fictional/test data only — see CLAUDE.md and docs/SECURITY.md.</p>
      </div>
      <EventForm
        initial={newEventInitial({ matterId, date, contactId: prefill.contact?.id })}
        matters={options.matters}
        staff={options.staff}
        contacts={options.contacts}
        notice={notice}
        cancelHref={prefill.contact ? `/contacts/${prefill.contact.id}` : matterId ? `/matters/${matterId}/deadlines` : "/calendar"}
      />
    </div>
  );
}
