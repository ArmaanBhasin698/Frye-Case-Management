"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { hasMatterAccess } from "@/lib/auth/access";
import { requireCurrentUser } from "@/lib/auth/session";
import { canManageClientsAndMatters, isAdmin, type AuthorizableUser } from "@/lib/auth/authorization";
import type { ActionResult } from "@/lib/matters/actions";
import { canSeeExpenseAmounts } from "@/lib/expenses/access";
import { readExpenseAmount, readExpenseFields, type ExpenseFields } from "@/lib/expenses/fields";
import { computeTotalCents, quantityToDecimalString } from "@/lib/expenses/money";

/**
 * Server Actions for matter expenses (case costs — filing fees, experts,
 * postage …). Rules (docs/MYCASE_PARITY_SCHEMA_PROPOSAL.md, domain H):
 *  - Anyone with matter access may record an expense, including its
 *    amounts (they usually hold the receipt). Afterwards amounts are only
 *    shown to ADMIN and ATTORNEYs assigned to the matter.
 *  - Correcting or voiding: the recorder, an ATTORNEY assigned to the
 *    matter, or ADMIN. A corrector who can't see amounts may change only
 *    non-monetary fields — submitted amounts are ignored for them.
 *  - New expenses on a CLOSED matter are limited to ADMIN/ATTORNEY (the
 *    same wrap-up rule as time entries).
 *  - Never deleted: a mistaken expense is voided with a reason.
 *  - Audit metadata: ids, category, billable, changed field *names* —
 *    never descriptions or amounts.
 *  - No invoices, payments, trust accounting, or QuickBooks.
 */

const NOT_FOUND = "Not found or access denied.";
const cuid = z.string().trim().min(1).max(100);

export type ExpenseFormState = { error: string | null };

function revalidateExpenses(matterId: string) {
  revalidatePath(`/matters/${matterId}/expenses`);
  revalidatePath("/expenses");
}

async function canRecordOn(user: AuthorizableUser, matterId: string): Promise<boolean> {
  if (!(await hasMatterAccess(user, matterId))) return false;
  const matter = await prisma.matter.findUnique({ where: { id: matterId }, select: { status: true } });
  if (!matter) return false;
  return matter.status !== "CLOSED" || canManageClientsAndMatters(user);
}

/** Responsible staff must be active and able to access the matter; a receipt must be a document of the same matter. */
async function validateReferences(fields: ExpenseFields): Promise<string | null> {
  if (fields.responsibleUserId) {
    const target = await prisma.user.findUnique({
      where: { id: fields.responsibleUserId },
      select: { id: true, role: true, status: true },
    });
    if (!target || target.status !== "ACTIVE" || !(await hasMatterAccess(target, fields.matterId))) {
      return "Choose a responsible staff member who is on this matter.";
    }
  }
  if (fields.receiptDocumentId) {
    const doc = await prisma.document.count({ where: { id: fields.receiptDocumentId, matterId: fields.matterId } });
    if (doc === 0) return "Choose a receipt document from this matter.";
  }
  return null;
}

function isForeignKeyError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003";
}

