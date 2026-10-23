import JSZip from "jszip";
import { PDFDocument, StandardFonts } from "pdf-lib";

/**
 * Tiny fictional fixture files built in-test (no binary fixtures checked
 * in). `jszip` is available as an approved dependency of `mammoth`; it is
 * used here only to assemble a minimal, valid .docx package.
 */

export async function pdfWithText(lines: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  lines.forEach((line, i) => page.drawText(line, { x: 50, y: 700 - i * 20, font, size: 12 }));
  return Buffer.from(await doc.save());
}

/** A PDF with a page but no text layer — what a scanned/image-only PDF looks like to an extractor. */
export async function pdfWithoutText(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage();
  return Buffer.from(await doc.save());
}

export async function minimalDocx(paragraph: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${paragraph}</w:t></w:r></w:p></w:body></w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}
