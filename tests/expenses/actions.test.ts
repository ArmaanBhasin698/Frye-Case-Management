import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const { requireCurrentUserMock, hasMatterAccessMock, canSeeExpenseAmountsMock, prismaMock } = vi.hoisted(() => ({
  requireCurrentUserMock: vi.fn(),
  hasMatterAccessMock: vi.fn(),
  canSeeExpenseAmountsMock: vi.fn(),
  prismaMock: {
    matter: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    document: { count: vi.fn() },
    expense: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
    auditEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireCurrentUser: requireCurrentUserMock }));
vi.mock("@/lib/auth/access", () => ({ hasMatterAccess: hasMatterAccessMock }));
vi.mock("@/lib/expenses/access", () => ({ canSeeExpenseAmounts: canSeeExpenseAmountsMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

const { createExpense, updateExpense, voidExpense } = await import("@/lib/expenses/actions");

const admin = { id: "u-admin", role: "ADMIN" as const };
const attorney = { id: "u-att", role: "ATTORNEY" as const };
const paralegal = { id: "u-para", role: "PARALEGAL" as const };
const staff = { id: "u-staff", role: "STAFF" as const };
const NOT_FOUND = "Not found or access denied.";

function fd(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
}
const audits = () => prismaMock.auditEvent.create.mock.calls.map((c) => c[0].data);

const valid = {
  matterId: "m-1",
  incurredOn: "2026-10-01",
  category: "EXPERT",
  description: "Fictional ballistics expert retainer — confidential",
  quantity: "2.5",
  unitCost: "3.33",
  billable: "on",
};

const existing = {
  id: "e-1",
  matterId: "m-1",
  incurredOn: new Date("2026-10-01"),
  category: "EXPERT",
  description: "Fictional ballistics expert retainer — confidential",
  billable: true,
  responsibleUserId: null,
  receiptDocumentId: null,
  quantity: new Prisma.Decimal("2.5"),
  unitCostCents: 333,
  totalCents: 833,
  recordedById: "u-para",
  voidedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  requireCurrentUserMock.mockResolvedValue(paralegal);
  hasMatterAccessMock.mockResolvedValue(true);
  canSeeExpenseAmountsMock.mockResolvedValue(false);
  prismaMock.matter.findUnique.mockResolvedValue({ status: "OPEN" });
  prismaMock.expense.create.mockResolvedValue({ id: "e-new" });
  prismaMock.expense.findUnique.mockResolvedValue(existing);
  prismaMock.$transaction.mockImplementation((arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: unknown) => unknown)(prismaMock) : Promise.all(arg as Promise<unknown>[]),
  );
});

describe("createExpense", () => {
  it("lets anyone with matter access record, computing the total exactly server-side", async () => {
    expect((await createExpense({ error: null }, fd({ ...valid, totalCents: "1" }))).error).toBeNull();
    expect(prismaMock.expense.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        matterId: "m-1",
        recordedById: "u-para",
        quantity: "2.500",
        unitCostCents: 333,
        totalCents: 833,
      }),
    });
  });

  it("denies a matter the user can't access (forged or unassigned)", async () => {
    hasMatterAccessMock.mockResolvedValue(false);
    expect((await createExpense({ error: null }, fd(valid))).error).toBe(NOT_FOUND);
    expect(prismaMock.expense.create).not.toHaveBeenCalled();
  });

  it("limits new expenses on a CLOSED matter to ADMIN/ATTORNEY", async () => {
    prismaMock.matter.findUnique.mockResolvedValue({ status: "CLOSED" });
    expect((await createExpense({ error: null }, fd(valid))).error).toBe(NOT_FOUND);
    requireCurrentUserMock.mockResolvedValue(attorney);
    expect((await createExpense({ error: null }, fd(valid))).error).toBeNull();
  });

  it("rejects a receipt document from another matter", async () => {
    prismaMock.document.count.mockResolvedValue(0);
    expect((await createExpense({ error: null }, fd({ ...valid, receiptDocumentId: "doc-other-matter" }))).error).toMatch(/receipt/);
    expect(prismaMock.document.count).toHaveBeenCalledWith({ where: { id: "doc-other-matter", matterId: "m-1" } });
    expect(prismaMock.expense.create).not.toHaveBeenCalled();
  });

  it("rejects a responsible staff member without access to the matter", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "u-x", role: "STAFF", status: "ACTIVE" });
    hasMatterAccessMock.mockImplementation(async (u: { id: string }) => u.id !== "u-x");
    expect((await createExpense({ error: null }, fd({ ...valid, responsibleUserId: "u-x" }))).error).toMatch(/responsible/);
    expect(prismaMock.expense.create).not.toHaveBeenCalled();
  });

  it("rejects invalid amounts", async () => {
    expect((await createExpense({ error: null }, fd({ ...valid, quantity: "0" }))).error).toMatch(/Quantity/);
    expect((await createExpense({ error: null }, fd({ ...valid, unitCost: "1.234" }))).error).toMatch(/Unit cost/);
  });

  it("never puts the description or amounts in the audit log", async () => {
    await createExpense({ error: null }, fd(valid));
    const text = JSON.stringify(audits());
    expect(text).not.toContain("ballistics");
    expect(text).not.toContain("833");
    expect(text).not.toContain("333");
    expect(audits()[0]).toMatchObject({ entityType: "Expense", metadata: { category: "EXPERT", billable: true } });
  });
});

