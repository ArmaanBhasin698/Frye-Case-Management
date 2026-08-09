"use client";

import * as React from "react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { uploadDocument, type FormActionState } from "@/lib/documents/actions";

const INITIAL_STATE: FormActionState = { error: null };

export function UploadDocumentForm({ matterId }: { matterId: string }) {
  const [state, formAction, isPending] = useActionState(uploadDocument, INITIAL_STATE);
  const formRef = React.useRef<HTMLFormElement>(null);
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
        Upload Document
      </Button>
    );
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      encType="multipart/form-data"
      className="space-y-3 rounded-lg border border-border bg-card p-4"
    >
      <input type="hidden" name="matterId" value={matterId} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="document-file">File</Label>
          <Input id="document-file" name="file" type="file" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="document-title">Title</Label>
          <Input id="document-title" name="title" required placeholder="e.g. Entry of Appearance" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="document-category">Category</Label>
          <Select id="document-category" name="category" defaultValue="OTHER">
            <option value="PLEADING">Pleading</option>
            <option value="CORRESPONDENCE">Correspondence</option>
            <option value="CONTRACT">Contract</option>
            <option value="OTHER">Other</option>
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="document-notes">Notes</Label>
          <Textarea id="document-notes" name="notes" rows={2} placeholder="Optional" />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Fictional/test files only. Accepts PDF, Word, Excel, text, and image files (25MB max).
      </p>

      {state.error && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {state.error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Uploading…" : "Upload"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
