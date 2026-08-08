import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { getPdfPageCount, stampBatesNumbers } from "@/lib/discovery/pdf";

async function makeTestPdf(pageCount: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    doc.addPage([200, 200]);
  }
  return Buffer.from(await doc.save());
}

describe("getPdfPageCount", () => {
  it("reads the page count of a fictional test PDF", async () => {
    const pdf = await makeTestPdf(3);
    await expect(getPdfPageCount(pdf)).resolves.toBe(3);
  });

  it("reads a single-page PDF correctly", async () => {
    const pdf = await makeTestPdf(1);
    await expect(getPdfPageCount(pdf)).resolves.toBe(1);
  });
});

describe("stampBatesNumbers", () => {
  it("never modifies the original bytes passed in", async () => {
    const original = await makeTestPdf(2);
    const originalCopy = Buffer.from(original);

    await stampBatesNumbers(original, { prefix: "TEST", startNumber: 1 });

    expect(Buffer.compare(original, originalCopy)).toBe(0);
  });

  it("returns a different (stamped) document, not the same bytes", async () => {
    const original = await makeTestPdf(2);
    const stamped = await stampBatesNumbers(original, { prefix: "TEST", startNumber: 1 });

    expect(Buffer.compare(original, stamped)).not.toBe(0);
  });

  it("preserves the page count in the stamped derivative", async () => {
    const original = await makeTestPdf(4);
    const stamped = await stampBatesNumbers(original, { prefix: "TEST", startNumber: 1 });

    await expect(getPdfPageCount(stamped)).resolves.toBe(4);
  });

  it("produces a stamped copy that is itself a valid, loadable PDF", async () => {
    const original = await makeTestPdf(1);
    const stamped = await stampBatesNumbers(original, { prefix: "TEST", startNumber: 42 });

    await expect(PDFDocument.load(stamped)).resolves.toBeDefined();
  });
});
