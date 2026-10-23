import { describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";

vi.mock("@/lib/db", () => ({ prisma: {} }));

const { renderMatterTimePdf, renderFirmUtilizationPdf, parseDateRange } = await import("@/lib/reports/time-reports");
const { renderEmployeeActivityPdf } = await import("@/lib/reports/employee-activity");
const { toWinAnsi } = await import("@/lib/reports/pdf");

const range = { from: new Date("2026-09-01T00:00:00"), to: new Date("2026-09-30T23:59:59") };

function entry(i: number) {
  return {
    userId: `u${i % 3}`,
    userName: ["Jane Doe", "John Roe", "Pat Example"][i % 3]!,
    matterId: `m${i % 4}`,
    matterLabel: `25-CR-0000${i % 4} — State v. Test`,
    workDate: new Date(2026, 8, 1 + (i % 28)),
    durationMinutes: 30 + (i % 5) * 15,
    billable: i % 4 !== 0,
    category: "DISCOVERY_REVIEW" as const,
    hourlyRateCents: 25_000,
    voidedAt: null,
    status: "SUBMITTED",
    description: `Fictional work item ${i} — reviewed exhibits and drafted a summary memo for the file.`,
  };
}

async function pageCount(bytes: Uint8Array) {
  return (await PDFDocument.load(bytes)).getPageCount();
}

describe("PDF rendering", () => {
  const matter = { caseNumber: "25-CR-01044", title: "State v. Test", court: "Example County Court (fictional)", status: "OPEN" };

  it("renders a valid one-page matter report with no entries (says so, invents nothing)", async () => {
    const bytes = await renderMatterTimePdf({ matter, range, includeAmounts: false, entries: [] });
    expect(await pageCount(bytes)).toBe(1);
  });

  it("paginates a long matter report across several pages", async () => {
    const entries = Array.from({ length: 150 }, (_, i) => entry(i));
    const bytes = await renderMatterTimePdf({ matter, range, includeAmounts: true, entries });
    expect(await pageCount(bytes)).toBeGreaterThan(2);
  });

  it("renders the firm utilization and employee activity reports", async () => {
    const entries = Array.from({ length: 40 }, (_, i) => entry(i));
    expect(await pageCount(await renderFirmUtilizationPdf({ range, entries }))).toBeGreaterThan(0);
    const activity = await renderEmployeeActivityPdf({
      employee: { name: "Jane Doe", email: "jane.doe@example.com", role: "ATTORNEY" },
      range,
      sessions: [{ startedAt: new Date(2026, 8, 2, 9), lastSeenAt: new Date(2026, 8, 2, 12), endedAt: null, endReason: null }],
      events: [],
      estimatedActiveMinutes: 95,
      activeMinutesByMatter: [],
      timeEntries: entries.slice(0, 5),
    });
    expect(await pageCount(activity)).toBeGreaterThan(0);
  });

  it("replaces characters the standard PDF fonts can't encode instead of failing", async () => {
    expect(toWinAnsi("Résumé — “ok” 😀 漢")).toBe("Résumé — “ok” ? ?");
    const bytes = await renderMatterTimePdf({
      matter,
      range,
      includeAmounts: false,
      entries: [{ ...entry(1), description: "Emoji 😀 and 漢字 in a note" }],
    });
    expect(await pageCount(bytes)).toBe(1);
  });
});

describe("parseDateRange", () => {
  it("defaults to the last 30 days and rejects malformed or inverted ranges", () => {
    const now = new Date("2026-10-23T12:00:00");
    const r = parseDateRange(null, null, now)!;
    expect(Math.round((r.to.getTime() - r.from.getTime()) / 86_400_000)).toBe(31);
    expect(parseDateRange("2026-13-01", null)).toBeNull();
    expect(parseDateRange("2026-10-10", "2026-10-01")).toBeNull();
    expect(parseDateRange("Robert'); DROP", null)).toBeNull();
  });
});
