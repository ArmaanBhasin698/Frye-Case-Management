"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteReport, renameReport, saveReport, type FormActionState } from "@/lib/reports/saved-actions";

const INITIAL: FormActionState = { error: null };

/** Saves the current (already validated) filters as a named report. */
export function SaveReportForm({ kind, filters }: { kind: string; filters: Record<string, string> }) {
  const [state, action, pending] = useActionState(saveReport, INITIAL);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="kind" value={kind} />
      {Object.entries(filters).map(([k, v]) => (
        <input key={k} type="hidden" name={`f_${k}`} value={v} />
      ))}
      <Input name="name" required maxLength={120} placeholder="Report name" className="w-56" aria-label="Report name" />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        Save report
      </Button>
      {state.error && <span className="text-sm text-destructive">{state.error}</span>}
    </form>
  );
}

export function RenameReportForm({ reportId, name }: { reportId: string; name: string }) {
  const [state, action, pending] = useActionState(renameReport, INITIAL);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="reportId" value={reportId} />
      <Input name="name" required maxLength={120} defaultValue={name} className="w-56" aria-label="Report name" />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        Rename
      </Button>
      {state.error && <span className="text-sm text-destructive">{state.error}</span>}
    </form>
  );
}

export function DeleteReportForm({ reportId }: { reportId: string }) {
  const [state, action, pending] = useActionState(deleteReport, INITIAL);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm("Delete this saved report? Only the saved filters are removed.")) e.preventDefault();
      }}
    >
      <input type="hidden" name="reportId" value={reportId} />
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>
        Delete
      </Button>
      {state.error && <span className="text-sm text-destructive">{state.error}</span>}
    </form>
  );
}
