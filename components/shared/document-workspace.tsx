"use client";

import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import type { DocumentIndexStatus } from "@prisma/client";

import { formatFileSize } from "@/lib/matters/format";
import {
  applyFolderSet,
  createFolder,
  moveDocument,
  moveFolder,
  renameFolder,
  setDocumentTags,
  type FormActionState,
} from "@/lib/documents/folder-actions";
import { uploadDocumentVersion } from "@/lib/documents/version-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

const INITIAL: FormActionState = { error: null };

export type FolderOption = { id: string; path: string; depth: number };

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p className="text-xs font-medium text-destructive" role="alert">
      {error}
    </p>
  ) : null;
}

function FolderSelect({ name, folders, defaultValue, rootLabel }: { name: string; folders: FolderOption[]; defaultValue?: string; rootLabel: string }) {
  return (
    <Select name={name} defaultValue={defaultValue ?? ""} aria-label="Folder">
      <option value="">{rootLabel}</option>
      {folders.map((f) => (
        <option key={f.id} value={f.id}>
          {`${"  ".repeat(f.depth)}${f.path.split("/").pop()}`}
        </option>
      ))}
    </Select>
  );
}

export function NewFolderForm({ matterId, folders }: { matterId: string; folders: FolderOption[] }) {
  const [state, action, pending] = useActionState(createFolder, INITIAL);
  return (
    <form action={action} className="space-y-1.5">
      <input type="hidden" name="matterId" value={matterId} />
      <Label className="text-xs">New folder</Label>
      <Input name="name" placeholder="Folder name" required maxLength={100} />
      <FolderSelect name="parentId" folders={folders} rootLabel="At top level" />
      <Button type="submit" size="sm" variant="outline" disabled={pending} className="w-full">
        Create folder
      </Button>
      <ErrorLine error={state.error} />
    </form>
  );
}

export function ManageFolderForm({ matterId, folders }: { matterId: string; folders: FolderOption[] }) {
  const [renameState, renameAction, renaming] = useActionState(renameFolder, INITIAL);
  const [moveState, moveAction, moving] = useActionState(moveFolder, INITIAL);
  const [folderId, setFolderId] = React.useState(folders[0]?.id ?? "");
  if (folders.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">Manage folder</Label>
      <Select value={folderId} onChange={(e) => setFolderId(e.target.value)} aria-label="Folder to manage">
        {folders.map((f) => (
          <option key={f.id} value={f.id}>
            {f.path}
          </option>
        ))}
      </Select>
      <form action={renameAction} className="flex gap-1">
        <input type="hidden" name="matterId" value={matterId} />
        <input type="hidden" name="folderId" value={folderId} />
        <Input name="name" placeholder="New name" required maxLength={100} />
        <Button type="submit" size="sm" variant="outline" disabled={renaming}>
          Rename
        </Button>
      </form>
      <ErrorLine error={renameState.error} />
      <form action={moveAction} className="flex gap-1">
        <input type="hidden" name="matterId" value={matterId} />
        <input type="hidden" name="folderId" value={folderId} />
        <FolderSelect name="parentId" folders={folders.filter((f) => f.id !== folderId)} rootLabel="Move to top level" />
        <Button type="submit" size="sm" variant="outline" disabled={moving}>
          Move
        </Button>
      </form>
      <ErrorLine error={moveState.error} />
    </div>
  );
}

