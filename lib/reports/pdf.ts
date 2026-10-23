import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { format } from "date-fns";

/**
 * Minimal branded report builder on top of pdf-lib (already a dependency —
 * see lib/discovery/pdf.ts). US Letter, Frye header on every page, tables
 * whose header row repeats after each page break, wrapped cells, and a
 * footer with page numbers, generation time, and a confidentiality line.
 */

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 50;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const HEADER_BOTTOM = PAGE_HEIGHT - 70;
const FOOTER_TOP = 50;
const FONT_SIZE = 9;
const LINE_HEIGHT = 12;

/** The app's primary brand color (app/globals.css --primary: hsl(4.4 50.6% 31.8%)). */
const BRAND = rgb(0.479, 0.181, 0.157);
const MUTED = rgb(0.4, 0.4, 0.4);
const RULE = rgb(0.85, 0.85, 0.85);

/**
 * Standard PDF fonts only encode WinAnsi. Anything outside it (emoji, most
 * non-Latin scripts) is replaced rather than crashing generation.
 */
export function toWinAnsi(text: string): string {
  return text
    .replace(/[\r\t]/g, " ")
    .replace(/[^\n\x20-\x7E\xA0-\xFF–—‘’“”•…]/g, "?");
}

export type PdfColumn = { header: string; width: number; align?: "left" | "right" };

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of toWinAnsi(text).split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      // A single word wider than the column is hard-broken.
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > width && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines.length ? lines : [""];
}

export class ReportPdf {
  private doc!: PDFDocument;
  private font!: PDFFont;
  private bold!: PDFFont;
  private page!: PDFPage;
  private y = 0;

  private constructor(
    private readonly title: string,
    private readonly subtitle: string,
    private readonly generatedAt: Date,
  ) {}

  static async create(title: string, subtitle: string, generatedAt = new Date()): Promise<ReportPdf> {
    const pdf = new ReportPdf(title, subtitle, generatedAt);
    pdf.doc = await PDFDocument.create();
    pdf.doc.setTitle(`${title} — Frye Law Group`);
    pdf.doc.setProducer("Frye Case Management");
    pdf.font = await pdf.doc.embedFont(StandardFonts.Helvetica);
    pdf.bold = await pdf.doc.embedFont(StandardFonts.HelveticaBold);
    pdf.newPage();
    return pdf;
  }

