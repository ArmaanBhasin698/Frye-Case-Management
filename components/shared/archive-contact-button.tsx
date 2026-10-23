"use client";

import * as React from "react";

import { archiveContact, reactivateContact } from "@/lib/contacts/actions";
import { Button } from "@/components/ui/button";

/** Archive/reactivate toggle for a Contact — same direct-call pattern as `ArchiveClientButton`. */
export function ArchiveContactButton({ contactId, archived }: { contactId: string; archived: boolean }) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function toggle() {
    setError(null);
    setPending(true);
    const result = archived ? await reactivateContact({ contactId }) : await archiveContact({ contactId });
    setPending(false);
    if (!result.ok) setError(result.error);
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="outline" size="sm" disabled={pending} onClick={toggle}>
        {pending ? "…" : archived ? "Reactivate Contact" : "Archive Contact"}
      </Button>
      {error && (
        <p className="max-w-xs text-right text-xs font-medium text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
