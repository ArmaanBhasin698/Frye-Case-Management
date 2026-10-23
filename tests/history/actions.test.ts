import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireCurrentUserMock, canEditMatterMock, hasMatterAccessMock, canViewContactMock, isContactOnMatterMock, prismaMock } =
  vi.hoisted(() => ({
    requireCurrentUserMock: vi.fn(),
    canEditMatterMock: vi.fn(),
    hasMatterAccessMock: vi.fn(),
    canViewContactMock: vi.fn(),
    isContactOnMatterMock: vi.fn(),
    prismaMock: {
      contact: { findUnique: vi.fn() },
      document: { count: vi.fn() },
      user: { count: vi.fn() },
      matter: { findUnique: vi.fn(), update: vi.fn() },
      judicialRuling: { count: vi.fn(), create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
      professionalObservation: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
      matterClosureReport: { findFirst: vi.fn(), aggregate: vi.fn(), create: vi.fn(), update: vi.fn() },
      auditEvent: { create: vi.fn() },
      $transaction: vi.fn(),
    },
  }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireCurrentUser: requireCurrentUserMock }));
vi.mock("@/lib/auth/access", () => ({ canEditMatter: canEditMatterMock, hasMatterAccess: hasMatterAccessMock }));
vi.mock("@/lib/contacts/visibility", () => ({ canViewContact: canViewContactMock }));
vi.mock("@/lib/contacts/queries", () => ({ isContactOnMatter: isContactOnMatterMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

const { closeMatter, correctObservation, correctRuling, recordObservation, recordRuling, reopenMatter, amendClosureReport, backfillClosureReport } =
  await import("@/lib/history/actions");

const attorney = { id: "u-att", role: "ATTORNEY" as const };
const paralegal = { id: "u-para", role: "PARALEGAL" as const };
const NOT_FOUND = "Not found or access denied.";

function fd(fields: Record<string, string | string[]>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}
const audits = () => prismaMock.auditEvent.create.mock.calls.map((c) => c[0].data);

const ruling = {
  matterId: "m1",
  judgeContactId: "judge-1",
  rulingDate: "2026-05-01",
  court: "Example County Superior Court (fictional)",
  proceedingType: "MOTION_HEARING",
  issueType: "MOTION_TO_SUPPRESS",
  result: "DENIED",
  context: "Privileged strategy discussion about the stop.",
};

const closure = {
  matterId: "m1",
  closureDate: "2026-10-01",
  charges: "Burglary (fictional)",
  disposition: "PLEA_AGREEMENT",
  resolutionProcedure: "PLEA",
  outcomeSummary: "Confidential summary of the plea.",
  reviewedObservations: "on",
};

beforeEach(() => {
  vi.clearAllMocks();
  requireCurrentUserMock.mockResolvedValue(attorney);
  canEditMatterMock.mockResolvedValue(true);
  hasMatterAccessMock.mockResolvedValue(true);
  canViewContactMock.mockResolvedValue(true);
  isContactOnMatterMock.mockResolvedValue(true);
  prismaMock.contact.findUnique.mockResolvedValue({ categories: ["JUDGE"] });
  prismaMock.judicialRuling.count.mockResolvedValue(0);
  prismaMock.judicialRuling.create.mockResolvedValue({ id: "r-new", version: 2 });
  prismaMock.professionalObservation.create.mockResolvedValue({ id: "o-new", version: 1, matterId: "m1", shareScope: "MATTER_ONLY" });
  prismaMock.matter.findUnique.mockResolvedValue({ id: "m1", status: "OPEN", openedDate: new Date("2026-01-01"), closureReviewStatus: "NOT_APPLICABLE" });
  prismaMock.matterClosureReport.findFirst.mockResolvedValue(null);
  prismaMock.matterClosureReport.aggregate.mockResolvedValue({ _max: { version: null } });
  prismaMock.matterClosureReport.create.mockResolvedValue({ id: "rep-1" });
  prismaMock.user.count.mockResolvedValue(1);
  prismaMock.$transaction.mockImplementation((arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: unknown) => unknown)(prismaMock) : Promise.all(arg as Promise<unknown>[]),
  );
});

describe("recordRuling", () => {
  it("requires edit rights on the matter (forged/inaccessible matter → generic denial)", async () => {
    canEditMatterMock.mockResolvedValue(false);
    expect((await recordRuling({ error: null }, fd(ruling))).error).toBe(NOT_FOUND);
    expect(prismaMock.judicialRuling.create).not.toHaveBeenCalled();
  });

  it("requires a JUDGE contact actually on the matter", async () => {
    prismaMock.contact.findUnique.mockResolvedValue({ categories: ["WITNESS"] });
    expect((await recordRuling({ error: null }, fd(ruling))).error).toMatch(/judge who is linked/);
    prismaMock.contact.findUnique.mockResolvedValue({ categories: ["JUDGE"] });
    isContactOnMatterMock.mockResolvedValue(false);
    expect((await recordRuling({ error: null }, fd(ruling))).error).toMatch(/judge who is linked/);
  });

  it("rejects a supporting document from another matter", async () => {
    prismaMock.document.count.mockResolvedValue(0);
    expect((await recordRuling({ error: null }, fd({ ...ruling, documentId: "doc-elsewhere" }))).error).toMatch(/document from this matter/);
  });

  it("refuses to record the same ruling twice", async () => {
    prismaMock.judicialRuling.count.mockResolvedValue(1);
    expect((await recordRuling({ error: null }, fd(ruling))).error).toMatch(/already recorded/);
    expect(prismaMock.judicialRuling.create).not.toHaveBeenCalled();
  });

  it("records the ruling linked to its matter and judge, with no context text in the audit log", async () => {
    expect((await recordRuling({ error: null }, fd(ruling))).error).toBeNull();
    expect(prismaMock.judicialRuling.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ matterId: "m1", judgeContactId: "judge-1", issueType: "MOTION_TO_SUPPRESS", recordedById: attorney.id }),
    });
    expect(JSON.stringify(audits())).not.toContain("Privileged");
  });
});

