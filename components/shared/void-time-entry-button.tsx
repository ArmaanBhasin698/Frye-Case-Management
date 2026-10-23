"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { voidTimeEntry } from "@/lib/time/actions";

/** Voids (never deletes) a time entry after asking for a reason. */
export function VoidTimeEntryButton({ entryId }: { entryId: string }) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onClick() {
    const reason = window.prompt("Why is this entry being voided? (kept in the record)");
    if (!reason) return;
    setPending(true);
    setError(null);
    const result = await voidTimeEntry({ entryId, reason });
    setPending(false);
    if (!result.ok) setError(result.error);
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="ghost" disabled={pending} onClick={onClick}>
        Void
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}