export async function createExpense(_prev: ExpenseFormState, formData: FormData): Promise<ExpenseFormState> {
  const user = await requireCurrentUser();
  const parsed = readExpenseFields(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const fields = parsed.data;
  const amount = readExpenseAmount(formData);
  if (!amount.success) return { error: amount.error.issues[0]?.message ?? "Invalid amount." };

  if (!(await canRecordOn(user, fields.matterId))) return { error: NOT_FOUND };
  const referenceError = await validateReferences(fields);
  if (referenceError) return { error: referenceError };

  const { quantityThousandths, unitCostCents } = amount.data;
  try {
    await prisma.$transaction(async (tx) => {
      const expense = await tx.expense.create({
        data: {
          matterId: fields.matterId,
          incurredOn: new Date(fields.incurredOn),
          recordedById: user.id,
          responsibleUserId: fields.responsibleUserId ?? null,
          category: fields.category,
          description: fields.description,
          quantity: quantityToDecimalString(quantityThousandths),
          unitCostCents,
          totalCents: computeTotalCents(quantityThousandths, unitCostCents),
          billable: fields.billable,
          receiptDocumentId: fields.receiptDocumentId ?? null,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorId: user.id,
          action: "CREATE",
          entityType: "Expense",
          entityId: expense.id,
          matterId: fields.matterId,
          metadata: { category: fields.category, billable: fields.billable, receiptAttached: Boolean(fields.receiptDocumentId) },
        },
      });
    });
  } catch (error) {
    if (isForeignKeyError(error)) return { error: NOT_FOUND };
    throw error;
  }

  revalidateExpenses(fields.matterId);
  return { error: null };
}

/** Recorder, an ATTORNEY assigned to the matter, or ADMIN — and the caller must still have matter access. */
async function loadEditableExpense(user: AuthorizableUser, expenseId: string) {
  const expense = await prisma.expense.findUnique({ where: { id: expenseId } });
  if (!expense || !(await hasMatterAccess(user, expense.matterId))) return null;
  const mayEdit = isAdmin(user) || expense.recordedById === user.id || (await canSeeExpenseAmounts(user, expense.matterId));
  return mayEdit ? expense : null;
}

export async function updateExpense(_prev: ExpenseFormState, formData: FormData): Promise<ExpenseFormState> {
  const user = await requireCurrentUser();
  const expenseId = cuid.safeParse(formData.get("expenseId"));
  if (!expenseId.success) return { error: NOT_FOUND };
  const before = await loadEditableExpense(user, expenseId.data);
  if (!before || before.voidedAt) return { error: NOT_FOUND };

  // The matter can't be changed by editing; reuse the stored one.
  formData.set("matterId", before.matterId);
  const parsed = readExpenseFields(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const fields = parsed.data;
  const referenceError = await validateReferences(fields);
  if (referenceError) return { error: referenceError };

  const mayChangeAmounts = await canSeeExpenseAmounts(user, before.matterId);
  let money: { quantity: string; unitCostCents: number; totalCents: number } | null = null;
  if (mayChangeAmounts) {
    const amount = readExpenseAmount(formData);
    if (!amount.success) return { error: amount.error.issues[0]?.message ?? "Invalid amount." };
    money = {
      quantity: quantityToDecimalString(amount.data.quantityThousandths),
      unitCostCents: amount.data.unitCostCents,
      totalCents: computeTotalCents(amount.data.quantityThousandths, amount.data.unitCostCents),
    };
  }

  const next = {
    incurredOn: new Date(fields.incurredOn),
    category: fields.category,
    description: fields.description,
    billable: fields.billable,
    responsibleUserId: fields.responsibleUserId ?? null,
    receiptDocumentId: fields.receiptDocumentId ?? null,
    ...(money ?? {}),
  };
  const changed: string[] = [];
  if (before.incurredOn.getTime() !== next.incurredOn.getTime()) changed.push("incurredOn");
  if (before.category !== next.category) changed.push("category");
  if (before.description !== next.description) changed.push("description");
  if (before.billable !== next.billable) changed.push("billable");
  if (before.responsibleUserId !== next.responsibleUserId) changed.push("responsibleUserId");
  if (before.receiptDocumentId !== next.receiptDocumentId) changed.push("receiptDocumentId");
  if (money) {
    if (!before.quantity.equals(new Prisma.Decimal(money.quantity))) changed.push("quantity");
    if (before.unitCostCents !== money.unitCostCents) changed.push("unitCost");
  }
  if (changed.length === 0) return { error: null };

  await prisma.$transaction([
    prisma.expense.update({ where: { id: before.id }, data: next }),
    prisma.auditEvent.create({
      data: {
        actorId: user.id,
        action: "UPDATE",
        entityType: "Expense",
        entityId: before.id,
        matterId: before.matterId,
        metadata: { changed },
      },
    }),
  ]);

  revalidateExpenses(before.matterId);
  return { error: null };
}

export async function voidExpense(input: { expenseId: string; reason: string }): Promise<ActionResult> {
  const user = await requireCurrentUser();
  const parsed = z
    .object({ expenseId: cuid, reason: z.string().trim().min(1, "Give a reason for voiding.").max(500) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? NOT_FOUND };

  const expense = await loadEditableExpense(user, parsed.data.expenseId);
  if (!expense || expense.voidedAt) return { ok: false, error: NOT_FOUND };

  await prisma.$transaction([
    prisma.expense.update({
      where: { id: expense.id },
      data: { voidedAt: new Date(), voidReason: parsed.data.reason },
    }),
    prisma.auditEvent.create({
      data: {
        actorId: user.id,
        action: "UPDATE",
        entityType: "Expense",
        entityId: expense.id,
        matterId: expense.matterId,
        metadata: { voided: true },
      },
    }),
  ]);

  revalidateExpenses(expense.matterId);
  return { ok: true, data: undefined };
}