export function ApplyFolderSetForm({ matterId, sets }: { matterId: string; sets: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(applyFolderSet, INITIAL);
  if (sets.length === 0) return null;
  return (
    <form action={action} className="space-y-1.5">
      <input type="hidden" name="matterId" value={matterId} />
      <Label className="text-xs">Apply folder set</Label>
      <Select name="setId" required defaultValue={sets[0]?.id}>
        {sets.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </Select>
      <Button type="submit" size="sm" variant="outline" disabled={pending} className="w-full">
        Apply (creates only missing folders)
      </Button>
      <ErrorLine error={state.error} />
    </form>
  );
}

const INDEX_LABEL: Record<DocumentIndexStatus, string> = {
  PENDING: "Index pending",
  INDEXED: "Indexed for search",
  UNSUPPORTED: "Not searchable (format)",
  FAILED: "Indexing failed",
};

export type VersionSummary = {
  id: string;
  version: number;
  originalFilename: string | null;
  sizeBytes: number | null;
  contentHash: string | null;
  createdAt: Date;
  uploadedBy: string | null;
  indexStatus: DocumentIndexStatus | null;
};

function UploadVersionForm({ matterId, documentId }: { matterId: string; documentId: string }) {
  const [state, action, pending] = useActionState(uploadDocumentVersion, INITIAL);
  return (
    <form action={action} encType="multipart/form-data" className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="matterId" value={matterId} />
      <input type="hidden" name="documentId" value={documentId} />
      <Input type="file" name="file" required className="max-w-xs" aria-label="New version file" />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Uploading…" : "Upload new version"}
      </Button>
      <ErrorLine error={state.error} />
    </form>
  );
}

export function DocumentVersionsPanel({
  matterId,
  documentId,
  versions,
  currentVersionId,
}: {
  matterId: string;
  documentId: string;
  versions: VersionSummary[];
  currentVersionId: string | null;
}) {
  return (
    <div className="space-y-3 p-4">
      <p className="text-sm font-medium">Version history</p>
      {versions.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Uploaded before versioning — the current file is treated as version 1 and is recorded when a new version is uploaded.
        </p>
      ) : (
        <ul className="space-y-1 text-sm">
          {versions.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-2">
              <Badge variant={v.id === currentVersionId ? "default" : "outline"}>v{v.version}</Badge>
              <span className="text-muted-foreground">
                {v.originalFilename ?? "—"} · {v.sizeBytes !== null ? formatFileSize(v.sizeBytes) : "—"} ·{" "}
                {format(v.createdAt, "MMM d, yyyy h:mm a")} · {v.uploadedBy ?? "former staff"}
                {v.contentHash ? ` · SHA-256 ${v.contentHash.slice(0, 12)}…` : ""}
              </span>
              <Badge variant={v.indexStatus === "INDEXED" ? "success" : v.indexStatus === "FAILED" ? "destructive" : "secondary"}>
                {v.indexStatus ? INDEX_LABEL[v.indexStatus] : INDEX_LABEL.PENDING}
              </Badge>
              <Link
                href={`/matters/${matterId}/documents/files/${documentId}/versions/${v.id}`}
                className="text-xs text-primary hover:underline"
              >
                Download v{v.version}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <UploadVersionForm matterId={matterId} documentId={documentId} />
    </div>
  );
}

export function DocumentOrganizePanel({
  matterId,
  documentId,
  folders,
  folderId,
  tags,
}: {
  matterId: string;
  documentId: string;
  folders: FolderOption[];
  folderId: string | null;
  tags: string[];
}) {
  const [moveState, moveAction, moving] = useActionState(moveDocument, INITIAL);
  const [tagState, tagAction, tagging] = useActionState(setDocumentTags, INITIAL);
  return (
    <div className="grid gap-4 p-4 sm:grid-cols-2">
      <form action={moveAction} className="space-y-1.5">
        <input type="hidden" name="matterId" value={matterId} />
        <input type="hidden" name="documentId" value={documentId} />
        <Label className="text-xs">Folder</Label>
        <div className="flex gap-1">
          <FolderSelect name="folderId" folders={folders} defaultValue={folderId ?? ""} rootLabel="Unfiled" />
          <Button type="submit" size="sm" variant="outline" disabled={moving}>
            Move
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Moving changes organization only — not the file or who can see it.</p>
        <ErrorLine error={moveState.error} />
      </form>
      <form action={tagAction} className="space-y-1.5">
        <input type="hidden" name="matterId" value={matterId} />
        <input type="hidden" name="documentId" value={documentId} />
        <Label className="text-xs">Tags (comma-separated)</Label>
        <div className="flex gap-1">
          <Input name="tags" defaultValue={tags.join(", ")} placeholder="exhibit, motion" />
          <Button type="submit" size="sm" variant="outline" disabled={tagging}>
            Save
          </Button>
        </div>
        <ErrorLine error={tagState.error} />
      </form>
    </div>
  );
}
