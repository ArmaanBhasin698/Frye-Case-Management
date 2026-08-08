"use client";

import * as React from "react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { runDiscoveryComparison } from "@/lib/discovery/actions";

export function RunComparisonForm({
  matterId,
  productions,
}: {
  matterId: string;
  productions: { id: string; label: string }[];
}) {
  const [state, formAction, isPending] = useActionState(runDiscoveryComparison, { error: null });

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="matterId" value={matterId} />

      <div className="space-y-1.5">
        <Label htmlFor="compare-from">From</Label>
        <Select id="compare-from" name="fromProductionId" defaultValue={productions[0]?.id} className="w-56">
          {productions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="compare-to">To</Label>
        <Select id="compare-to" name="toProductionId" defaultValue={productions[1]?.id} className="w-56">
          {productions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>
      </div>

      <Button type="submit" size="sm" disabled={isPending}>
        {isPending ? "Comparing…" : "Compare"}
      </Button>

      {state.error && (
        <p className="w-full text-sm font-medium text-destructive" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
