import Link from "next/link";
import { format } from "date-fns";
import { AudioLines, File, FileText, Image as ImageIcon, Video } from "lucide-react";
import type { DiscoveryFileType, DiscoveryReviewStatus } from "@prisma/client";

import { getFirmWideDiscoveryFiles, type FirmDiscoveryFilters, type FirmDiscoverySort } from "@/lib/discovery/queries";
import { listMatters } from "@/lib/matters/queries";
import {
  discoveryFileTypeLabel,
  discoveryReviewStatusLabel,
  discoveryReviewStatusVariant,
  formatClientName,
  formatFileSize,
  matterTitle,
} from "@/lib/matters/format";
import { requireCurrentUser } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DiscoveryFilterBar, type DiscoveryFilterValues } from "@/components/shared/discovery-filter-bar";

const FILE_TYPE_VALUES = new Set<DiscoveryFileType>(["PDF", "VIDEO", "AUDIO", "PHOTO", "OTHER"]);
const REVIEW_STATUS_VALUES = new Set<DiscoveryReviewStatus>(["NOT_STARTED", "IN_REVIEW", "COMPLETE"]);

const FILE_TYPE_ICON: Record<DiscoveryFileType, React.ComponentType<{ className?: string }>> = {
  PDF: FileText,
  VIDEO: Video,
  AUDIO: AudioLines,
  PHOTO: ImageIcon,
  OTHER: File,
};

function readParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Firm-wide Discovery (app/(dashboard)/discovery) — a real, authorized
 * aggregate view over the existing per-matter `DiscoveryFile`/
 * `DiscoveryProduction` rows (`lib/discovery/queries.ts#getFirmWideDiscoveryFiles`),
 * the same pattern the firm-wide Tasks/Calendar/Communications pages already
 * established — not a second Discovery/Bates record or a new upload/download
 * path. Every row links back to its matter's own Discovery tab (where
 * registering a file, running a comparison, and downloading originals/
 * stamped derivatives already live) rather than duplicating any of that
 * here.
 *
 * Visibility: `getFirmWideDiscoveryFiles` scopes to matters the caller may
 * access via `matterScopeFilterFor` (lib/auth/access.ts) — an ADMIN sees
 * every matter's discovery, everyone else only matters they're assigned to.
 * No separate role gate on top of that, unlike Communications' unfiled-call
 * carve-out: every `DiscoveryFile` belongs to a `DiscoveryProduction` which
 * always belongs to a matter, so there's no "unfiled" analogue here to
 * reason about.
 */
export default async function FirmDiscoveryPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requireCurrentUser();
  const params = await searchParams;

  const fileTypeParam = readParam(params.fileType);
  const reviewStatusParam = readParam(params.reviewStatus);
  const matterId = readParam(params.matterId) || "";
  const sortParam = readParam(params.sort);

  const fileType =
    fileTypeParam && FILE_TYPE_VALUES.has(fileTypeParam as DiscoveryFileType)
      ? (fileTypeParam as DiscoveryFileType)
      : undefined;
  const reviewStatus =
    reviewStatusParam && REVIEW_STATUS_VALUES.has(reviewStatusParam as DiscoveryReviewStatus)
      ? (reviewStatusParam as DiscoveryReviewStatus)
      : undefined;
  const sort: FirmDiscoverySort = sortParam === "oldest" ? "oldest" : "recent";

  const filters: FirmDiscoveryFilters = {
    matterId: matterId || undefined,
    fileType,
    reviewStatus,
  };

  const [files, matters] = await Promise.all([
    getFirmWideDiscoveryFiles(user, filters, sort),
    listMatters(user),
  ]);

  const currentFilters: DiscoveryFilterValues = {
    matterId,
    fileType: fileType ?? "",
    reviewStatus: reviewStatus ?? "",
    sort,
  };

  const matterOptions = matters.map((m) => ({ id: m.id, label: `${matterTitle(m)} · ${m.caseNumber}` }));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Discovery</h1>
        <p className="text-sm text-muted-foreground">
          Firm-wide discovery files across every matter you have access to — an aggregate view over
          each matter&apos;s own Discovery tab, not a separate record. {files.length}{" "}
          {files.length === 1 ? "file" : "files"} match these filters.
        </p>
      </div>

      <div className="rounded-md border border-dashed border-border bg-muted/40 p-3 text-sm text-muted-foreground">
        This is a read-only index over the existing Discovery/Bates engine — register a file, run a
        comparison, or download a file&apos;s original/stamped bytes from a matter&apos;s own
        Discovery tab, linked from each row below.
      </div>

      <DiscoveryFilterBar basePath="/discovery" current={currentFilters} matters={matterOptions} />

      <Card>
        <CardContent className="p-0">
          {files.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No discovery files match these filters.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead>Matter</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Identifier</TableHead>
                  <TableHead>Production</TableHead>
                  <TableHead>Review status</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Registered</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.map((file) => {
                  const Icon = FILE_TYPE_ICON[file.fileType];
                  const matter = file.production.matter;
                  return (
                    <TableRow key={file.id}>
                      <TableCell className="font-medium">
                        <Link
                          href={`/matters/${matter.id}/discovery`}
                          className="flex items-center gap-2 hover:underline"
                        >
                          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                          {file.originalFilename}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/matters/${matter.id}`}
                          className="text-sm text-foreground hover:underline"
                        >
                          {matterTitle(matter)}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {formatClientName(matter.client)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{discoveryFileTypeLabel(file.fileType)}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {file.identifier ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/matters/${matter.id}/discovery`}
                          className="text-sm text-muted-foreground hover:underline"
                        >
                          {file.production.label}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant={discoveryReviewStatusVariant(file.production.reviewStatus)}>
                          {discoveryReviewStatusLabel(file.production.reviewStatus)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {file.sizeBytes != null ? formatFileSize(file.sizeBytes) : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {file.registeredAt ? (
                          <>
                            {format(file.registeredAt, "MMM d, yyyy")}
                            {file.registeredBy ? ` · ${file.registeredBy.name}` : ""}
                          </>
                        ) : (
                          "—"
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
    </div>
  );
}
