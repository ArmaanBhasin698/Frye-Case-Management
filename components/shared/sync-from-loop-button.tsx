"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { triggerHighLevelSync, type TriggerHighLevelSyncResult } from "@/lib/intake/reviewActions";

/** Never contact PII — counts only, matching lib/intake/highlevelSync.ts's own safe-summary restraint. */
function summarize(response: TriggerHighLevelSyncResult): { message: string; isError: boolean } {
  if (!response.ok) {
    return { message: response.error, isError: true };
  }
  if (response.result.outcome === "already_running") {
    return { message: "A sync is already running — try again shortly.", isError: false };
  }
  const r = response.result;
  return {
    message: `${r.contactsChecked} contact${r.contactsChecked === 1 ? "" : "s"} checked · ${r.newLeadsCreated} new · ${r.pendingLeadsUpdated} updated · ${r.linkedOrSkipped} linked/skipped · ${r.failureCount} failure${r.failureCount === 1 ? "" : "s"}`,
    isError: r.failureCount > 0,
  };
}

/**
 * Manual "Sync from Loop" — calls `triggerHighLevelSync`
 * (lib/intake/reviewActions.ts), which re-checks authorization server-side
 * and runs the exact same service the scheduled cron entry point uses.
 * `pending` blocks a second click while one call is in flight; the
 * server-side lock in lib/intake/highlevelSync.ts is still the real
 * protection against an overlapping run (e.g. a concurrent scheduled tick).
 */
export function SyncFromLoopButton() {
  const [pending, setPending] = React.useState(false);
  const [result, setResult] = React.useState<{ message: string; isError: boolean } | null>(null);

  async function handleClick() {
    if (pending) return;
    setPending(true);
    setResult(null);
    const response = await triggerHighLevelSync();
    setPending(false);
    setResult(summarize(response));
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="outline" size="sm" disabled={pending} onClick={handleClick}>
        {pending ? "Syncing…" : "Sync from Loop"}
      </Button>
      {result && (
        <p
          className={`max-w-xs text-right text-xs ${result.isError ? "font-medium text-destructive" : "text-muted-foreground"}`}
          role={result.isError ? "alert" : undefined}
        >
          {result.message}
        </p>
      )}
    </div>
  );
}
