import Link from "next/link";
import { CalendarClock, FilePlus, PhoneCall, StickyNote, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Every quick action jumps to the tab that has the real form (see
 * components/shared/new-note-form.tsx, new-task-form.tsx,
 * new-deadline-form.tsx — the Deadlines tab also hosts Calendar Events —
 * upload-document-form.tsx, and log-call-form.tsx). "Log a Call" was the
 * last mocked action here (no write path existed before manual Call
 * logging was built) — now real, same pattern as the rest.
 */
export function QuickActions({ matterId }: { matterId: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" asChild>
        <Link href={`/matters/${matterId}/notes`}>
          <StickyNote className="h-4 w-4" />
          Add Note
        </Link>
      </Button>
      <Button variant="outline" size="sm" asChild>
        <Link href={`/matters/${matterId}/tasks`}>
          <FilePlus className="h-4 w-4" />
          New Task
        </Link>
      </Button>
      <Button variant="outline" size="sm" asChild>
        <Link href={`/matters/${matterId}/deadlines`}>
          <CalendarClock className="h-4 w-4" />
          New Deadline
        </Link>
      </Button>
      <Button variant="outline" size="sm" asChild>
        <Link href={`/matters/${matterId}/documents`}>
          <Upload className="h-4 w-4" />
          Upload Document
        </Link>
      </Button>
      <Button variant="outline" size="sm" asChild>
        <Link href={`/matters/${matterId}/calls`}>
          <PhoneCall className="h-4 w-4" />
          Log a Call
        </Link>
      </Button>
    </div>
  );
}
