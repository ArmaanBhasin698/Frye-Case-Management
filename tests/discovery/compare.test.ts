import { describe, expect, it } from "vitest";

import { compareProductionFiles } from "@/lib/discovery/compare";
import type { ComparableFile } from "@/lib/discovery/compare";

const labels = { fromLabel: "Initial Production", toLabel: "Supplemental Production 1" };

function file(overrides: Partial<ComparableFile> & { id: string }): ComparableFile {
  return { originalFilename: "file.pdf", identifier: null, contentHash: null, ...overrides };
}

describe("compareProductionFiles", () => {
  it("classifies a brand-new filename and hash as NEW", () => {
    const from: ComparableFile[] = [file({ id: "f1", originalFilename: "incident-report.pdf", contentHash: "hash-a" })];
    const to: ComparableFile[] = [
      ...from,
      file({ id: "f2", originalFilename: "witness-statement.pdf", contentHash: "hash-b" }),
    ];

    const results = compareProductionFiles(from, to, labels);
    const newResult = results.find((r) => r.filename === "witness-statement.pdf");
    expect(newResult?.status).toBe("NEW");
    expect(newResult?.fileId).toBe("f2");
    expect(newResult?.matchedFromFileId).toBeNull();
  });

  it("classifies identical content under the same filename as DUPLICATE", () => {
    const from: ComparableFile[] = [file({ id: "f1", originalFilename: "property-inventory.pdf", contentHash: "hash-a" })];
    const to: ComparableFile[] = [file({ id: "f2", originalFilename: "property-inventory.pdf", contentHash: "hash-a" })];

    const results = compareProductionFiles(from, to, labels);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ status: "DUPLICATE", fileId: "f2", matchedFromFileId: "f1" });
  });

  it("classifies identical content under a different filename (a rename) as DUPLICATE, not NEW", () => {
    const from: ComparableFile[] = [file({ id: "f1", originalFilename: "bodycam-diaz.mp4", contentHash: "hash-a" })];
    const to: ComparableFile[] = [file({ id: "f2", originalFilename: "bodycam-officer-diaz.mp4", contentHash: "hash-a" })];

    const results = compareProductionFiles(from, to, labels);
    expect(results[0]?.status).toBe("DUPLICATE");
  });

  it("classifies the same filename with different content as CHANGED", () => {
    const from: ComparableFile[] = [file({ id: "f1", originalFilename: "lab-report.pdf", identifier: "ELLIS000013", contentHash: "hash-old" })];
    const to: ComparableFile[] = [file({ id: "f2", originalFilename: "lab-report.pdf", identifier: "ELLIS000085", contentHash: "hash-new" })];

    const results = compareProductionFiles(from, to, labels);
    expect(results[0]).toMatchObject({ status: "CHANGED", fileId: "f2", matchedFromFileId: "f1" });
    expect(results[0]?.notes).toContain("ELLIS000013");
  });

  it("classifies a from-file with no counterpart in the to-production as MISSING", () => {
    const from: ComparableFile[] = [
      file({ id: "f1", originalFilename: "scene-photo-01.jpg", contentHash: "hash-a" }),
      file({ id: "f2", originalFilename: "scene-photo-02.jpg", contentHash: "hash-b" }),
    ];
    const to: ComparableFile[] = [file({ id: "f3", originalFilename: "scene-photo-01.jpg", contentHash: "hash-a" })];

    const results = compareProductionFiles(from, to, labels);
    const missing = results.find((r) => r.status === "MISSING");
    expect(missing).toMatchObject({ filename: "scene-photo-02.jpg", fileId: null, matchedFromFileId: "f2" });
  });

  it("matches one-to-one even with duplicate hashes on both sides, never double-counting a from-file", () => {
    const from: ComparableFile[] = [
      file({ id: "f1", originalFilename: "a.pdf", contentHash: "same-hash" }),
      file({ id: "f2", originalFilename: "b.pdf", contentHash: "same-hash" }),
    ];
    const to: ComparableFile[] = [
      file({ id: "f3", originalFilename: "a.pdf", contentHash: "same-hash" }),
      file({ id: "f4", originalFilename: "b.pdf", contentHash: "same-hash" }),
    ];

    const results = compareProductionFiles(from, to, labels);
    expect(results.filter((r) => r.status === "DUPLICATE")).toHaveLength(2);
    expect(results.filter((r) => r.status === "MISSING")).toHaveLength(0);
    const matchedFromIds = results.map((r) => r.matchedFromFileId).sort();
    expect(matchedFromIds).toEqual(["f1", "f2"]);
  });

  it("handles an empty from-production as everything NEW", () => {
    const to: ComparableFile[] = [file({ id: "f1", originalFilename: "a.pdf", contentHash: "hash-a" })];
    const results = compareProductionFiles([], to, labels);
    expect(results).toEqual([
      expect.objectContaining({ status: "NEW", fileId: "f1" }),
    ]);
  });

  it("handles an empty to-production as everything MISSING", () => {
    const from: ComparableFile[] = [file({ id: "f1", originalFilename: "a.pdf", contentHash: "hash-a" })];
    const results = compareProductionFiles(from, [], labels);
    expect(results).toEqual([
      expect.objectContaining({ status: "MISSING", matchedFromFileId: "f1" }),
    ]);
  });

  it("falls back to filename matching when a file has no stored hash (legacy data)", () => {
    const from: ComparableFile[] = [file({ id: "f1", originalFilename: "arrest-report.pdf", contentHash: null })];
    const to: ComparableFile[] = [file({ id: "f2", originalFilename: "arrest-report.pdf", contentHash: null })];

    const results = compareProductionFiles(from, to, labels);
    // Neither side has a hash to compare, so this can only be detected as
    // "same nominal file" via filename -> CHANGED, not falsely DUPLICATE.
    expect(results[0]?.status).toBe("CHANGED");
  });
});
