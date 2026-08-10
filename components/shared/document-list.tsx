"use client";

import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { Download } from "lucide-react";
import type { DocumentCategory } from "@prisma/client";

import { documentCategoryLabel, formatFileSize } from "@/lib/matters/format";
import { updateDocumentMetadata, type FormActionState } from "@/lib/documents/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type DocumentSummary = {
  id: string;
  title: string;
  category: DocumentCategory;
  originalFilename: string | null;
  sizeBytes: number | null;
  uploadedAt: Date;
  uploadedBy: { name: string };
  notes: string | null;
  /** Whether `storageKey` actually resolves to stored bytes — false for illustrative pre-tenth-session seed rows. */
  hasStoredFile: boolean;
};

const INITIAL_STATE: FormActionState = { error: null };

function DocumentEditForm({
  matterId,
  document,
  onDone,
}: {
  matterId: string;
  document: DocumentSummary;
  onDone: () => void;
}) {
  const [state, formAction, isPending] = useActionState(updateDocumentMetadata, INITIAL_STATE);

  // Call onDone from an effect, not during render — the state transition
  // means the update already committed, and this component's parent owns
  // `editing`, so we can't update it synchronously while this component
  // is still rendering.
  React.useEffect(() => {
    if (state !== INITIAL_STATE && !state.error) {
      onDone();
    }
  }, [state, onDone]);

  return (
    <form action={formAction} className="space-y-3 p-4">
      <input type="hidden" name="matterId" value={matterId} />
      <input type="hidden" name="documentId" value={document.id} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`document-title-${document.id}`}>Title</Label>
          <Input id={`document-title-${document.id}`} name="title" required defaultValue={document.title} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`document-category-${document.id}`}>Category</Label>
          <Select id={`document-category-${document.id}`} name="category" defaultValue={document.category}>
            <option value="PLEADING">Pleading</option>
            <option value="CORRESPONDENCE">Correspondence</option>
            <option value="CONTRACT">Contract</option>
            <option value="OTHER">Other</option>
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`document-notes-${document.id}`}>Notes</Label>
          <Textarea id={`document-notes-${document.id}`} name="notes" rows={2} defaultValue={document.notes ?? ""} />
        </div>
      </div>

      {state.error && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {state.error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function DocumentRow({ matterId, document }: { matterId: string; document: DocumentSummary }) {
  const [editing, setEditing] = React.useState(false);

  return (
    <>
      <TableRow>
        <TableCell className="font-medium">{document.title}</TableCell>
        <TableCell>
          <Badge variant="outline">{documentCategoryLabel(document.category)}</Badge>
        </TableCell>
        <TableCell className="max-w-xs truncate text-xs text-muted-foreground">
          {document.originalFilename ?? "—"}
        </TableCell>
        <TableCell className="text-sm text-muted-foreground">
          {document.sizeBytes !== null ? formatFileSize(document.sizeBytes) : "—"}
        </TableCell>
        <TableCell className="text-sm text-muted-foreground">{document.uploadedBy.name}</TableCell>
        <TableCell className="text-sm text-muted-foreground">
          {format(document.uploadedAt, "MMM d, yyyy")}
        </TableCell>
        <TableCell>
          <div className="flex justify-end gap-2">
            {document.hasStoredFile ? (
              <Button variant="ghost" size="sm" asChild>
                <Link href={`/matters/${matterId}/documents/files/${document.id}`}>
                  <Download className="h-4 w-4" />
                  Download
                </Link>
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground">No file stored</span>
            )}
            <Button variant="ghost" size="sm" onClick={() => setEditing((v) => !v)}>
              {editing ? "Close" : "Edit"}
            </Button>
          </div>
        </TableCell>
      </TableRow>
      {editing && (
        <TableRow>
          <TableCell colSpan={7} className="bg-muted/30 p-0">
            <DocumentEditForm matterId={matterId} document={document} onDone={() => setEditing(false)} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

export function DocumentList({ matterId, documents }: { matterId: string; documents: DocumentSummary[] }) {
  if (documents.length === 0) {
    return <p className="p-6 text-sm text-muted-foreground">No documents on file yet.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Title</TableHead>
          <TableHead>Category</TableHead>
          <TableHead>Original filename</TableHead>
          <TableHead>Size</TableHead>
          <TableHead>Uploaded by</TableHead>
          <TableHead>Uploaded</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {documents.map((document) => (
          <DocumentRow key={document.id} matterId={matterId} document={document} />
        ))}
      </TableBody>
    </Table>
  );
}
