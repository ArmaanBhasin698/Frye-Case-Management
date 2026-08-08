import { format } from "date-fns";
import { Pin } from "lucide-react";

import { getMatterNotes } from "@/lib/matters/queries";
import { Card, CardContent } from "@/components/ui/card";
import { NewNoteForm } from "@/components/shared/new-note-form";

export default async function MatterNotesPage({
  params,
}: {
  params: Promise<{ matterId: string }>;
}) {
  const { matterId } = await params;
  const notes = await getMatterNotes(matterId);

  return (
    <div className="space-y-4">
      <NewNoteForm matterId={matterId} />

      {notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No notes on this matter yet.</p>
      ) : (
        <div className="space-y-3">
          {notes.map((note) => (
            <Card key={note.id}>
              <CardContent className="p-4">
                <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    {note.pinned && <Pin className="h-3 w-3" />}
                    {note.author.name}
                  </span>
                  <span>{format(note.createdAt, "MMM d, yyyy 'at' h:mm a")}</span>
                </div>
                <p className="whitespace-pre-wrap text-sm text-foreground">{note.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
