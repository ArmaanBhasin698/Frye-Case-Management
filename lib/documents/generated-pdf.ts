import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

/**
 * Renders generated correspondence to PDF with pdf-lib's standard
 * Helvetica (WinAnsi encoding). Characters WinAnsi can't encode are
 * handled explicitly: a few common symbols are transliterated, and
 * anything else is reported back to the caller — generation proceeds only
 * if the user explicitly accepts replacing them with "?". Nothing is ever
 * silently dropped.
 */

const BRAND = rgb(0.486, 0.161, 0.137);
const TEXT = rgb(0.1, 0.1, 0.1);
const MUTED = rgb(0.4, 0.4, 0.4);
const PAGE = { width: 612, height: 792, margin: 64 };
const BODY_SIZE = 11;
const LINE_HEIGHT = 15;

const TRANSLITERATIONS: Record<string, string> = {
  "→": "->",
  "←": "<-",
  "≤": "<=",
  "≥": ">=",
  "≠": "!=",
  "✓": "[x]",
  "✔": "[x]",
  "•": "•",
  " ": " ",
  " ": " ",
  " ": " ",
  "−": "-",
};

function canEncode(font: PDFFont, ch: string): boolean {
  try {
    font.encodeText(ch);
    return true;
  } catch {
    return false;
  }
}

/** Applies transliterations and lists every remaining unencodable character (unique, in order). */
export function prepareWinAnsiText(font: PDFFont, input: string): { text: string; unsupported: string[] } {
  const unsupported: string[] = [];
  let text = "";
  for (const ch of input.replace(/\r\n?/g, "\n")) {
    const mapped = TRANSLITERATIONS[ch] ?? ch;
    if (mapped === "\n" || mapped === "\t") {
      text += mapped === "\t" ? "    " : "\n";
      continue;
    }
    if ([...mapped].every((c) => canEncode(font, c))) {
      text += mapped;
    } else {
      if (!unsupported.includes(ch)) unsupported.push(ch);
      text += ch;
    }
  }
  return { text, unsupported };
}

function wrapLine(font: PDFFont, line: string, maxWidth: number): string[] {
  if (!line) return [""];
  const words = line.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, BODY_SIZE) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    // Hard-break a single word longer than the line.
    let rest = word;
    while (font.widthOfTextAtSize(rest, BODY_SIZE) > maxWidth && rest.length > 1) {
      let cut = rest.length - 1;
      while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), BODY_SIZE) > maxWidth) cut -= 1;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    current = rest;
  }
  lines.push(current);
  return lines;
}

export class UnsupportedCharactersError extends Error {
  constructor(public readonly characters: string[]) {
    super(`Characters not supported by the PDF font: ${characters.join(" ")}`);
    this.name = "UnsupportedCharactersError";
  }
}

/** Dry run used by preview: which characters would need replacing. */
export async function findUnsupportedCharacters(text: string): Promise<string[]> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  return prepareWinAnsiText(font, text).unsupported;
}

export async function renderGeneratedPdf(input: {
  title: string;
  body: string;
  subtitle: string;
  replaceUnsupported: boolean;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(input.title);
  doc.setProducer("Frye Case Management");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const prepared = prepareWinAnsiText(font, `${input.title}\n${input.subtitle}\n${input.body}`);
  if (prepared.unsupported.length > 0 && !input.replaceUnsupported) {
    throw new UnsupportedCharactersError(prepared.unsupported);
  }
  const clean = (s: string) => {
    const p = prepareWinAnsiText(font, s);
    return p.unsupported.length === 0 ? p.text : [...p.text].map((c) => (p.unsupported.includes(c) ? "?" : c)).join("");
  };

  const maxWidth = PAGE.width - PAGE.margin * 2;
  const bodyLines = clean(input.body)
    .split("\n")
    .flatMap((line) => wrapLine(font, line, maxWidth));

  const pages: ReturnType<typeof doc.addPage>[] = [];
  let page = doc.addPage([PAGE.width, PAGE.height]);
  pages.push(page);
  let y = PAGE.height - PAGE.margin;

  page.drawText("FRYE LAW GROUP", { x: PAGE.margin, y, font: bold, size: 14, color: BRAND });
  y -= 18;
  page.drawLine({ start: { x: PAGE.margin, y }, end: { x: PAGE.width - PAGE.margin, y }, thickness: 1, color: BRAND });
  y -= 24;
  page.drawText(clean(input.title).slice(0, 120), { x: PAGE.margin, y, font: bold, size: 13, color: TEXT });
  y -= 16;
  page.drawText(clean(input.subtitle).slice(0, 140), { x: PAGE.margin, y, font, size: 9, color: MUTED });
  y -= 24;

  for (const line of bodyLines) {
    if (y < PAGE.margin + 24) {
      page = doc.addPage([PAGE.width, PAGE.height]);
      pages.push(page);
      y = PAGE.height - PAGE.margin;
    }
    if (line) page.drawText(line, { x: PAGE.margin, y, font, size: BODY_SIZE, color: TEXT });
    y -= LINE_HEIGHT;
  }

  pages.forEach((p, i) => {
    p.drawText(`Confidential — Frye Law Group · Page ${i + 1} of ${pages.length}`, {
      x: PAGE.margin,
      y: PAGE.margin / 2,
      font,
      size: 8,
      color: MUTED,
    });
  });

  return doc.save();
}
