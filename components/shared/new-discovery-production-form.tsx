"use client";

import * as React from "react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createDiscoveryProduction } from "@/lib/discovery/actions";

export function NewDiscoveryProductionForm({ matterId }: { matterId: string }) {
  const [state, formAction, isPending] = useActionState(createDiscoveryProduction, { error: null });
  const [open, setOpen] = React.useState(false);
  const [prevState, setPrevState] = React.useState(state);

  if (state !== prevState) {
    setPrevState(state);
    if (!state.error) {
      setOpen(false);
    }
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        New Production
      </Button>
    );
  }

  return (
    <form action={formAction} className="space-y-3 rounded-lg border border-border bg-card p-4">
      <input type="hidden" name="matterId" value={matterId} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="production-label">Label</Label>
          <Input id="production-label" name="label" required placeholder="e.g. Supplemental Production 2" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="production-source">Source</Label>
          <Input id="production-source" name="source" placeholder="e.g. County Sheriff's Office (fictional)" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="production-receivedDate">Received date</Label>
          <Input id="production-receivedDate" name="receivedDate" type="date" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="production-batesPrefix">Bates/evidence prefix</Label>
          <Input id="production-batesPrefix" name="batesPrefix" placeholder="e.g. ELLIS" maxLength={12} />
        </div>
      </div>

      {state.error && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {state.error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Creating…" : "Create Production"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
