"use client";

import * as React from "react";

import { archiveClient, reactivateClient } from "@/lib/clients/actions";
import { Button } from "@/components/ui/button";

/**
 * Archive/reactivate toggle for a Client's own visibility (see
 * Client.archived in prisma/schema.prisma) — same direct-call pattern as
 * `ArchiveMatterButton`. `archiveClient`/`reactivateClient`
 * (lib/clients/actions.ts) independently re-check
 * `canManageClientsAndMatters` server-side and, for archival, that the
 * Client has no remaining OPEN/PENDING Matter — this component just
 * surfaces whatever error that validation returns (e.g. "Cannot archive:
 * this client has 2 active matters...").
 */
export function ArchiveClientButton({ clientId, archived }: { clientId: string; archived: boolean }) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function toggle() {
    setError(null);
    setPending(true);
    const result = archived ? await reactivateClient({ clientId }) : await archiveClient({ clientId });
    setPending(false);
    if (!result.ok) setError(result.error);
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="outline" size="sm" disabled={pending} onClick={toggle}>
        {pending ? "…" : archived ? "Reactivate Client" : "Archive Client"}
      </Button>
      {error && (
        <p className="max-w-xs text-right text-xs font-medium text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
