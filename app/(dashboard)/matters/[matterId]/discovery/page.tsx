import Link from "next/link";
import { format } from "date-fns";
import {
  AudioLines,
  Download,
  File,
  FileText,
  GitCompareArrows,
  Image as ImageIcon,
  Video,
} from "lucide-react";
import type { DiscoveryFileType } from "@prisma/client";

import { getMatterDiscoveryComparisons, getMatterDiscoveryProductions } from "@/lib/matters/queries";
import {
  asCalendarDate,
  discoveryFileTypeLabel,
  discoveryMatchStatusLabel,
  discoveryMatchStatusVariant,
  discoveryReviewStatusLabel,
  discoveryReviewStatusVariant,
  formatFileSize,
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
import { NewDiscoveryProductionForm } from "@/components/shared/new-discovery-production-form";
import { RegisterDiscoveryFileForm } from "@/components/shared/register-discovery-file-form";
import { RunComparisonForm } from "@/components/shared/run-comparison-form";

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
        Registering a file here computes a real SHA-256 hash and, for PDFs, generates a separate
        Bates-stamped derivative (the original is never modified) — see lib/discovery/. Comparisons
        run below use that data for real New/Changed/Duplicate/Missing classification. Productions
        and comparisons from before this engine existed remain as illustrative historical demo data.
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile label="Productions" value={productions.length} />
        <StatTile label="Total files" value={totalFiles} />
        {(["PDF", "VIDEO", "AUDIO", "PHOTO"] as const).map((type) => (
          <StatTile key={type} label={discoveryFileTypeLabel(type)} value={fileTypeCounts[type] ?? 0} />
        ))}
      </div>

      <NewDiscoveryProductionForm matterId={matterId} />

      {productions.length >= 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GitCompareArrows className="h-4 w-4" />
              Run a comparison
            </CardTitle>
            <CardDescription>
              Classifies every file in the &ldquo;to&rdquo; production as New, Changed, Duplicate,
              or Missing relative to the &ldquo;from&rdquo; production, using stored content
              hashes and filenames.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RunComparisonForm
              matterId={matterId}
              productions={productions.map((p) => ({ id: p.id, label: p.label }))}
            />
          </CardContent>
        </Card>
      )}

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
                  Received {format(asCalendarDate(production.receivedDate), "MMM d, yyyy")}
                  {production.source ? ` from ${production.source}` : ""}
                  {production.batesPrefix && production.batesStart && production.batesEnd
                    ? ` · Bates ${production.batesPrefix}${String(production.batesStart).padStart(
                        6,
                        "0",
                      )}–${production.batesPrefix}${String(production.batesEnd).padStart(6, "0")}`
                    : ""}
                  {` · ${production.files.length} file${production.files.length === 1 ? "" : "s"}`}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={discoveryReviewStatusVariant(production.reviewStatus)}>
                  {discoveryReviewStatusLabel(production.reviewStatus)}
                </Badge>
                <RegisterDiscoveryFileForm matterId={matterId} productionId={production.id} />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {production.files.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">No files registered yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>File</TableHead>
                      <TableHead>Identifier</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Pages</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead>Registered by</TableHead>
                      <TableHead>Download</TableHead>
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
                          <TableCell className="text-muted-foreground">
                            {file.sizeBytes != null ? formatFileSize(file.sizeBytes) : "—"}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {file.registeredBy?.name ?? "—"}
                          </TableCell>
                          <TableCell>
                            {/* Seeded pre-engine files carry a fake Dropbox-shaped path in
                                originalStorageKey with nothing actually stored behind it —
                                only offer a download once there's real content to serve. */}
                            {file.originalStorageKey?.startsWith("matters/") ? (
                              <div className="flex items-center gap-2">
                                <Link
                                  href={`/matters/${matterId}/discovery/files/${file.id}?variant=original`}
                                  className="inline-flex items-center gap-1 text-primary hover:underline"
                                >
                                  <Download className="h-3.5 w-3.5" /> Original
                                </Link>
                                {file.stampedStorageKey && (
                                  <Link
                                    href={`/matters/${matterId}/discovery/files/${file.id}?variant=stamped`}
                                    className="inline-flex items-center gap-1 text-primary hover:underline"
                                  >
                                    <Download className="h-3.5 w-3.5" /> Stamped
                                  </Link>
                                )}
                              </div>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
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
          {format(comparison.runAt, "MMM d, yyyy")}
          {comparison.runBy
            ? ` by ${comparison.runBy.name}`
            : " · illustrative historical data, not a live diff"}
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
