"use client";

import * as React from "react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createExpense, updateExpense, voidExpense, type ExpenseFormState } from "@/lib/expenses/actions";
import { EXPENSE_CATEGORY_LABELS, EXPENSE_CATEGORY_VALUES } from "@/lib/expenses/labels";

const INITIAL: ExpenseFormState = { error: null };
type Option = { id: string; label: string };

export type ExpenseFormInitial = {
  id: string;
  incurredOn: string;
  category: string;
  description: string;
  billable: boolean;
  responsibleUserId: string;
  receiptDocumentId: string;
  /** Only present for users who may see amounts. */
  quantity?: string;
  unitCost?: string;
};

/**
 * Record or correct a matter expense. Staff options and receipt documents
 * are pre-scoped server-side (people on this matter, this matter's
 * documents); the actions re-validate both. `showAmounts` reflects the
 * owner rule (ADMIN or an ATTORNEY assigned to the matter): when false, a
 * *new* expense still takes its amount (the recorder holds the receipt),
 * but an edit form omits amount fields entirely and the server ignores
 * any submitted amounts.
 */
export function ExpenseForm({
  matterId,
  staff,
  receipts,
  showAmounts,
  editing,
}: {
  matterId: string;
  staff: Option[];
  receipts: Option[];
  showAmounts: boolean;
  editing?: ExpenseFormInitial;
}) {
  const [state, formAction, isPending] = useActionState(editing ? updateExpense : createExpense, INITIAL);
  const [open, setOpen] = React.useState(false);
  const [prev, setPrev] = React.useState(state);
  if (state !== prev) {
    setPrev(state);
    if (!state.error) setOpen(false);
  }

  if (!open) {
    return (
      <Button variant={editing ? "ghost" : "default"} size="sm" onClick={() => setOpen(true)}>
        {editing ? "Correct" : "Record expense"}
      </Button>
    );
  }

  const e = editing;
  const amountFields = !e || showAmounts;
  return (
    <form action={formAction} className="w-full space-y-3 rounded-lg border border-border bg-card p-4">
      <input type="hidden" name="matterId" value={matterId} />
      {e && <input type="hidden" name="expenseId" value={e.id} />}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="ex-date">Date incurred</Label>
          <Input id="ex-date" name="incurredOn" type="date" required defaultValue={e?.incurredOn ?? new Date().toISOString().slice(0, 10)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ex-cat">Category</Label>
          <Select id="ex-cat" name="category" defaultValue={e?.category ?? "FILING_FEE"}>
            {EXPENSE_CATEGORY_VALUES.map((c) => (
              <option key={c} value={c}>
                {EXPENSE_CATEGORY_LABELS[c]}
              </option>
            ))}
          </Select>
        </div>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" name="billable" defaultChecked={e?.billable ?? true} />
          Billable
        </label>
        <div className="space-y-1.5 sm:col-span-3">
          <Label htmlFor="ex-desc">Description</Label>
          <Textarea id="ex-desc" name="description" rows={2} required defaultValue={e?.description} />
        </div>
        {amountFields && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="ex-qty">Quantity</Label>
              <Input id="ex-qty" name="quantity" inputMode="decimal" required defaultValue={e?.quantity ?? "1"} placeholder="e.g. 1 or 2.5" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ex-cost">Unit cost ($)</Label>
              <Input id="ex-cost" name="unitCost" inputMode="decimal" required defaultValue={e?.unitCost} placeholder="e.g. 45.00" />
            </div>
          </>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="ex-resp">Responsible staff (optional)</Label>
          <Select id="ex-resp" name="responsibleUserId" defaultValue={e?.responsibleUserId ?? ""}>
            <option value="">—</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="ex-receipt">Receipt document (optional)</Label>
          <Select id="ex-receipt" name="receiptDocumentId" defaultValue={e?.receiptDocumentId ?? ""}>
            <option value="">None</option>
            {receipts.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {!showAmounts && (
        <p className="text-xs text-muted-foreground">
          {e
            ? "Amounts can be corrected by the matter's attorneys or an administrator."
            : "Amounts are visible only to administrators and the attorneys on this matter — you won't see this amount after saving."}
        </p>
      )}
      {state.error && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {state.error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Saving…" : e ? "Save correction" : "Record expense"}
        </Button>
      </div>
    </form>
  );
}

/** Voids (never deletes) an expense, with a required reason. */
export function VoidExpenseButton({ expenseId }: { expenseId: string }) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function run() {
    const reason = window.prompt("Reason for voiding this expense?");
    if (!reason) return;
    setError(null);
    setPending(true);
    const result = await voidExpense({ expenseId, reason });
    setPending(false);
    if (!result.ok) setError(result.error);
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => void run()}>
        Void
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}
