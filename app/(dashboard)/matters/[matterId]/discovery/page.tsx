import { format } from "date-fns";
import {
  AudioLines,
  File,
  FileText,
  GitCompareArrows,
  Image as ImageIcon,
  Video,
} from "lucide-react";
import type { DiscoveryFileType } from "@prisma/client";

import { getMatterDiscoveryComparisons, getMatterDiscoveryProductions } from "@/lib/matters/queries";
import {
  discoveryFileTypeLabel,
  discoveryMatchStatusLabel,
  discoveryMatchStatusVariant,
  discoveryReviewStatusLabel,
  discoveryReviewStatusVariant,
} from "@/lib/matters/format";
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

const FILE_TYPE_ICON: Record<DiscoveryFileType, React.ComponentType<{ className?: string }>> = {
  PDF: FileText,
  VIDEO: Video,
  AUDIO: AudioLines,
  PHOTO: ImageIcon,
  OTHER: File,
};

export default async function MatterDiscoveryPage({
  params,
}: {
  params: Promise<{ matterId: string }>;
}) {
  const { matterId } = await params;
  const [productions, comparisons] = await Promise.all([
    getMatterDiscoveryProductions(matterId),
    getMatterDiscoveryComparisons(matterId),
  ]);

  const totalFiles = productions.reduce((sum, p) => sum + p.files.length, 0);
  const fileTypeCounts = productions
    .flatMap((p) => p.files)
    .reduce<Record<string, number>>((acc, f) => {
      acc[f.fileType] = (acc[f.fileType] ?? 0) + 1;
      return acc;
    }, {});

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-dashed border-border bg-muted/40 p-3 text-sm text-muted-foreground">
        Bates numbering and content-hash comparison are not implemented yet — production/file
        records and the comparison below are real seeded data, but the numbering and diffing
        engine is still a placeholder (see docs/ROADMAP.md, Phase 4).
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile label="Productions" value={productions.length} />
        <StatTile label="Total files" value={totalFiles} />
        {(["PDF", "VIDEO", "AUDIO", "PHOTO"] as const).map((type) => (
          <StatTile key={type} label={discoveryFileTypeLabel(type)} value={fileTypeCounts[type] ?? 0} />
        ))}
      </div>

      {comparisons.map((comparison) => (
        <ComparisonCard key={comparison.id} comparison={comparison} />
      ))}

      {productions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No discovery has been logged for this matter.</p>
      ) : (
        productions.map((production) => (
          <Card key={production.id}>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
              <div>
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
                  {` · ${production.files.length} file${production.files.length === 1 ? "" : "s"}`}
                </CardDescription>
              </div>
              <Badge variant={discoveryReviewStatusVariant(production.reviewStatus)}>
                {discoveryReviewStatusLabel(production.reviewStatus)}
              </Badge>
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
                  {production.files.map((file) => {
                    const Icon = FILE_TYPE_ICON[file.fileType];
                    return (
                      <TableRow key={file.id}>
                        <TableCell className="font-medium">
                          <span className="flex items-center gap-2">
                            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                            {file.originalFilename}
                          </span>
                        </TableCell>
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
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-2xl font-semibold text-foreground">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}

type ComparisonWithMatches = Awaited<
  ReturnType<typeof getMatterDiscoveryComparisons>
>[number];

function ComparisonCard({ comparison }: { comparison: ComparisonWithMatches }) {
  const counts = comparison.matches.reduce<Record<string, number>>((acc, m) => {
    acc[m.status] = (acc[m.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitCompareArrows className="h-4 w-4" />
          Production comparison
        </CardTitle>
        <CardDescription>
          {comparison.fromProduction.label} &rarr; {comparison.toProduction.label} &middot; run{" "}
          {format(comparison.runAt, "MMM d, yyyy")} &middot; illustrative sample data, not a live
          diff
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(["NEW", "CHANGED", "DUPLICATE", "MISSING"] as const).map((status) => (
            <div
              key={status}
              className="rounded-md border border-border bg-muted/30 p-3 text-center"
            >
              <p className="text-xl font-semibold text-foreground">{counts[status] ?? 0}</p>
              <Badge variant={discoveryMatchStatusVariant(status)} className="mt-1">
                {discoveryMatchStatusLabel(status)}
              </Badge>
            </div>
          ))}
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>File</TableHead>
              <TableHead>Identifier</TableHead>
              <TableHead>Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {comparison.matches.map((match) => (
              <TableRow key={match.id}>
                <TableCell>
                  <Badge variant={discoveryMatchStatusVariant(match.status)}>
                    {discoveryMatchStatusLabel(match.status)}
                  </Badge>
                </TableCell>
                <TableCell className="font-medium">{match.filename}</TableCell>
                <TableCell className="text-muted-foreground">{match.identifier ?? "—"}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{match.notes ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
