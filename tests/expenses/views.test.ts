import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, matterScopeFilterForMock } = vi.hoisted(() => ({
  prismaMock: {
    expense: { findMany: vi.fn() },
    matterAssignment: { count: vi.fn(), findMany: vi.fn() },
  },
  matterScopeFilterForMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/access", () => ({ matterScopeFilterFor: matterScopeFilterForMock }));

const { canSeeAmountsFrom, canSeeExpenseAmounts, amountVisibleMatterIds } = await import("@/lib/expenses/access");
const { buildExpenseWhere, listExpenses, readExpenseFilters, summarizeExpenses, toExpenseView } = await import(
  "@/lib/expenses/queries"
);
const { buildExpenseCsv } = await import("@/lib/expenses/csv");

const admin = { id: "u-admin", role: "ADMIN" as const };
const attorney = { id: "u-att", role: "ATTORNEY" as const };
const paralegal = { id: "u-para", role: "PARALEGAL" as const };
const staff = { id: "u-staff", role: "STAFF" as const };

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "e-1",
    matterId: "m-1",
    incurredOn: new Date("2026-10-01"),
    category: "FILING_FEE" as const,
    description: "Fictional filing fee",
    quantity: { toString: () => "1.000" },
    unitCostCents: 4500,
    totalCents: 4500,
    billable: true,
    voidedAt: null as Date | null,
    voidReason: null as string | null,
    createdAt: new Date("2026-10-01"),
    recordedById: "u-para",
    recordedBy: { name: "Priya Example" },
    responsibleUserId: null,
    responsibleUser: null,
    receiptDocumentId: null,
    receiptDocument: null,
    matter: { caseNumber: "24-CR-0001", client: { lastName: "Doe" } },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  matterScopeFilterForMock.mockImplementation(async (u: { role: string }) => (u.role === "ADMIN" ? {} : { matterId: { in: ["m-1"] } }));
});

describe("amount visibility rule", () => {
  it("is ADMIN, or an ATTORNEY assigned to the matter — never paralegal/staff, never an unassigned attorney", () => {
    expect(canSeeAmountsFrom(admin, false)).toBe(true);
    expect(canSeeAmountsFrom(attorney, true)).toBe(true);
    expect(canSeeAmountsFrom(attorney, false)).toBe(false);
    expect(canSeeAmountsFrom(paralegal, true)).toBe(false);
    expect(canSeeAmountsFrom(staff, true)).toBe(false);
  });

  it("checks the attorney's assignment on that specific matter", async () => {
    prismaMock.matterAssignment.count.mockResolvedValue(0);
    expect(await canSeeExpenseAmounts(attorney, "m-other")).toBe(false);
    expect(prismaMock.matterAssignment.count).toHaveBeenCalledWith({ where: { matterId: "m-other", userId: "u-att" } });
    expect(await canSeeExpenseAmounts(paralegal, "m-1")).toBe(false);
    expect(prismaMock.matterAssignment.count).toHaveBeenCalledTimes(1);
  });

  it("lists amount-visible matters: all for ADMIN, none for paralegal/staff", async () => {
    expect(await amountVisibleMatterIds(admin)).toBeNull();
    expect(await amountVisibleMatterIds(staff)).toEqual(new Set());
    prismaMock.matterAssignment.findMany.mockResolvedValue([{ matterId: "m-1" }]);
    expect(await amountVisibleMatterIds(attorney)).toEqual(new Set(["m-1"]));
  });
});

describe("toExpenseView", () => {
  it("omits every monetary field for viewers without amount visibility", () => {
    const view = toExpenseView(row({ unitCostCents: 987654, totalCents: 987654 }) as never, false);
    expect(view.amounts).toBeNull();
    const json = JSON.stringify(view);
    expect(json).not.toContain("987654");
    expect(json).not.toContain("unitCostCents");
    expect(view.description).toBe("Fictional filing fee");
  });

  it("includes amounts for viewers who may see them", () => {
    expect(toExpenseView(row() as never, true).amounts).toEqual({ quantity: "1.000", unitCostCents: 4500, totalCents: 4500 });
  });
});

describe("listExpenses", () => {
  it("scopes to accessible matters and gates amounts per row by matter", async () => {
    prismaMock.matterAssignment.findMany.mockResolvedValue([{ matterId: "m-1" }]);
    prismaMock.expense.findMany.mockResolvedValue([row({ id: "a", matterId: "m-1" }), row({ id: "b", matterId: "m-2" })]);
    const { views, totals } = await listExpenses(attorney, {});
    expect(prismaMock.expense.findMany.mock.calls[0]![0].where.AND[0]).toEqual({ matterId: { in: ["m-1"] } });
    expect(views.find((v) => v.id === "a")?.amounts).not.toBeNull();
    expect(views.find((v) => v.id === "b")?.amounts).toBeNull();
    expect(totals.counted).toBe(1);
  });

  it("never reveals amounts to paralegals, even on their own matter", async () => {
    prismaMock.expense.findMany.mockResolvedValue([row()]);
    const { views, totals } = await listExpenses(paralegal, { matterId: "m-1" });
    expect(views[0]!.amounts).toBeNull();
    expect(totals).toMatchObject({ totalCents: 0, counted: 0 });
  });

  it("ANDs a forged matter filter with the viewer's scope (never widens access)", async () => {
    prismaMock.expense.findMany.mockResolvedValue([]);
    await listExpenses(staff, { matterId: "m-forged" });
    const where = prismaMock.expense.findMany.mock.calls[0]![0].where;
    expect(where.AND).toContainEqual({ matterId: { in: ["m-1"] } });
    expect(where.AND).toContainEqual({ matterId: "m-forged" });
  });
});

describe("filters and totals", () => {
  it("excludes voided rows by default and parses filters strictly", () => {
    const where = buildExpenseWhere({}, readExpenseFilters({ category: "NOT_REAL", billable: "x", from: "garbage", to: "2026-10-31" }));
    expect(where.AND).toContainEqual({ voidedAt: null });
    expect(JSON.stringify(where)).not.toContain("NOT_REAL");
    expect(where.AND).toContainEqual({ incurredOn: { lte: new Date("2026-10-31") } });
    expect(JSON.stringify(where)).not.toContain("garbage");
  });

  it("totals only non-voided rows with visible amounts, split by billable and category", () => {
    const views = [
      toExpenseView(row({ id: "1", totalCents: 1000, billable: true }) as never, true),
      toExpenseView(row({ id: "2", totalCents: 250, billable: false, category: "POSTAGE" }) as never, true),
      toExpenseView(row({ id: "3", totalCents: 9999, voidedAt: new Date() }) as never, true),
      toExpenseView(row({ id: "4", totalCents: 7777 }) as never, false),
    ];
    const totals = summarizeExpenses(views);
    expect(totals).toMatchObject({ totalCents: 1250, billableCents: 1000, nonbillableCents: 250, counted: 2 });
    expect(totals.byCategory).toEqual([
      { category: "FILING_FEE", totalCents: 1000, count: 1 },
      { category: "POSTAGE", totalCents: 250, count: 1 },
    ]);
  });
});

describe("buildExpenseCsv", () => {
  it("fills amount cells only for rows whose amounts are visible", () => {
    const csv = buildExpenseCsv([
      toExpenseView(row({ id: "1", totalCents: 4500 }) as never, true),
      toExpenseView(row({ id: "2", unitCostCents: 31337, totalCents: 31337 }) as never, false),
    ]);
    const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[1]).toContain(",1.000,45.00,45.00,");
    expect(lines[2]).not.toContain("313.37");
    expect(lines[2]).toContain(",Billable,,,,");
  });

  it("neutralizes formula injection in descriptions", () => {
    const csv = buildExpenseCsv([toExpenseView(row({ description: "=HYPERLINK(\"http://evil\")" }) as never, true)]);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });
});
