import { getMatterNotes } from "@/lib/matters/queries";
import { NewNoteForm } from "@/components/shared/new-note-form";
import { NoteList } from "@/components/shared/note-list";

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
      <NoteList matterId={matterId} notes={notes} />
    </div>
  );
}
