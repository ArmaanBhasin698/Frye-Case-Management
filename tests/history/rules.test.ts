import { describe, expect, it } from "vitest";

import { buildClosureReportFilter, buildObservationFilter, buildRulingFilter, canAuthorProfessionalHistory } from "@/lib/history/visibility";
import { readClosureFields, readObservationFields, rulingsAccountedFor } from "@/lib/history/fields";
import { buildRulingHistoryWhere, summarizeRulings } from "@/lib/history/queries";

const admin = { id: "a", role: "ADMIN" as const };
const attorney = { id: "t", role: "ATTORNEY" as const };
const paralegal = { id: "p", role: "PARALEGAL" as const };

function fd(fields: Record<string, string | string[]>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}

describe("professional-history visibility", () => {
  it("scopes rulings and closure reports to assigned matters (admins unrestricted)", () => {
    expect(buildRulingFilter(admin, [])).toEqual({});
    expect(buildRulingFilter(attorney, ["m1"])).toEqual({ matterId: { in: ["m1"] } });
    expect(buildClosureReportFilter(paralegal, ["m1"])).toEqual({ matterId: { in: ["m1"] } });
  });

  it("shows firm-wide reference notes to attorneys only, and only matterless ones", () => {
    expect(buildObservationFilter(attorney, ["m1"])).toEqual({
      OR: [{ shareScope: "MATTER_ONLY", matterId: { in: ["m1"] } }, { shareScope: "FIRM_ATTORNEYS", matterId: null }],
    });
    expect(buildObservationFilter(paralegal, ["m1"])).toEqual({ shareScope: "MATTER_ONLY", matterId: { in: ["m1"] } });
  });

  it("limits authoring to ADMIN/ATTORNEY", () => {
    expect(canAuthorProfessionalHistory(attorney)).toBe(true);
    expect(canAuthorProfessionalHistory(paralegal)).toBe(false);
  });
});

describe("observation validation", () => {
  const base = { subjectContactId: "c1", category: "SCHEDULING", kind: "PROCEDURAL_OBSERVATION", body: "Prefers early filings." };

  it("defaults to matter-restricted and then requires a matter", () => {
    expect(readObservationFields(fd(base)).success).toBe(false);
    const ok = readObservationFields(fd({ ...base, matterId: "m1" }));
    expect(ok.success && ok.data.shareScope).toBe("MATTER_ONLY");
  });

  it("requires explicit confirmation to share firm-wide, and strips any matter", () => {
    expect(readObservationFields(fd({ ...base, shareScope: "FIRM_ATTORNEYS", matterId: "m1" })).success).toBe(false);
    const ok = readObservationFields(fd({ ...base, shareScope: "FIRM_ATTORNEYS", matterId: "m1", confirmNoPrivileged: "on" }));
    expect(ok.success && ok.data.matterId).toBeUndefined();
  });
});

describe("closure validation", () => {
  const plea = {
    matterId: "m1",
    closureDate: "2026-10-01",
    charges: "Burglary (fictional)",
    disposition: "PLEA_AGREEMENT",
    resolutionProcedure: "PLEA",
    outcomeSummary: "Plea to a reduced charge.",
    reviewedObservations: "on",
  };

  it("accepts a non-trial resolution without any trial fields", () => {
    const r = readClosureFields(fd(plea));
    expect(r.success).toBe(true);
    expect(r.success && r.data.trial).toBeUndefined();
  });

  it("requires the core fields", () => {
    expect(readClosureFields(fd({ ...plea, outcomeSummary: "" })).success).toBe(false);
    expect(readClosureFields(fd({ ...plea, disposition: "MADE_UP" })).success).toBe(false);
  });

  it("requires review of professional-history observations", () => {
    const { reviewedObservations: _omit, ...rest } = plea;
    expect(readClosureFields(fd(rest)).success).toBe(false);
  });

  it("requires a documented reason for an administrative closure", () => {
    expect(readClosureFields(fd({ ...plea, disposition: "ADMINISTRATIVE_CLOSURE" })).success).toBe(false);
    expect(readClosureFields(fd({ ...plea, disposition: "ADMINISTRATIVE_CLOSURE", exceptionReason: "Client deceased" })).success).toBe(true);
  });

  it("requires a complete trial report, with at least one verdict, when the matter went to trial", () => {
    const trial = { ...plea, disposition: "ACQUITTAL", resolutionProcedure: "TRIAL" };
    expect(readClosureFields(fd(trial)).success).toBe(false);
    const complete = readClosureFields(
      fd({
        ...trial,
        trialStartDate: "2026-09-01",
        trialEndDate: "2026-09-03",
        trialType: "JURY",
        chargesTried: "Count 1",
        trialSummary: "Jury acquitted.",
        verdictCharge: ["Count 1"],
        verdictResult: ["NOT_GUILTY"],
      }),
    );
    expect(complete.success).toBe(true);
    expect(complete.success && complete.data.trial?.verdicts).toEqual([{ charge: "Count 1", verdict: "NOT_GUILTY" }]);
    expect(
      readClosureFields(fd({ ...trial, trialStartDate: "2026-09-05", trialEndDate: "2026-09-01", trialType: "BENCH", chargesTried: "x", trialSummary: "y", verdictCharge: ["x"], verdictResult: ["GUILTY"] })).success,
    ).toBe(false);
  });

  it("needs rulings recorded, an explicit none, or a documented exception", () => {
    expect(rulingsAccountedFor({ noSignificantRulings: false, exceptionReason: undefined }, 0)).toBe(false);
    expect(rulingsAccountedFor({ noSignificantRulings: true, exceptionReason: undefined }, 0)).toBe(true);
    expect(rulingsAccountedFor({ noSignificantRulings: false, exceptionReason: "File incomplete" }, 0)).toBe(true);
    expect(rulingsAccountedFor({ noSignificantRulings: false, exceptionReason: undefined }, 2)).toBe(true);
  });
});

describe("ruling history aggregation", () => {
  it("reports counts with sample size and date range — no percentages", () => {
    const s = summarizeRulings([
      { issueType: "MOTION_TO_SUPPRESS", result: "DENIED", rulingDate: new Date("2025-01-01") },
      { issueType: "MOTION_TO_SUPPRESS", result: "GRANTED", rulingDate: new Date("2026-01-01") },
      { issueType: "BOND_MODIFICATION", result: "GRANTED", rulingDate: new Date("2025-06-01") },
    ]);
    expect(s.sampleSize).toBe(3);
    expect(s.from).toEqual(new Date("2025-01-01"));
    expect(s.to).toEqual(new Date("2026-01-01"));
    expect(s.byIssue[0]).toEqual({ issueType: "MOTION_TO_SUPPRESS", total: 2, byResult: { DENIED: 1, GRANTED: 1 } });
    expect(JSON.stringify(s)).not.toMatch(/percent|rate/i);
  });

  it("always keeps the caller's matter scope and only current versions when filtering", () => {
    const where = buildRulingHistoryWhere("judge-1", { matterId: { in: ["m1"] } }, { issueType: "CONTINUANCE", matterId: "m9" });
    expect(where.AND).toContainEqual({ judgeContactId: "judge-1", supersededAt: null });
    expect(where.AND).toContainEqual({ matterId: { in: ["m1"] } });
    expect(where.AND).toContainEqual({ issueType: "CONTINUANCE" });
  });
});