describe("correctRuling", () => {
  it("supersedes the old version instead of overwriting it", async () => {
    prismaMock.judicialRuling.findUnique.mockResolvedValue({ id: "r-1", matterId: "m1", judgeContactId: "judge-1", version: 1, result: "DENIED", supersededAt: null, closureReportId: null });
    prismaMock.judicialRuling.updateMany.mockResolvedValue({ count: 1 });
    const result = await correctRuling({ error: null }, fd({ ...ruling, rulingId: "r-1", result: "PARTIALLY_GRANTED", correctionReason: "Order re-read" }));
    expect(result.error).toBeNull();
    expect(prismaMock.judicialRuling.updateMany).toHaveBeenCalledWith({ where: { id: "r-1", supersededAt: null }, data: { supersededAt: expect.any(Date) } });
    expect(prismaMock.judicialRuling.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ version: 2, supersedesId: "r-1", correctionReason: "Order re-read", result: "PARTIALLY_GRANTED" }),
    });
  });

  it("requires a correction reason and refuses already-superseded versions", async () => {
    expect((await correctRuling({ error: null }, fd({ ...ruling, rulingId: "r-1" }))).error).toMatch(/Explain/);
    prismaMock.judicialRuling.findUnique.mockResolvedValue({ id: "r-1", supersededAt: new Date() });
    expect((await correctRuling({ error: null }, fd({ ...ruling, rulingId: "r-1", correctionReason: "x" }))).error).toBe(NOT_FOUND);
  });
});

describe("observations", () => {
  const obs = { subjectContactId: "judge-1", category: "SCHEDULING", kind: "PROCEDURAL_OBSERVATION", body: "Prefers courtesy copies.", matterId: "m1" };

  it("is attorney/admin-only", async () => {
    requireCurrentUserMock.mockResolvedValue(paralegal);
    expect((await recordObservation({ error: null }, fd(obs))).error).toBe(NOT_FOUND);
  });

  it("requires the subject contact to be visible and the matter accessible", async () => {
    canViewContactMock.mockResolvedValue(false);
    expect((await recordObservation({ error: null }, fd(obs))).error).toBe(NOT_FOUND);
    canViewContactMock.mockResolvedValue(true);
    hasMatterAccessMock.mockResolvedValue(false);
    expect((await recordObservation({ error: null }, fd(obs))).error).toBe(NOT_FOUND);
  });

  it("stores a firm-wide reference note with no matter, and never logs its body", async () => {
    expect((await recordObservation({ error: null }, fd({ ...obs, shareScope: "FIRM_ATTORNEYS", confirmNoPrivileged: "on" }))).error).toBeNull();
    expect(prismaMock.professionalObservation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ matterId: null, shareScope: "FIRM_ATTORNEYS", authorId: attorney.id }),
    });
    expect(hasMatterAccessMock).not.toHaveBeenCalled();
    expect(JSON.stringify(audits())).not.toContain("courtesy");
  });

  it("lets only the author (or ADMIN) correct an observation", async () => {
    prismaMock.professionalObservation.findUnique.mockResolvedValue({ id: "o-1", authorId: "someone-else", supersededAt: null, subjectContactId: "judge-1", matterId: "m1" });
    expect((await correctObservation({ error: null }, fd({ ...obs, observationId: "o-1", correctionReason: "typo" }))).error).toBe(NOT_FOUND);
  });
});

