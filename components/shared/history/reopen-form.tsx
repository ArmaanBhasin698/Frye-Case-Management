"use client";

import * as React from "react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { reopenMatter, type FormActionState } from "@/lib/history/actions";

const INITIAL: FormActionState = { error: null };

/** Explicit, audited reopening of a closed matter; closure reports stay as history. */
export function ReopenMatterForm({ matterId }: { matterId: string }) {
  const [state, formAction, isPending] = useActionState(reopenMatter, INITIAL);
  const [open, setOpen] = React.useState(false);
  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Reopen matter
      </Button>
    );
  }
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="matterId" value={matterId} />
      <Input name="reason" required placeholder="Reason for reopening" className="w-72" />
      <Button type="submit" size="sm" disabled={isPending}>
        Reopen
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      {state.error && <span className="text-sm text-destructive">{state.error}</span>}
    </form>
  );
}
