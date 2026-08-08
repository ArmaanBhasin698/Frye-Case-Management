"use client";

import * as React from "react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { createNote } from "@/lib/matters/actions";

export function NewNoteForm({ matterId }: { matterId: string }) {
  const [state, formAction, isPending] = useActionState(createNote, { error: null });
  const formRef = React.useRef<HTMLFormElement>(null);

  React.useEffect(() => {
    if (!state.error) {
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-2 rounded-lg border border-border bg-card p-4">
      <input type="hidden" name="matterId" value={matterId} />
      <Textarea name="body" required placeholder="Add a note about this matter…" rows={3} />

      {state.error && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {state.error}
        </p>
      )}

      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Saving…" : "Add Note"}
        </Button>
      </div>
    </form>
  );
}
