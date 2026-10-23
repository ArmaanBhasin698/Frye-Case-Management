import Link from "next/link";
import { CalendarPlus } from "lucide-react";

import { scheduleWithContactHref } from "@/lib/calendar/prefill";
import { Button } from "@/components/ui/button";

/**
 * "Schedule meeting" for a contact. Only a link: the new-event page
 * re-checks that the contact (and any matter) is visible before
 * prefilling, and the create action re-validates both again.
 */
export function ScheduleWithContactLink({
  contactId,
  matterId,
  compact = false,
}: {
  contactId: string;
  matterId?: string;
  compact?: boolean;
}) {
  return (
    <Button variant={compact ? "ghost" : "outline"} size="sm" asChild>
      <Link href={scheduleWithContactHref(contactId, matterId)}>
        <CalendarPlus className="mr-1.5 h-3.5 w-3.5" />
        {compact ? "Schedule" : "Schedule meeting"}
      </Link>
    </Button>
  );
}
