import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { Prisma } from "@prisma/client";

import { isKnownToken, parseTokens, renderTemplate, validateTemplateBody } from "@/lib/documents/templates";
import { UnsupportedCharactersError, findUnsupportedCharacters, renderGeneratedPdf } from "@/lib/documents/generated-pdf";
import { formatCustomValue } from "@/lib/documents/merge-data";
import { extractText } from "@/lib/documents/extraction";

const catalog = { customMatterKeys: ["arrest_agency"], customClientKeys: ["preferred_name"] };

describe("template tokens", () => {
  it("parses unique tokens and validates them against the explicit catalog", () => {
    expect(parseTokens("Dear {{client.fullName}}, re {{ matter.caseNumber }} {{client.fullName}}")).toEqual([
      "client.fullName",
      "matter.caseNumber",
    ]);
    expect(isKnownToken("contact.JUDGE.displayName", catalog)).toBe(true);
    expect(isKnownToken("custom.matter.arrest_agency", catalog)).toBe(true);
    expect(isKnownToken("custom.matter.not_defined", catalog)).toBe(false);
    expect(isKnownToken("client.ssn", catalog)).toBe(false);
  });

  it("rejects unknown tokens instead of silently rendering blanks", () => {
    const v = validateTemplateBody("Hello {{client.ssn}} and {{matter.secretNotes}}", catalog);
    expect(v.unknown).toEqual(["client.ssn", "matter.secretNotes"]);
    expect(v.error).toMatch(/Unknown merge fields/);
    expect(validateTemplateBody("   ", catalog).error).toMatch(/required/);
  });

  it("lists missing values and keeps tokens visible unless leaving blank is chosen", () => {
    const body = "Client: {{client.fullName}}\nEmail: {{client.email}}";
    const values = { "client.fullName": "Jane Doe", "client.email": null };
    expect(renderTemplate(body, values)).toEqual({ text: "Client: Jane Doe\nEmail: {{client.email}}", missing: ["client.email"] });
    expect(renderTemplate(body, values, { leaveBlank: true }).text).toBe("Client: Jane Doe\nEmail: ");
  });

  it("formats custom values by definition type, resolving retired select options by id", () => {
    const base = { valueText: null, valueNumber: null, valueBoolean: null, valueDate: null, valueOptionId: null };
    expect(formatCustomValue({ ...base, valueBoolean: true, definition: { key: "k", type: "BOOLEAN", options: null } })).toBe("Yes");
    expect(
      formatCustomValue({ ...base, valueNumber: new Prisma.Decimal("12.5"), definition: { key: "k", type: "NUMBER", options: null } }),
    ).toBe("12.5");
    expect(
      formatCustomValue({
        ...base,
        valueOptionId: "o2",
        definition: { key: "k", type: "SINGLE_SELECT", options: [{ id: "o2", label: "Sheriff", archived: true }] },
      }),
    ).toBe("Sheriff");
    expect(formatCustomValue({ ...base, valueDate: new Date("2026-03-04T00:00:00Z"), definition: { key: "k", type: "DATE", options: null } })).toBe(
      "March 4, 2026",
    );
  });
});

