import type { ExpenseCategory } from "@prisma/client";

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  FILING_FEE: "Filing fee",
  EXPERT: "Expert",
  INVESTIGATOR: "Investigator",
  TRANSCRIPT: "Transcript",
  COPIES: "Copies",
  POSTAGE: "Postage",
  TRAVEL: "Travel",
  SERVICE_OF_PROCESS: "Service of process",
  OTHER: "Other",
};

export const EXPENSE_CATEGORY_VALUES = Object.keys(EXPENSE_CATEGORY_LABELS) as [ExpenseCategory, ...ExpenseCategory[]];
