"use client";

import * as React from "react";
import { useActionState } from "react";

import { saveFolderSet, setFolderSetArchived, type FormActionState } from "@/lib/documents/folder-actions";
import { reindexPendingDocuments, saveDocumentTemplate, setDocumentTemplateStatus } from "@/lib/documents/template-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const INITIAL: FormActionState = { error: null };

function Saved({ state, pending }: { state: FormActionState; pending: boolean }) {
  if (pending) return null;
  return state.error ? (
    <p className="text-sm font-medium text-destructive" role="alert">
      {state.error}
    </p>
  ) : null;
}

export function FolderSetForm({ initial }: { initial?: { id: string; name: string; paths: string[] } }) {
  const [state, action, pending] = useActionState(saveFolderSet, INITIAL);
  return (
    <form action={action} className="space-y-3 rounded-lg border border-border bg-card p-4">
      {initial && <input type="hidden" name="setId" value={initial.id} />}
      <div className="space-y-1.5">
        <Label htmlFor={`fs-name-${initial?.id ?? "new"}`}>Folder set name</Label>
        <Input id={`fs-name-${initial?.id ?? "new"}`} name="name" required maxLength={150} defaultValue={initial?.name} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`fs-paths-${initial?.id ?? "new"}`}>Folders (one per line; use / for subfolders, up to 4 levels)</Label>
        <Textarea
          id={`fs-paths-${initial?.id ?? "new"}`}
          name="paths"
          rows={6}
          required
          defaultValue={initial?.paths.join("\n")}
          placeholder={"Pleadings\nDiscovery Notes\nDiscovery Notes/Body cam & video"}
        />
      </div>
      <Saved state={state} pending={pending} />
      <Button type="submit" size="sm" disabled={pending}>
        {initial ? "Save folder set" : "Create folder set"}
      </Button>
    </form>
  );
}

export function FolderSetArchiveButton({ setId, archived }: { setId: string; archived: boolean }) {
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          const result = await setFolderSetArchived({ setId, archived: !archived });
          setPending(false);
          setError(result.error);
        }}
      >
        {archived ? "Reactivate" : "Archive"}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}

export function DocumentTemplateForm({
  initial,
  fields,
}: {
  initial?: { id: string; name: string; category: string; body: string };
  fields: { token: string; label: string }[];
}) {
  const [state, action, pending] = useActionState(saveDocumentTemplate, INITIAL);
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);
  const insert = (token: string) => {
    const el = bodyRef.current;
    if (!el) return;
    const text = `{{${token}}}`;
    const start = el.selectionStart ?? el.value.length;
    el.setRangeText(text, start, el.selectionEnd ?? start, "end");
    el.focus();
  };
  return (
    <form action={action} className="space-y-3 rounded-lg border border-border bg-card p-4">
      {initial && <input type="hidden" name="templateId" value={initial.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`tpl-name-${initial?.id ?? "new"}`}>Template name</Label>
          <Input id={`tpl-name-${initial?.id ?? "new"}`} name="name" required maxLength={150} defaultValue={initial?.name} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`tpl-cat-${initial?.id ?? "new"}`}>Document category</Label>
          <Select id={`tpl-cat-${initial?.id ?? "new"}`} name="category" defaultValue={initial?.category ?? "CORRESPONDENCE"}>
            <option value="PLEADING">Pleading</option>
            <option value="CORRESPONDENCE">Correspondence</option>
            <option value="CONTRACT">Contract</option>
            <option value="OTHER">Other</option>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`tpl-body-${initial?.id ?? "new"}`}>Body (plain text; merge fields in {"{{double braces}}"})</Label>
        <Textarea ref={bodyRef} id={`tpl-body-${initial?.id ?? "new"}`} name="body" rows={10} required defaultValue={initial?.body} />
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">Insert a merge field</summary>
        <div className="mt-2 flex max-h-40 flex-wrap gap-1 overflow-y-auto">
          {fields.map((f) => (
            <Button key={f.token} type="button" variant="outline" size="sm" onClick={() => insert(f.token)} title={f.token}>
              {f.label}
            </Button>
          ))}
        </div>
      </details>
      <p className="text-xs text-muted-foreground">
        Saving a changed body creates a new version; documents already generated keep the version they were made from.
      </p>
      <Saved state={state} pending={pending} />
      <Button type="submit" size="sm" disabled={pending}>
        {initial ? "Save new version" : "Create template"}
      </Button>
    </form>
  );
}

export function TemplateStatusButton({ templateId, archived }: { templateId: string; archived: boolean }) {
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          const result = await setDocumentTemplateStatus({ templateId, archived: !archived });
          setPending(false);
          setError(result.error);
        }}
      >
        {archived ? "Reactivate" : "Archive"}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}

export function ReindexButton() {
  const [message, setMessage] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          const result = await reindexPendingDocuments();
          setPending(false);
          setMessage(result.error ?? `Processed ${result.processed ?? 0} document version(s).`);
        }}
      >
        {pending ? "Indexing…" : "Index pending / failed documents (up to 50)"}
      </Button>
      {message && <span className="text-xs text-muted-foreground">{message}</span>}
    </span>
  );
}