describe("generated PDF output", () => {
  it("produces a valid PDF whose text is extractable, with Latin-1 non-ASCII preserved", async () => {
    const bytes = await renderGeneratedPdf({
      title: "Fictional client letter",
      subtitle: "24-CR-00000",
      body: "Dear Zoë Müller,\nWe write about your matter — “confidential”.",
      replaceUnsupported: false,
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const extracted = await extractText(Buffer.from(bytes), "application/pdf", "out.pdf");
    expect(extracted.text).toContain("Zoë Müller");
    expect(extracted.text).toContain("FRYE LAW GROUP");
  });

  it("paginates long bodies with page numbers", async () => {
    const body = Array.from({ length: 150 }, (_, i) => `Fictional paragraph line ${i + 1}.`).join("\n");
    const bytes = await renderGeneratedPdf({ title: "Long", subtitle: "x", body, replaceUnsupported: false });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
    const text = (await extractText(Buffer.from(bytes), "application/pdf", "o.pdf")).text ?? "";
    expect(text).toContain(`Page ${doc.getPageCount()} of ${doc.getPageCount()}`);
  });

  it("reports characters the font can't print instead of dropping them, and transliterates common symbols", async () => {
    // "ó" is Latin-1 (printable); "Ł" and "ź" are not; "→" and "≥" are transliterated.
    expect(await findUnsupportedCharacters("Łódź → ok ≥ 3")).toEqual(["Ł", "ź"]);
    await expect(renderGeneratedPdf({ title: "T", subtitle: "s", body: "Witness Łukasz", replaceUnsupported: false })).rejects.toBeInstanceOf(
      UnsupportedCharactersError,
    );
    const bytes = await renderGeneratedPdf({ title: "T", subtitle: "s", body: "Witness Łukasz → court", replaceUnsupported: true });
    const text = (await extractText(Buffer.from(bytes), "application/pdf", "o.pdf")).text ?? "";
    expect(text).toContain("Witness ?ukasz -> court");
  });
});

// --- Actions ---------------------------------------------------------------------------

const { requireCurrentUserMock, hasMatterAccessMock, prismaMock, storeMock, buildMergeValuesMock, getMergeCatalogMock, redirectMock } =
  vi.hoisted(() => ({
    requireCurrentUserMock: vi.fn(),
    hasMatterAccessMock: vi.fn(),
    buildMergeValuesMock: vi.fn(),
    getMergeCatalogMock: vi.fn(),
    redirectMock: vi.fn(() => {
      throw new Error("NEXT_REDIRECT");
    }),
    storeMock: { save: vi.fn(), read: vi.fn() },
    prismaMock: {
      documentTemplate: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
      documentTemplateVersion: { findUnique: vi.fn(), create: vi.fn() },
      documentFolder: { count: vi.fn() },
      document: { create: vi.fn(), update: vi.fn() },
      documentVersion: { create: vi.fn() },
      auditEvent: { create: vi.fn() },
      $transaction: vi.fn(),
    },
  }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/auth/session", () => ({ requireCurrentUser: requireCurrentUserMock }));
vi.mock("@/lib/auth/access", () => ({ hasMatterAccess: hasMatterAccessMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/storage/DocumentStore", () => ({ documentStore: storeMock }));
vi.mock("@/lib/documents/schedule", () => ({ scheduleIndexing: vi.fn() }));
vi.mock("@/lib/documents/indexing", () => ({ reindexPending: vi.fn(async () => 0) }));
vi.mock("@/lib/documents/merge-data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/documents/merge-data")>()),
  buildMergeValues: buildMergeValuesMock,
  getMergeCatalog: getMergeCatalogMock,
}));

const { generateDocumentFromTemplate, saveDocumentTemplate } = await import("@/lib/documents/template-actions");

const admin = { id: "u-admin", role: "ADMIN" as const, name: "Alex Rivera" };
const paralegal = { id: "u-para", role: "PARALEGAL" as const, name: "Priya Nair" };
const NOT_FOUND = "Not found or access denied.";
const fd = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  redirectMock.mockImplementation(() => {
    throw new Error("NEXT_REDIRECT");
  });
  hasMatterAccessMock.mockResolvedValue(true);
  getMergeCatalogMock.mockResolvedValue({ ...catalog, customLabels: {} });
  prismaMock.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(prismaMock));
  prismaMock.document.create.mockResolvedValue({ id: "doc-gen" });
  prismaMock.documentVersion.create.mockResolvedValue({ id: "ver-gen" });
  prismaMock.documentTemplateVersion.findUnique.mockResolvedValue({
    id: "tv-1",
    version: 2,
    body: "Dear {{client.fullName}},\nRegarding {{matter.caseNumber}}. Phone: {{client.phone}}",
    template: { id: "tpl-1", status: "ACTIVE", category: "CORRESPONDENCE" },
  });
  buildMergeValuesMock.mockResolvedValue({
    "client.fullName": "Jane Doe",
    "matter.caseNumber": "24-CR-00001",
    "client.phone": null,
    today: "October 23, 2026",
  });
});

