/**
 * Real production-to-production comparison, replacing the hand-seeded
 * DiscoveryFileMatch rows from the demo-polish milestone (see
 * docs/DATA_MODEL.md). Pure and Prisma-free so it's cheap to unit test
 * (tests/discovery/compare.test.ts) — lib/discovery/actions.ts is
 * responsible for loading files and persisting the result.
 */

export type ComparableFile = {
  id: string;
  originalFilename: string;
  identifier: string | null;
  contentHash: string | null;
};

export type FileComparisonStatus = "NEW" | "CHANGED" | "DUPLICATE" | "MISSING";

export type FileComparisonResult = {
  status: FileComparisonStatus;
  filename: string;
  identifier: string | null;
  /** The file in the "to" production this result describes; null for MISSING, since by definition it isn't there. */
  fileId: string | null;
  /** The matched file in the "from" production, when one was found (DUPLICATE/CHANGED/MISSING). */
  matchedFromFileId: string | null;
  notes: string;
};

/**
 * Classifies every file in `toFiles` relative to `fromFiles`:
 *  - Same content hash as an unmatched "from" file -> DUPLICATE (identical
 *    content; a rename doesn't change this — the same evidence re-served).
 *  - No hash match, but same filename as an unmatched "from" file ->
 *    CHANGED (nominally the same document, content differs).
 *  - Neither -> NEW.
 * Any "from" file never matched by either pass -> MISSING.
 */
export function compareProductionFiles(
  fromFiles: ComparableFile[],
  toFiles: ComparableFile[],
  labels: { fromLabel: string; toLabel: string },
): FileComparisonResult[] {
  const usedFromIds = new Set<string>();
  const findUnusedByHash = (hash: string) =>
    fromFiles.find((f) => f.contentHash !== null && f.contentHash === hash && !usedFromIds.has(f.id));
  const findUnusedByFilename = (filename: string) =>
    fromFiles.find(
      (f) => f.originalFilename.toLowerCase() === filename.toLowerCase() && !usedFromIds.has(f.id),
    );

  const results: FileComparisonResult[] = toFiles.map((file) => {
    const hashMatch = file.contentHash !== null ? findUnusedByHash(file.contentHash) : undefined;
    if (hashMatch) {
      usedFromIds.add(hashMatch.id);
      return {
        status: "DUPLICATE",
        filename: file.originalFilename,
        identifier: file.identifier,
        fileId: file.id,
        matchedFromFileId: hashMatch.id,
        notes: `Identical to ${hashMatch.identifier ?? hashMatch.originalFilename} in ${labels.fromLabel}.`,
      };
    }

    const filenameMatch = findUnusedByFilename(file.originalFilename);
    if (filenameMatch) {
      usedFromIds.add(filenameMatch.id);
      return {
        status: "CHANGED",
        filename: file.originalFilename,
        identifier: file.identifier,
        fileId: file.id,
        matchedFromFileId: filenameMatch.id,
        notes: `Same filename as ${filenameMatch.identifier ?? filenameMatch.originalFilename} in ${labels.fromLabel}, but the content differs.`,
      };
    }

    return {
      status: "NEW",
      filename: file.originalFilename,
      identifier: file.identifier,
      fileId: file.id,
      matchedFromFileId: null,
      notes: `New file not present in ${labels.fromLabel}.`,
    };
  });

  const missing: FileComparisonResult[] = fromFiles
    .filter((f) => !usedFromIds.has(f.id))
    .map((f) => ({
      status: "MISSING",
      filename: f.originalFilename,
      identifier: f.identifier,
      fileId: null,
      matchedFromFileId: f.id,
      notes: `Present in ${labels.fromLabel} but absent from ${labels.toLabel}.`,
    }));

  return [...results, ...missing];
}