describe("updateExpense", () => {
  it("allows the recorder to correct non-monetary fields but ignores submitted amounts when they can't see amounts", async () => {
    const result = await updateExpense({ error: null }, fd({ ...valid, expenseId: "e-1", description: "Corrected text", unitCost: "999.99" }));
    expect(result.error).toBeNull();
    const data = prismaMock.expense.update.mock.calls[0]![0].data;
    expect(data.description).toBe("Corrected text");
    expect(data).not.toHaveProperty("unitCostCents");
    expect(data).not.toHaveProperty("totalCents");
    expect(audits()[0].metadata).toEqual({ changed: ["description"] });
  });

  it("lets an assigned attorney correct amounts, auditing field names only", async () => {
    requireCurrentUserMock.mockResolvedValue(attorney);
    canSeeExpenseAmountsMock.mockResolvedValue(true);
    await updateExpense({ error: null }, fd({ ...valid, expenseId: "e-1", unitCost: "4.00" }));
    expect(prismaMock.expense.update.mock.calls[0]![0].data).toMatchObject({ unitCostCents: 400, totalCents: 1000 });
    expect(audits()[0].metadata).toEqual({ changed: ["unitCost"] });
  });

  it("denies staff who neither recorded it nor can see amounts", async () => {
    requireCurrentUserMock.mockResolvedValue(staff);
    expect((await updateExpense({ error: null }, fd({ ...valid, expenseId: "e-1" }))).error).toBe(NOT_FOUND);
    expect(prismaMock.expense.update).not.toHaveBeenCalled();
  });

  it("denies an unassigned attorney (no matter access) even for a known id", async () => {
    requireCurrentUserMock.mockResolvedValue(attorney);
    hasMatterAccessMock.mockResolvedValue(false);
    expect((await updateExpense({ error: null }, fd({ ...valid, expenseId: "e-1" }))).error).toBe(NOT_FOUND);
  });

  it("can't move an expense to another matter by forging matterId", async () => {
    requireCurrentUserMock.mockResolvedValue(admin);
    canSeeExpenseAmountsMock.mockResolvedValue(true);
    await updateExpense({ error: null }, fd({ ...valid, expenseId: "e-1", matterId: "m-other", description: "x" }));
    expect(prismaMock.expense.update.mock.calls[0]![0].data).not.toHaveProperty("matterId");
    expect(prismaMock.auditEvent.create.mock.calls[0]![0].data.matterId).toBe("m-1");
  });
});

describe("voidExpense", () => {
  it("voids with a reason and never deletes", async () => {
    expect(await voidExpense({ expenseId: "e-1", reason: "Duplicate entry" })).toEqual({ ok: true, data: undefined });
    expect(prismaMock.expense.update).toHaveBeenCalledWith({
      where: { id: "e-1" },
      data: { voidedAt: expect.any(Date), voidReason: "Duplicate entry" },
    });
    expect(prismaMock.expense.delete).not.toHaveBeenCalled();
    expect(JSON.stringify(audits())).not.toContain("Duplicate entry");
  });

  it("requires a reason and refuses already-voided expenses", async () => {
    expect((await voidExpense({ expenseId: "e-1", reason: " " })).ok).toBe(false);
    prismaMock.expense.findUnique.mockResolvedValue({ ...existing, voidedAt: new Date() });
    expect(await voidExpense({ expenseId: "e-1", reason: "x" })).toEqual({ ok: false, error: NOT_FOUND });
  });

  it("denies staff who can't edit it", async () => {
    requireCurrentUserMock.mockResolvedValue(staff);
    expect(await voidExpense({ expenseId: "e-1", reason: "x" })).toEqual({ ok: false, error: NOT_FOUND });
  });
});
