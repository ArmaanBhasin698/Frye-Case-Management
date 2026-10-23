"use client";

import * as React from "react";

import { cancelEvent } from "@/lib/calendar/actions";
import { Button } from "@/components/ui/button";

export function CancelEventButton({ eventId, recurring }: { eventId: string; recurring: boolean }) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function cancel() {
    const message = recurring
      ? "Cancel every occurrence of this repeating event? It stays in history as cancelled."
      : "Cancel this event? It stays in history as cancelled.";
    if (!window.confirm(message)) return;
    setError(null);
    setPending(true);
    const result = await cancelEvent({ eventId });
    setPending(false);
    if (!result.ok) setError(result.error);
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button variant="outline" size="sm" disabled={pending} onClick={cancel}>
        {pending ? "…" : "Cancel event"}
      </Button>
      {error && (
        <span className="text-xs font-medium text-destructive" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
