import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { formatBatesLabel } from "@/lib/discovery/bates";

/** Page count of a PDF, read without mutating the supplied bytes. */
export async function getPdfPageCount(bytes: Buffer): Promise<number> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPageCount();
}

/**
 * Stamps a Bates label onto every page of a *copy* of the given PDF and
 * returns the new bytes — the caller's `bytes` buffer is never written to.
 * `PDFDocument.load` parses into a fresh in-memory document, and `.save()`
 * serializes a brand-new byte array, so the original stays byte-for-byte
 * intact in storage (see docs/ARCHITECTURE.md: "Original files are always
 * preserved untouched").
 */
export async function stampBatesNumbers(
  bytes: Buffer,
  options: { prefix: string; startNumber: number },
): Promise<Buffer> {
  const doc = await PDFDocument.load(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();

  pages.forEach((page, index) => {
    const label = formatBatesLabel(options.prefix, options.startNumber + index);
    const fontSize = 9;
    const textWidth = font.widthOfTextAtSize(label, fontSize);
    const margin = 18;

    page.drawText(label, {
      x: page.getWidth() - textWidth - margin,
      y: margin / 2,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
    });
  });

  const stamped = await doc.save();
  return Buffer.from(stamped);
}
