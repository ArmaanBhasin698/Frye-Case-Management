import type { DocumentIndexStatus } from "@prisma/client";

/**
 * Text extraction for the document content index. Explicit support
 * matrix — anything not listed is UNSUPPORTED and is never reported as a
 * search match:
 *
 * | Format                         | Extractor            |
 * |--------------------------------|----------------------|
 * | text/plain, .txt, .md, .csv    | UTF-8 decode         |
 * | application/pdf (text layer)   | unpdf (pdf.js)       |
 * | .docx (Word 2007+)             | mammoth raw text     |
 *
 * Scanned PDFs (no text layer) are UNSUPPORTED — there is no OCR and no
 * external service. Legacy .doc, spreadsheets, RTF, and images are
 * UNSUPPORTED. Everything runs in-process; document bytes never leave the
 * server.
 */

export const MAX_EXTRACT_BYTES = 25 * 1024 * 1024;
/** Stored text is capped so one huge file can't bloat the index. */
export const MAX_INDEXED_CHARS = 500_000;

export type ExtractionResult = {
  status: Extract<DocumentIndexStatus, "INDEXED" | "UNSUPPORTED" | "FAILED">;
  text: string | null;
  extractor: string | null;
  reason?: string;
};

export type ExtractorKind = "text" | "pdf" | "docx" | null;

function extension(filename: string | null | undefined): string {
  if (!filename) return "";
  const idx = filename.lastIndexOf(".");
  return idx === -1 ? "" : filename.slice(idx + 1).toLowerCase();
}

export function extractorFor(mimeType: string | null | undefined, filename: string | null | undefined): ExtractorKind {
  const ext = extension(filename);
  const mime = (mimeType ?? "").toLowerCase();
  if (["txt", "md", "csv"].includes(ext) || ["text/plain", "text/markdown", "text/csv"].includes(mime)) return "text";
  if (ext === "pdf" || mime === "application/pdf") return "pdf";
  if (ext === "docx" || mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  return null;
}

function normalize(text: string): string {
  return text
    .replace(/\u0000/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_INDEXED_CHARS);
}

export async function extractText(
  bytes: Buffer,
  mimeType: string | null | undefined,
  filename: string | null | undefined,
): Promise<ExtractionResult> {
  const kind = extractorFor(mimeType, filename);
  if (!kind) return { status: "UNSUPPORTED", text: null, extractor: null, reason: "Format not supported for content search" };
  if (bytes.byteLength > MAX_EXTRACT_BYTES) {
    return { status: "UNSUPPORTED", text: null, extractor: kind, reason: "File too large to index" };
  }
  try {
    if (kind === "text") {
      const text = normalize(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
      return text
        ? { status: "INDEXED", text, extractor: "utf8" }
        : { status: "UNSUPPORTED", text: null, extractor: "utf8", reason: "Empty text file" };
    }
    if (kind === "pdf") {
      const { extractText: pdfExtract } = await import("unpdf");
      const { text } = await pdfExtract(new Uint8Array(bytes), { mergePages: true });
      const cleaned = normalize(text);
      return cleaned
        ? { status: "INDEXED", text: cleaned, extractor: "unpdf" }
        : { status: "UNSUPPORTED", text: null, extractor: "unpdf", reason: "No text layer (scanned or image-only PDF)" };
    }
    const mammoth = (await import("mammoth")).default;
    const result = await mammoth.extractRawText({ buffer: bytes });
    const cleaned = normalize(result.value);
    return cleaned
      ? { status: "INDEXED", text: cleaned, extractor: "mammoth" }
      : { status: "UNSUPPORTED", text: null, extractor: "mammoth", reason: "No extractable text" };
  } catch {
    return { status: "FAILED", text: null, extractor: kind, reason: "Extraction failed" };
  }
}
