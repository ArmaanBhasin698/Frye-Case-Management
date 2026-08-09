"use client";

import * as React from "react";
import { useActionState } from "react";
import { format } from "date-fns";
import { Pin } from "lucide-react";

import { updateNote, type FormActionState } from "@/lib/matters/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

export type NoteSummary = {
  id: string;
  body: string;
  pinned: boolean;
  createdAt: Date;
  author: { name: string };
};

const INITIAL_STATE: FormActionState = { error: null };

function NoteEditForm({
  matterId,
  note,
  onDone,
}: {
  matterId: string;
  note: NoteSummary;
  onDone: () => void;
}) {
  const [state, formAction, isPending] = useActionState(updateNote, INITIAL_STATE);
  const [prevState, setPrevState] = React.useState(state);

  if (state !== prevState) {
    setPrevState(state);
    if (!state.error) onDone();
  }

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="matterId" value={matterId} />
      <input type="hidden" name="noteId" value={note.id} />

      <Textarea name="body" required defaultValue={note.body} rows={4} />

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" name="pinned" defaultChecked={note.pinned} className="h-3.5 w-3.5" />
        Pinned
      </label>

      {state.error && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {state.error}
        </p>
      )}

      <div className="flex justify-end gap-2">
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

function NoteCard({ matterId, note }: { matterId: string; note: NoteSummary }) {
  const [editing, setEditing] = React.useState(false);

  if (editing) {
    return (
      <Card>
        <CardContent className="p-4">
          <NoteEditForm matterId={matterId} note={note} onDone={() => setEditing(false)} />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            {note.pinned && <Pin className="h-3 w-3" />}
            {note.author.name}
          </span>
          <span>{format(note.createdAt, "MMM d, yyyy 'at' h:mm a")}</span>
        </div>
        <p className="whitespace-pre-wrap text-sm text-foreground">{note.body}</p>
        <div className="mt-2 flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function NoteList({ matterId, notes }: { matterId: string; notes: NoteSummary[] }) {
  if (notes.length === 0) {
    return <p className="text-sm text-muted-foreground">No notes on this matter yet.</p>;
  }

  return (
    <div className="space-y-3">
      {notes.map((note) => (
        <NoteCard key={note.id} matterId={matterId} note={note} />
      ))}
    </div>
  );
}
