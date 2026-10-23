"use client";

import { useActionState } from "react";

import { generateDocumentFromTemplate, type FormActionState } from "@/lib/documents/template-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

const INITIAL: FormActionState = { error: null };

/**
 * Confirms generation of the exact template version that was previewed.
 * The "leave blank" and "replace unsupported characters" confirmations are
 * only offered when the preview found something to confirm; the server
 * re-checks both regardless.
 */
export function GenerateDocumentForm({
  matterId,
  templateVersionId,
  defaultTitle,
  folders,
  hasMissing,
  unsupported,
}: {
  matterId: string;
  templateVersionId: string;
  defaultTitle: string;
  folders: { id: string; path: string }[];
  hasMissing: boolean;
  unsupported: string[];
}) {
  const [state, action, pending] = useActionState(generateDocumentFromTemplate, INITIAL);
  return (
    <form action={action} className="space-y-3 rounded-lg border border-border bg-card p-4">
      <input type="hidden" name="matterId" value={matterId} />
      <input type="hidden" name="templateVersionId" value={templateVersionId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="gen-title">Document title</Label>
          <Input id="gen-title" name="title" required maxLength={200} defaultValue={defaultTitle} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="gen-folder">Save to folder</Label>
          <Select id="gen-folder" name="folderId" defaultValue="">
            <option value="">Unfiled</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.path}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {hasMissing && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="leaveBlank" className="mt-1" />
          Leave the missing fields listed above blank in the generated document.
        </label>
      )}
      {unsupported.length > 0 && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="replaceUnsupported" className="mt-1" />
          Replace the characters the PDF font can&apos;t print ({unsupported.join(" ")}) with &quot;?&quot;.
        </label>
      )}
      {state.error && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {state.error}
        </p>
      )}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Generating…" : "Generate PDF and save to matter"}
      </Button>
    </form>
  );
}
