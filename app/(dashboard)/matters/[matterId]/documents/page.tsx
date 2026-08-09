import { getMatterDocuments } from "@/lib/matters/queries";
import { Card, CardContent } from "@/components/ui/card";
import { DocumentList } from "@/components/shared/document-list";
import { UploadDocumentForm } from "@/components/shared/upload-document-form";

export default async function MatterDocumentsPage({
  params,
}: {
  params: Promise<{ matterId: string }>;
}) {
  const { matterId } = await params;
  const documents = await getMatterDocuments(matterId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {documents.length} {documents.length === 1 ? "document" : "documents"} on file.
        </p>
        <UploadDocumentForm matterId={matterId} />
      </div>

      <Card>
        <CardContent className="p-0">
          <DocumentList
            matterId={matterId}
            documents={documents.map((doc) => ({
              id: doc.id,
              title: doc.title,
              category: doc.category,
              originalFilename: doc.originalFilename,
              sizeBytes: doc.sizeBytes,
              uploadedAt: doc.uploadedAt,
              uploadedBy: doc.uploadedBy,
              notes: doc.notes,
              // Rows seeded before real upload support carry a fake,
              // Dropbox-shaped path string with nothing actually stored
              // behind them — only offer a download once there's real
              // content (see docs/DATA_MODEL.md's Document entry).
              hasStoredFile: doc.storageKey.startsWith("matters/"),
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
