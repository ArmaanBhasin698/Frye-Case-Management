"use client";

import * as React from "react";
import { FilePlus, PhoneCall, StickyNote, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";

const ACTIONS = [
  { key: "note", label: "Add Note", icon: StickyNote },
  { key: "call", label: "Log a Call", icon: PhoneCall },
  { key: "document", label: "Upload Document", icon: Upload },
  { key: "task", label: "New Task", icon: FilePlus },
] as const;

/**
 * Prototype-only quick actions. There are no create/edit forms in this
 * milestone (see docs/ROADMAP.md) — clicking shows what the entry point
 * will feel like without persisting anything, so this resets on refresh.
 */
export function QuickActions() {
  const [message, setMessage] = React.useState<string | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {ACTIONS.map((action) => {
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
