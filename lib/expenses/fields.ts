import { z } from "zod";

import { EXPENSE_CATEGORY_VALUES } from "@/lib/expenses/labels";
import { parseDollarsToCents, parseQuantity } from "@/lib/expenses/money";

/** Expense form validation — a plain module so it's unit-testable and not network-callable. */

const optionalId = z
  .string()
  .trim()
  .max(100)
  .optional()
  .transform((v) => (v ? v : undefined));

export const expenseFieldsSchema = z.object({
  matterId: z.string().trim().min(1).max(100),
  incurredOn: z
    .string()
    .min(1, "Date is required.")
    .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)), "Invalid date."),
  category: z.enum(EXPENSE_CATEGORY_VALUES),
  description: z.string().trim().min(1, "Describe the expense.").max(1_000, "Description is too long."),
  billable: z.boolean(),
  responsibleUserId: optionalId,
  receiptDocumentId: optionalId,
});

/** Monetary fields, validated separately: someone editing without amount visibility never submits them. */
export const expenseAmountSchema = z
  .object({
    quantity: z.string().trim().min(1, "Quantity is required."),
    unitCost: z.string().trim().min(1, "Unit cost is required."),
  })
  .transform((d, ctx) => {
    const quantityThousandths = parseQuantity(d.quantity);
    const unitCostCents = parseDollarsToCents(d.unitCost);
    if (quantityThousandths === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Quantity must be a positive number with at most 3 decimals (max 1,000,000)." });
      return z.NEVER;
    }
    if (unitCostCents === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Unit cost must be a dollar amount with at most 2 decimals (max $1,000,000)." });
      return z.NEVER;
    }
    return { quantityThousandths, unitCostCents };
  });

export type ExpenseFields = z.infer<typeof expenseFieldsSchema>;

function get(formData: FormData, key: string) {
  const v = formData.get(key);
  return v === null ? undefined : String(v);
}

export function readExpenseFields(formData: FormData) {
  return expenseFieldsSchema.safeParse({
    matterId: get(formData, "matterId"),
    incurredOn: get(formData, "incurredOn"),
    category: get(formData, "category"),
    description: get(formData, "description"),
    billable: get(formData, "billable") === "on",
    responsibleUserId: get(formData, "responsibleUserId"),
    receiptDocumentId: get(formData, "receiptDocumentId"),
  });
}

export function readExpenseAmount(formData: FormData) {
  return expenseAmountSchema.safeParse({ quantity: get(formData, "quantity") ?? "", unitCost: get(formData, "unitCost") ?? "" });
}
