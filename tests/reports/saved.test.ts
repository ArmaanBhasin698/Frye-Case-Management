import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, matterIdFilterForMock, matterScopeFilterForMock } = vi.hoisted(() => ({
  prismaMock: {
    matter: { findMany: vi.fn() },
    task: { findMany: vi.fn() },
    timeEntry: { findMany: vi.fn() },
    userActivityEvent: { findMany: vi.fn() },
    customFieldDefinition: { findUnique: vi.fn() },
  },
  matterIdFilterForMock: vi.fn(),
  matterScopeFilterForMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/access", () => ({ matterIdFilterFor: matterIdFilterForMock, matterScopeFilterFor: matterScopeFilterForMock }));
vi.mock("@/lib/search", () => ({ collectSearchResults: vi.fn(async () => []) }));

const { canRunReportKind, customFieldCondition, parseReportFilters, runReport } = await import("@/lib/reports/saved");

const admin = { id: "u-admin", role: "ADMIN" as const };
const attorney = { id: "u-att", role: "ATTORNEY" as const };
const staff = { id: "u-staff", role: "STAFF" as const };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.matter.findMany.mockResolvedValue([]);
  prismaMock.task.findMany.mockResolvedValue([]);
  prismaMock.timeEntry.findMany.mockResolvedValue([]);
  prismaMock.userActivityEvent.findMany.mockResolvedValue([]);
  matterIdFilterForMock.mockResolvedValue({ id: { in: ["m1"] } });
  matterScopeFilterForMock.mockResolvedValue({ matterId: { in: ["m1"] } });
});

describe("parseReportFilters", () => {
  it("validates per kind and drops invalid optional values", () => {
    expect(parseReportFilters("TASKS", { status: "NOPE", priority: "HIGH", dueFrom: "yesterday" })).toEqual({
      ok: true,
      filters: { priority: "HIGH" },
    });
    expect(parseReportFilters("MATTERS", {})).toEqual({ ok: true, filters: { archived: "active" } });
  });

  it("requires a bounded query for SEARCH reports", () => {
    expect(parseReportFilters("SEARCH", { q: "a" }).ok).toBe(false);
    expect(parseReportFilters("SEARCH", { q: "x".repeat(101) }).ok).toBe(false);
    expect(parseReportFilters("SEARCH", { q: "ellis" }).ok).toBe(true);
  });

  it("rejects id-shaped injection attempts", () => {
    expect(parseReportFilters("TIME", { matterId: "m1' OR 1=1" })).toEqual({ ok: true, filters: {} });
  });
});

describe("USAGE reports are ADMIN-only at run time", () => {
  it("refuses non-admins even with valid filters", async () => {
    expect(canRunReportKind(attorney, "USAGE")).toBe(false);
    expect(await runReport(attorney, "USAGE", {})).toBeNull();
    expect(prismaMock.userActivityEvent.findMany).not.toHaveBeenCalled();
    expect(await runReport(admin, "USAGE", {})).not.toBeNull();
  });
});

describe("re-scoping on every run", () => {
  it("uses the running user's current matter scope, so a saved report loses matters when access is revoked", async () => {
    await runReport(attorney, "TASKS", { matterId: "m1" });
    expect(JSON.stringify(prismaMock.task.findMany.mock.calls[0]![0].where)).toContain(JSON.stringify({ matterId: { in: ["m1"] } }));

    // Access to m1 revoked: the same saved filters now run under an empty scope.
    matterScopeFilterForMock.mockResolvedValue({ matterId: { in: [] } });
    await runReport(attorney, "TASKS", { matterId: "m1" });
    const where = JSON.stringify(prismaMock.task.findMany.mock.calls[1]![0].where);
    expect(where).toContain(JSON.stringify({ matterId: { in: [] } }));
    expect(where).toContain(JSON.stringify({ matterId: "m1" }));
  });

  it("MATTERS reports AND the scope with stage/status/archive filters", async () => {
    await runReport(staff, "MATTERS", { stageId: "stage-1", status: "OPEN", archived: "active" });
    const where = prismaMock.matter.findMany.mock.calls[0]![0].where;
    expect(where.AND).toContainEqual({ id: { in: ["m1"] } });
    expect(where.AND).toContainEqual({ stageId: "stage-1" });
    expect(where.AND).toContainEqual({ archived: false });
  });
});

describe("TIME report amounts", () => {
  const entry = {
    workDate: new Date("2026-05-01"),
    durationMinutes: 90,
    category: "DRAFTING",
    billable: true,
    description: "=HYPERLINK(\"http://evil\")",
    hourlyRateCents: 25_000,
    user: { name: "Sarah" },
    matter: { caseNumber: "CN-1", client: { lastName: "Ellis" } },
  };

  it("includes rate and amount columns only for ADMIN", async () => {
    prismaMock.timeEntry.findMany.mockResolvedValue([entry]);
    const forAttorney = (await runReport(attorney, "TIME", {}))!;
    expect(forAttorney.columns).not.toContain("Amount");
    expect(forAttorney.rows[0]).toHaveLength(7);
    const forAdmin = (await runReport(admin, "TIME", {}))!;
    expect(forAdmin.columns).toEqual(expect.arrayContaining(["Hourly rate", "Amount"]));
    expect(forAdmin.rows[0]!.slice(-2)).toEqual(["250.00", "375.00"]);
  });

  it("excludes voided and draft entries", async () => {
    await runReport(attorney, "TIME", {});
    expect(prismaMock.timeEntry.findMany.mock.calls[0]![0].where.AND).toContainEqual({ voidedAt: null, status: "SUBMITTED" });
  });
});

describe("customFieldCondition", () => {
  it("matches nothing for a forged or non-matter definition (never widens)", () => {
    expect(customFieldCondition(null, "def-x", "a")).toEqual({ id: { in: [] } });
    expect(customFieldCondition({ entity: "CONTACT", type: "SHORT_TEXT" }, "def-x", "a")).toEqual({ id: { in: [] } });
  });

  it("compares by the definition's type", () => {
    expect(customFieldCondition({ entity: "MATTER", type: "BOOLEAN" }, "d", "true")).toEqual({
      customFieldValues: { some: { definitionId: "d", valueBoolean: true } },
    });
    expect(customFieldCondition({ entity: "MATTER", type: "NUMBER" }, "d", "abc")).toEqual({ id: { in: [] } });
    expect(
      customFieldCondition(
        { entity: "MATTER", type: "SINGLE_SELECT", options: [{ id: "opt-1", label: "Felony", archived: true }] },
        "d",
        "felony",
      ),
    ).toEqual({ customFieldValues: { some: { definitionId: "d", valueOptionId: "opt-1" } } });
  });
});