describe("closeMatter", () => {
  it("rejects users who can't edit the matter", async () => {
    canEditMatterMock.mockResolvedValue(false);
    expect((await closeMatter({ error: null }, fd(closure))).error).toBe(NOT_FOUND);
    expect(prismaMock.matter.update).not.toHaveBeenCalled();
  });

  it("won't close until significant rulings are accounted for", async () => {
    expect((await closeMatter({ error: null }, fd(closure))).error).toMatch(/Record the significant rulings/);
    expect(prismaMock.matterClosureReport.create).not.toHaveBeenCalled();
    expect(prismaMock.matter.update).not.toHaveBeenCalled();
  });

  it("rejects a judge who isn't on the matter", async () => {
    isContactOnMatterMock.mockResolvedValue(false);
    expect((await closeMatter({ error: null }, fd({ ...closure, noSignificantRulings: "on", judgeContactId: "judge-x" }))).error).toMatch(/contacts on this matter/);
  });

  it("rejects a closure date before the matter opened", async () => {
    expect((await closeMatter({ error: null }, fd({ ...closure, noSignificantRulings: "on", closureDate: "2025-01-01" }))).error).toMatch(/before the matter was opened/);
  });

  it("writes the report, links rulings, adds closing observations, and closes the matter in one transaction", async () => {
    prismaMock.judicialRuling.count.mockResolvedValue(2);
    const result = await closeMatter(
      { error: null },
      fd({ ...closure, judgeContactId: "judge-1", judgeObs_body: "Strict about exhibit lists." }),
    );
    expect(result.error).toBeNull();
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.matterClosureReport.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ matterId: "m1", version: 1, closingAttorneyId: attorney.id, disposition: "PLEA_AGREEMENT", trialOutcome: undefined }),
    });
    expect(prismaMock.judicialRuling.updateMany).toHaveBeenCalledWith({ where: { matterId: "m1", supersededAt: null }, data: { closureReportId: "rep-1" } });
    expect(prismaMock.professionalObservation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ subjectContactId: "judge-1", matterId: "m1", shareScope: "MATTER_ONLY", closureReportId: "rep-1" }),
    });
    expect(prismaMock.matter.update).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { status: "CLOSED", closedDate: new Date("2026-10-01"), closureReviewStatus: "COMPLETE" },
    });
    const text = JSON.stringify(audits());
    expect(text).not.toContain("Confidential summary");
    expect(text).not.toContain("exhibit lists");
  });

  it("refuses to close a matter that is already closed", async () => {
    prismaMock.matter.findUnique.mockResolvedValue({ id: "m1", status: "CLOSED", openedDate: new Date("2026-01-01") });
    expect((await closeMatter({ error: null }, fd({ ...closure, noSignificantRulings: "on" }))).error).toMatch(/already closed/);
  });
});

describe("amend / backfill / reopen", () => {
  it("amending supersedes the current report and creates the next version", async () => {
    prismaMock.matter.findUnique.mockResolvedValue({ id: "m1", status: "CLOSED", openedDate: new Date("2026-01-01") });
    prismaMock.matterClosureReport.findFirst.mockResolvedValue({ id: "rep-1", version: 1, isHistoricalBackfill: false });
    prismaMock.matterClosureReport.aggregate.mockResolvedValue({ _max: { version: 1 } });
    expect((await amendClosureReport({ error: null }, fd({ ...closure, noSignificantRulings: "on" }))).error).toMatch(/Explain why/);
    const result = await amendClosureReport({ error: null }, fd({ ...closure, noSignificantRulings: "on", amendmentReason: "Sentencing corrected" }));
    expect(result.error).toBeNull();
    expect(prismaMock.matterClosureReport.update).toHaveBeenCalledWith({ where: { id: "rep-1" }, data: { supersededAt: expect.any(Date) } });
    expect(prismaMock.matterClosureReport.create).toHaveBeenCalledWith({ data: expect.objectContaining({ version: 2, amendmentReason: "Sentencing corrected" }) });
  });

  it("backfill only applies to closed matters without a report, and is flagged as historical", async () => {
    expect((await backfillClosureReport({ error: null }, fd({ ...closure, noSignificantRulings: "on" }))).error).toMatch(/Backfill is only/);
    prismaMock.matter.findUnique.mockResolvedValue({ id: "m1", status: "CLOSED", openedDate: new Date("2026-01-01") });
    expect((await backfillClosureReport({ error: null }, fd({ ...closure, exceptionReason: "Historical file incomplete" }))).error).toBeNull();
    expect(prismaMock.matterClosureReport.create).toHaveBeenCalledWith({ data: expect.objectContaining({ isHistoricalBackfill: true }) });
  });

  it("reopening requires edit rights and a reason, and keeps the reports", async () => {
    canEditMatterMock.mockResolvedValue(false);
    expect((await reopenMatter({ error: null }, fd({ matterId: "m1", reason: "New evidence" }))).error).toBe(NOT_FOUND);
    canEditMatterMock.mockResolvedValue(true);
    prismaMock.matter.findUnique.mockResolvedValue({ status: "CLOSED" });
    expect((await reopenMatter({ error: null }, fd({ matterId: "m1", reason: "New evidence" }))).error).toBeNull();
    expect(prismaMock.matter.update).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { status: "OPEN", closedDate: null, closureReviewStatus: "NOT_APPLICABLE" },
    });
    expect(prismaMock.matterClosureReport.update).not.toHaveBeenCalled();
  });
});
