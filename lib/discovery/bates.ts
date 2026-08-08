/**
 * Bates numbering for paginated (PDF) discovery, and a parallel evidence-ID
 * scheme for non-paginated media — see docs/ARCHITECTURE.md's "Discovery
 * management" section. Pure functions only; no I/O, no Prisma, so they're
 * cheap to unit test (tests/discovery/bates.test.ts) independent of the
 * database or PDF processing.
 */

const BATES_DIGITS = 6;
const EVIDENCE_DIGITS = 4;

/** "ELLIS" + 1 -> "ELLIS000001". */
export function formatBatesLabel(prefix: string, number: number): string {
  return `${prefix}${String(number).padStart(BATES_DIGITS, "0")}`;
}

/** Single page -> "ELLIS000001"; a range -> "ELLIS000001-ELLIS000004". */
export function formatBatesRange(prefix: string, start: number, end: number): string {
  return start === end
    ? formatBatesLabel(prefix, start)
    : `${formatBatesLabel(prefix, start)}-${formatBatesLabel(prefix, end)}`;
}

/**
 * Next available Bates start number for a production, continuing from
 * whatever's already been assigned. `existingEnds` is every already-
 * registered PDF file's `batesEnd` in the same production (non-paginated
 * files don't participate in Bates sequencing at all). `productionStart`
 * is the production's configured starting number (defaults to 1) and is
 * only used when no file has been numbered yet.
 */
export function nextBatesStart(existingEnds: number[], productionStart: number | null): number {
  if (existingEnds.length === 0) {
    return productionStart ?? 1;
  }
  return Math.max(...existingEnds) + 1;
}

/** A `pageCount`-page PDF starting at `start` occupies `[start, start + pageCount - 1]`. */
export function computeBatesRange(start: number, pageCount: number): { start: number; end: number } {
  if (pageCount < 1) {
    throw new Error("A PDF must have at least one page to receive Bates numbers.");
  }
  return { start, end: start + pageCount - 1 };
}

/** Non-paginated evidence (video/audio/photo/other) gets a sequential ID instead of pretending to have page numbers. */
export function formatEvidenceIdentifier(prefix: string, sequence: number): string {
  return `${prefix}-${String(sequence).padStart(EVIDENCE_DIGITS, "0")}`;
}
