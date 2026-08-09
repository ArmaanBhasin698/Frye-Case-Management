"use client";

import * as React from "react";
import Link from "next/link";
import { CalendarClock, FilePlus, PhoneCall, StickyNote, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";

const MOCKED_ACTIONS = [{ key: "call", label: "Log a Call", icon: PhoneCall }] as const;

/**
 * "Add Note", "New Task", "New Deadline", and "Upload Document" jump to
 * the tab that has the real form (see components/shared/new-note-form.tsx,
 * new-task-form.tsx, new-deadline-form.tsx — the Deadlines tab also hosts
 * Calendar Events — and upload-document-form.tsx). Logging a brand-new
 * call still has no write path (no Vonage integration, see
 * docs/ROADMAP.md) — that one remains prototype-only.
 */
export function QuickActions({ matterId }: { matterId: string }) {
  const [message, setMessage] = React.useState<string | null>(null);

  return (
    <div className="space-y-3">
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
        {MOCKED_ACTIONS.map((action) => {
          const Icon = action.icon;
          return (
            <Button
              key={action.key}
              variant="outline"
              size="sm"
              onClick={() => setMessage(action.label)}
            >
              <Icon className="h-4 w-4" />
              {action.label}
            </Button>
          );
        })}
      </div>
      {message && (
        <p className="rounded-md border border-dashed border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          &ldquo;{message}&rdquo; will open a form here in a future release — this prototype is
          read-only.
        </p>
      )}
    </div>
  );
}
