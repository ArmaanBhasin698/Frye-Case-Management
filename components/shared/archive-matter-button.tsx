"use client";

import * as React from "react";

import { archiveMatter, reactivateMatter } from "@/lib/matters/actions";
import { Button } from "@/components/ui/button";

/**
 * Archive/reactivate toggle for a Matter's own visibility (see
 * Matter.archived in prisma/schema.prisma) — same "call the Server Action
 * directly, track pending/error locally" pattern as
 * `components/shared/deadline-list.tsx`'s "Mark complete" toggle, not a
 * `<form>`/`useActionState` flow, since there's only one boolean to flip.
 * `archiveMatter`/`reactivateMatter` (lib/matters/actions.ts) independently
 * re-check `canEditMatter` server-side — this component's visibility is a
 * convenience only, same as the "Edit Matter" button beside it.
 */
export function ArchiveMatterButton({ matterId, archived }: { matterId: string; archived: boolean }) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function toggle() {
    setError(null);
    setPending(true);
    const result = archived ? await reactivateMatter({ matterId }) : await archiveMatter({ matterId });
    setPending(false);
    if (!result.ok) setError(result.error);
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button variant="outline" size="sm" disabled={pending} onClick={toggle}>
        {pending ? "…" : archived ? "Reactivate Matter" : "Archive Matter"}
      </Button>
      {error && (
        <p className="text-xs font-medium text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
