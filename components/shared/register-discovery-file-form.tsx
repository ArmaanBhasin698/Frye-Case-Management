"use client";

import * as React from "react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { registerDiscoveryFile } from "@/lib/discovery/actions";

export function RegisterDiscoveryFileForm({
  matterId,
  productionId,
}: {
  matterId: string;
  productionId: string;
}) {
  const [state, formAction, isPending] = useActionState(registerDiscoveryFile, { error: null });
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
        Register File
      </Button>
    );
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      encType="multipart/form-data"
      className="space-y-3 rounded-lg border border-border bg-muted/30 p-4"
    >
      <input type="hidden" name="matterId" value={matterId} />
      <input type="hidden" name="productionId" value={productionId} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`file-${productionId}`}>File</Label>
          <Input id={`file-${productionId}`} name="file" type="file" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`fileType-${productionId}`}>Type</Label>
          <Select id={`fileType-${productionId}`} name="fileType" defaultValue="PDF">
            <option value="PDF">PDF</option>
            <option value="VIDEO">Video</option>
            <option value="AUDIO">Audio</option>
            <option value="PHOTO">Photo</option>
            <option value="OTHER">Other</option>
          </Select>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Fictional/test files only. PDFs are paginated and Bates-stamped automatically; other types
        get a sequential evidence ID instead of page numbers.
      </p>

      {state.error && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {state.error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Registering…" : "Register"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
