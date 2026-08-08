import { format } from "date-fns";

import { getMatterDiscoveryProductions } from "@/lib/matters/queries";
import { discoveryFileTypeLabel } from "@/lib/matters/format";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default async function MatterDiscoveryPage({
  params,
}: {
  params: Promise<{ matterId: string }>;
}) {
  const { matterId } = await params;
  const productions = await getMatterDiscoveryProductions(matterId);

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-dashed border-border bg-muted/40 p-3 text-sm text-muted-foreground">
        Bates numbering, media identifiers, and production-to-production comparison are not
        implemented yet — this is page structure only (see docs/ROADMAP.md, Phase 4). Below are
        the raw discovery production and file records.
      </div>

      {productions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No discovery has been logged for this matter.</p>
      ) : (
        productions.map((production) => (
          <Card key={production.id}>
            <CardHeader>
              <CardTitle>{production.label}</CardTitle>
              <CardDescription>
                Received {format(production.receivedDate, "MMM d, yyyy")}
                {production.source ? ` from ${production.source}` : ""}
                {production.batesPrefix
                  ? ` · Bates ${production.batesPrefix}${String(production.batesStart).padStart(
                      6,
                      "0",
                    )}–${production.batesPrefix}${String(production.batesEnd).padStart(6, "0")}`
                  : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead>Identifier</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Pages</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {production.files.map((file) => (
                    <TableRow key={file.id}>
                      <TableCell className="font-medium">{file.originalFilename}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {file.identifier ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{discoveryFileTypeLabel(file.fileType)}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {file.pageCount ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
