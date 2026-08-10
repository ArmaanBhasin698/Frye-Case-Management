"use client";

import { useActionState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import type { MatterStatus } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { updateMatter, type FormActionState } from "@/lib/matters/actions";
import { asCalendarDate } from "@/lib/matters/format";

type EditableMatter = {
  id: string;
  caseNumber: string;
  court: string;
  charges: string;
  status: MatterStatus;
  openedDate: Date;
  closedDate: Date | null;
};

const INITIAL_STATE: FormActionState = { error: null };

export function EditMatterForm({ matter }: { matter: EditableMatter }) {
  const [state, formAction, isPending] = useActionState(updateMatter, INITIAL_STATE);

  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-border bg-card p-6">
      <input type="hidden" name="matterId" value={matter.id} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="edit-matter-caseNumber">Case number</Label>
          <Input id="edit-matter-caseNumber" name="caseNumber" required defaultValue={matter.caseNumber} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-matter-court">Court</Label>
          <Input id="edit-matter-court" name="court" required defaultValue={matter.court} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="edit-matter-charges">Charges</Label>
          <Input id="edit-matter-charges" name="charges" required defaultValue={matter.charges} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-matter-status">Status</Label>
          <Select id="edit-matter-status" name="status" defaultValue={matter.status}>
            <option value="OPEN">Open</option>
            <option value="PENDING">Pending</option>
            <option value="CLOSED">Closed</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-matter-openedDate">Opened date</Label>
          <Input
            id="edit-matter-openedDate"
            name="openedDate"
            type="date"
            required
            defaultValue={format(asCalendarDate(matter.openedDate), "yyyy-MM-dd")}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-matter-closedDate">Closed date</Label>
          <Input
            id="edit-matter-closedDate"
            name="closedDate"
            type="date"
            defaultValue={matter.closedDate ? format(asCalendarDate(matter.closedDate), "yyyy-MM-dd") : ""}
          />
        </div>
      </div>

      {state.error && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {state.error}
        </p>
      )}

      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="ghost" size="sm" asChild>
          <Link href={`/matters/${matter.id}`}>Cancel</Link>
        </Button>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Saving…" : "Save Matter"}
        </Button>
      </div>
    </form>
  );
}