  private newPage() {
    this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 8, width: PAGE_WIDTH, height: 8, color: BRAND });
    this.page.drawText("FRYE LAW GROUP", { x: MARGIN, y: PAGE_HEIGHT - 32, size: 11, font: this.bold, color: BRAND });
    this.page.drawText(toWinAnsi(this.title), {
      x: MARGIN,
      y: PAGE_HEIGHT - 48,
      size: 14,
      font: this.bold,
    });
    const sub = toWinAnsi(this.subtitle);
    this.page.drawText(sub, {
      x: PAGE_WIDTH - MARGIN - this.font.widthOfTextAtSize(sub, FONT_SIZE),
      y: PAGE_HEIGHT - 32,
      size: FONT_SIZE,
      font: this.font,
      color: MUTED,
    });
    this.page.drawLine({
      start: { x: MARGIN, y: HEADER_BOTTOM + 8 },
      end: { x: PAGE_WIDTH - MARGIN, y: HEADER_BOTTOM + 8 },
      thickness: 0.75,
      color: BRAND,
    });
    this.y = HEADER_BOTTOM - 6;
  }

  private ensureSpace(height: number): boolean {
    if (this.y - height < FOOTER_TOP + 10) {
      this.newPage();
      return true;
    }
    return false;
  }

  heading(text: string) {
    this.ensureSpace(30);
    this.y -= 8;
    this.page.drawText(toWinAnsi(text), { x: MARGIN, y: this.y, size: 11, font: this.bold, color: BRAND });
    this.y -= 16;
  }

  paragraph(text: string, options: { muted?: boolean } = {}) {
    for (const line of wrap(text, this.font, FONT_SIZE, CONTENT_WIDTH)) {
      this.ensureSpace(LINE_HEIGHT);
      this.page.drawText(line, { x: MARGIN, y: this.y, size: FONT_SIZE, font: this.font, color: options.muted ? MUTED : undefined });
      this.y -= LINE_HEIGHT;
    }
    this.y -= 4;
  }

  keyValues(pairs: [string, string][]) {
    for (const [key, value] of pairs) {
      const lines = wrap(value, this.font, FONT_SIZE, CONTENT_WIDTH - 140);
      this.ensureSpace(lines.length * LINE_HEIGHT);
      this.page.drawText(toWinAnsi(key), { x: MARGIN, y: this.y, size: FONT_SIZE, font: this.bold });
      lines.forEach((line, i) => {
        this.page.drawText(line, { x: MARGIN + 140, y: this.y - i * LINE_HEIGHT, size: FONT_SIZE, font: this.font });
      });
      this.y -= lines.length * LINE_HEIGHT + 2;
    }
    this.y -= 4;
  }

  /**
   * Draws a table, repeating the header row on every new page. Column
   * widths are fractions of the content width (they're normalized). The
   * optional `totalRow` is drawn bold after a rule.
   */
  table(columns: PdfColumn[], rows: string[][], options: { totalRow?: string[]; emptyText?: string } = {}) {
    const totalWidth = columns.reduce((sum, c) => sum + c.width, 0);
    const widths = columns.map((c) => (c.width / totalWidth) * CONTENT_WIDTH);
    const pad = 3;

    const drawRow = (cells: string[], font: PDFFont, shade: boolean) => {
      const wrapped = cells.map((cell, i) => wrap(cell ?? "", font, FONT_SIZE, widths[i]! - pad * 2));
      const height = Math.max(...wrapped.map((l) => l.length)) * LINE_HEIGHT + 4;
      return { wrapped, height, font, shade };
    };

    const paint = (row: ReturnType<typeof drawRow>) => {
      if (row.shade) {
        this.page.drawRectangle({
          x: MARGIN,
          y: this.y - row.height + LINE_HEIGHT - 2,
          width: CONTENT_WIDTH,
          height: row.height,
          color: rgb(0.96, 0.94, 0.92),
        });
      }
      let x = MARGIN;
      row.wrapped.forEach((lines, i) => {
        lines.forEach((line, li) => {
          const w = row.font.widthOfTextAtSize(line, FONT_SIZE);
          const tx = columns[i]!.align === "right" ? x + widths[i]! - pad - w : x + pad;
          this.page.drawText(line, { x: tx, y: this.y - li * LINE_HEIGHT, size: FONT_SIZE, font: row.font });
        });
        x += widths[i]!;
      });
      this.y -= row.height;
    };

    const header = drawRow(
      columns.map((c) => c.header),
      this.bold,
      true,
    );
    this.ensureSpace(header.height + LINE_HEIGHT * 2);
    paint(header);

    if (rows.length === 0) {
      this.paragraph(options.emptyText ?? "No recorded activity.", { muted: true });
      return;
    }
    for (const cells of rows) {
      const row = drawRow(cells, this.font, false);
      if (this.ensureSpace(row.height)) paint(header);
      paint(row);
    }
    if (options.totalRow) {
      const total = drawRow(options.totalRow, this.bold, false);
      if (this.ensureSpace(total.height + 4)) paint(header);
      this.page.drawLine({
        start: { x: MARGIN, y: this.y + LINE_HEIGHT - 1 },
        end: { x: PAGE_WIDTH - MARGIN, y: this.y + LINE_HEIGHT - 1 },
        thickness: 0.5,
        color: RULE,
      });
      paint(total);
    }
    this.y -= 8;
  }

  async finish(): Promise<Uint8Array> {
    const pages = this.doc.getPages();
    const stamp = `Generated ${format(this.generatedAt, "MMM d, yyyy h:mm a")}`;
    pages.forEach((page, i) => {
      page.drawLine({ start: { x: MARGIN, y: FOOTER_TOP - 6 }, end: { x: PAGE_WIDTH - MARGIN, y: FOOTER_TOP - 6 }, thickness: 0.5, color: RULE });
      page.drawText("Frye Law Group  |  Confidential — internal use only", {
        x: MARGIN,
        y: FOOTER_TOP - 20,
        size: 8,
        font: this.font,
        color: MUTED,
      });
      const right = `${stamp}  |  Page ${i + 1} of ${pages.length}`;
      page.drawText(right, {
        x: PAGE_WIDTH - MARGIN - this.font.widthOfTextAtSize(right, 8),
        y: FOOTER_TOP - 20,
        size: 8,
        font: this.font,
        color: MUTED,
      });
    });
    return this.doc.save();
  }
}

export function pdfResponseHeaders(filename: string): HeadersInit {
  return {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
    "Cache-Control": "no-store",
  };
}