describe("saveDocumentTemplate", () => {
  it("is ADMIN-only and rejects unknown merge fields", async () => {
    requireCurrentUserMock.mockResolvedValue(paralegal);
    expect((await saveDocumentTemplate({ error: null }, fd({ name: "Letter", category: "CORRESPONDENCE", body: "Hi" }))).error).toBe(NOT_FOUND);
    requireCurrentUserMock.mockResolvedValue(admin);
    expect(
      (await saveDocumentTemplate({ error: null }, fd({ name: "Letter", category: "CORRESPONDENCE", body: "{{client.ssn}}" }))).error,
    ).toMatch(/Unknown merge field/);
  });

  it("creates a new immutable version only when the body changes", async () => {
    requireCurrentUserMock.mockResolvedValue(admin);
    prismaMock.documentTemplate.findUnique.mockResolvedValue({ id: "tpl-1", versions: [{ version: 3, body: "Same {{today}}" }] });
    await saveDocumentTemplate({ error: null }, fd({ templateId: "tpl-1", name: "Renamed", category: "CORRESPONDENCE", body: "Same {{today}}" }));
    expect(prismaMock.documentTemplateVersion.create).not.toHaveBeenCalled();
    await saveDocumentTemplate({ error: null }, fd({ templateId: "tpl-1", name: "Renamed", category: "CORRESPONDENCE", body: "New {{today}}" }));
    expect(prismaMock.documentTemplateVersion.create).toHaveBeenCalledWith({
      data: { templateId: "tpl-1", version: 4, body: "New {{today}}", createdById: admin.id },
    });
  });
});

describe("generateDocumentFromTemplate", () => {
  const base = { matterId: "m-1", templateVersionId: "tv-1", title: "Client letter" };

  it("requires matter access (any assigned role, same as upload)", async () => {
    requireCurrentUserMock.mockResolvedValue(paralegal);
    hasMatterAccessMock.mockResolvedValue(false);
    expect((await generateDocumentFromTemplate({ error: null }, fd(base))).error).toBe(NOT_FOUND);
    expect(storeMock.save).not.toHaveBeenCalled();
  });

  it("refuses archived templates and folders from another matter", async () => {
    requireCurrentUserMock.mockResolvedValue(paralegal);
    prismaMock.documentTemplateVersion.findUnique.mockResolvedValueOnce({
      id: "tv-1",
      version: 1,
      body: "x",
      template: { id: "tpl-1", status: "ARCHIVED", category: "OTHER" },
    });
    expect((await generateDocumentFromTemplate({ error: null }, fd(base))).error).toBe(NOT_FOUND);
    prismaMock.documentFolder.count.mockResolvedValue(0);
    expect((await generateDocumentFromTemplate({ error: null }, fd({ ...base, folderId: "foreign" }))).error).toBe(NOT_FOUND);
  });

  it("blocks generation while values are missing unless 'leave blank' is explicitly confirmed", async () => {
    requireCurrentUserMock.mockResolvedValue(paralegal);
    expect((await generateDocumentFromTemplate({ error: null }, fd(base))).error).toMatch(/Missing values for: \{\{client.phone\}\}/);
    expect(storeMock.save).not.toHaveBeenCalled();
  });

  it("stores a normal Document + v1 with template provenance, without touching the template, and audits no text", async () => {
    requireCurrentUserMock.mockResolvedValue(paralegal);
    await expect(generateDocumentFromTemplate({ error: null }, fd({ ...base, leaveBlank: "on" }))).rejects.toThrow("NEXT_REDIRECT");
    const [key, bytes] = storeMock.save.mock.calls[0]!;
    expect(key).toMatch(/^matters\/m-1\/documents\/.+\/original$/);
    expect((await extractText(bytes as Buffer, "application/pdf", "g.pdf")).text).toContain("Dear Jane Doe");
    expect(prismaMock.document.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        matterId: "m-1",
        mimeType: "application/pdf",
        generatedFromTemplateVersionId: "tv-1",
        uploadedById: paralegal.id,
        category: "CORRESPONDENCE",
      }),
    });
    expect(prismaMock.documentVersion.create).toHaveBeenCalledWith({ data: expect.objectContaining({ documentId: "doc-gen", version: 1 }) });
    expect(prismaMock.documentTemplate.update).not.toHaveBeenCalled();
    expect(prismaMock.documentTemplateVersion.create).not.toHaveBeenCalled();
    const audit = JSON.stringify(prismaMock.auditEvent.create.mock.calls);
    expect(audit).not.toContain("Jane Doe");
    expect(audit).toContain('"templateVersion":2');
  });
});
