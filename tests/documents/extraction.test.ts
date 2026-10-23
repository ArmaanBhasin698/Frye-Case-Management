import { describe, expect, it } from "vitest";

import { extractText, extractorFor } from "@/lib/documents/extraction";
import { minimalDocx, pdfWithText, pdfWithoutText } from "./fixtures";

describe("extraction support matrix", () => {
  it("routes formats explicitly", () => {
    expect(extractorFor("text/plain", "notes.txt")).toBe("text");
    expect(extractorFor("", "readme.md")).toBe("text");
    expect(extractorFor("text/csv", "x.csv")).toBe("text");
    expect(extractorFor("application/pdf", "a.pdf")).toBe("pdf");
    expect(extractorFor("", "b.docx")).toBe("docx");
    expect(extractorFor("application/msword", "old.doc")).toBeNull();
    expect(extractorFor("image/jpeg", "scan.jpg")).toBeNull();
    expect(extractorFor("application/vnd.ms-excel", "x.xls")).toBeNull();
  });

  it("indexes UTF-8 text including non-ASCII", async () => {
    const r = await extractText(Buffer.from("Fictional note — Zoë Ångström\n\n\n\nend"), "text/plain", "n.txt");
    expect(r.status).toBe("INDEXED");
    expect(r.text).toContain("Zoë Ångström");
  });

  it("extracts a real text-layer PDF with unpdf", async () => {
    const r = await extractText(await pdfWithText(["Fictional suppression memo", "Second line"]), "application/pdf", "m.pdf");
    expect(r.status).toBe("INDEXED");
    expect(r.extractor).toBe("unpdf");
    expect(r.text).toContain("Fictional suppression memo");
  });

  it("reports a PDF with no text layer as UNSUPPORTED (no OCR), never as indexed text", async () => {
    const r = await extractText(await pdfWithoutText(), "application/pdf", "scan.pdf");
    expect(r.status).toBe("UNSUPPORTED");
    expect(r.text).toBeNull();
    expect(r.reason).toMatch(/text layer/);
  });

  it("extracts a real minimal .docx with mammoth", async () => {
    const r = await extractText(await minimalDocx("Fictional witness statement — Zoë"), "", "w.docx");
    expect(r.status).toBe("INDEXED");
    expect(r.extractor).toBe("mammoth");
    expect(r.text).toContain("Fictional witness statement — Zoë");
  });

  it("marks unsupported formats and corrupt files honestly", async () => {
    expect((await extractText(Buffer.from([0xff, 0xd8]), "image/jpeg", "x.jpg")).status).toBe("UNSUPPORTED");
    expect((await extractText(Buffer.from("not a pdf"), "application/pdf", "bad.pdf")).status).toBe("FAILED");
    expect((await extractText(Buffer.from("not a zip"), "", "bad.docx")).status).toBe("FAILED");
  });
});
