"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { purgeUsageData, type PurgeState } from "@/lib/usage/actions";

const INITIAL: PurgeState = { error: null, message: null };

export function PurgeUsageForm({ confirmPhrase, disabled }: { confirmPhrase: string; disabled: boolean }) {
  const [state, formAction, isPending] = useActionState(purgeUsageData, INITIAL);
  return (
    <form action={formAction} className="space-y-2">
      <Label htmlFor="purge-confirm" className="text-xs">
        Type <span className="font-mono">{confirmPhrase}</span> to confirm
      </Label>
      <div className="flex flex-wrap gap-2">
        <Input id="purge-confirm" name="confirm" className="w-64" autoComplete="off" disabled={disabled} />
        <Button type="submit" variant="outline" size="sm" disabled={disabled || isPending}>
          {isPending ? "Purging…" : "Purge expired usage data"}
        </Button>
      </div>
      {state.error && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {state.error}
        </p>
      )}
      {state.message && <p className="text-sm text-muted-foreground">{state.message}</p>}
    </form>
  );
}
