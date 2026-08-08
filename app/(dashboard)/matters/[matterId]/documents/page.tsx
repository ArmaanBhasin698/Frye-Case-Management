import { format } from "date-fns";

import { getMatterDocuments } from "@/lib/matters/queries";
import { documentCategoryLabel } from "@/lib/matters/format";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default async function MatterDocumentsPage({
  params,
}: {
  params: Promise<{ matterId: string }>;
}) {
  const { matterId } = await params;
  const documents = await getMatterDocuments(matterId);

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-dashed border-border bg-muted/40 p-3 text-sm text-muted-foreground">
        Documents reference a Dropbox path — Dropbox is not connected yet, so links below are not
        clickable (see docs/ARCHITECTURE.md).
      </div>

      <Card>
        <CardContent className="p-0">
          {documents.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No documents on file yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Dropbox path</TableHead>
                  <TableHead>Uploaded by</TableHead>
                  <TableHead>Uploaded</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell className="font-medium">{doc.title}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{documentCategoryLabel(doc.category)}</Badge>
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-xs text-muted-foreground">
                      {doc.dropboxPath}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{doc.uploadedBy.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {format(doc.uploadedAt, "MMM d, yyyy")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
