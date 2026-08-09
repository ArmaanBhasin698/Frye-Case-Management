"use client";

import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { createMatter, type FormActionState } from "@/lib/matters/actions";

type ClientOption = { id: string; firstName: string; lastName: string };
type StaffOption = { id: string; name: string; role: string };

const ASSIGNMENT_ROLE_OPTIONS = [
  { value: "LEAD_ATTORNEY", label: "Lead Attorney" },
  { value: "ASSOCIATE_ATTORNEY", label: "Associate Attorney" },
  { value: "PARALEGAL", label: "Paralegal" },
  { value: "STAFF", label: "Staff" },
] as const;

const INITIAL_STATE: FormActionState = { error: null };

export function NewMatterForm({
  clients,
  staff,
}: {
  clients: ClientOption[];
  staff: StaffOption[];
}) {
  const [state, formAction, isPending] = useActionState(createMatter, INITIAL_STATE);
  const [rowKeys, setRowKeys] = React.useState<number[]>([0]);
  const nextKey = React.useRef(1);

  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-border bg-card p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="matter-clientId">Client</Label>
          <Select id="matter-clientId" name="clientId" required defaultValue="">
            <option value="" disabled>
              Select an existing client…
            </option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.lastName}, {client.firstName}
              </option>
            ))}
          </Select>
          {clients.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No clients exist yet —{" "}
              <Link href="/clients/new" className="underline">
                create one first
              </Link>
              .
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="matter-caseNumber">Case number</Label>
          <Input id="matter-caseNumber" name="caseNumber" required placeholder="e.g. 26-CR-01234" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="matter-court">Court</Label>
          <Input id="matter-court" name="court" required placeholder="e.g. Fulton County Superior Court" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="matter-charges">Charges</Label>
          <Input id="matter-charges" name="charges" required placeholder="e.g. Possession of a Controlled Substance" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="matter-status">Status</Label>
          <Select id="matter-status" name="status" defaultValue="OPEN">
            <option value="OPEN">Open</option>
            <option value="PENDING">Pending</option>
            <option value="CLOSED">Closed</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="matter-openedDate">Opened date</Label>
          <Input id="matter-openedDate" name="openedDate" type="date" required />
        </div>
      </div>

      <div className="space-y-2 border-t border-border pt-4">
        <div className="flex items-center justify-between">
          <Label>Staff assignments</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setRowKeys((prev) => [...prev, nextKey.current++]);
            }}
          >
            Add assignment
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">At least one staff member must be assigned.</p>
        <div className="space-y-2">
          {rowKeys.map((key, index) => (
            <div key={key} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
              <div className="space-y-1.5">
                {index === 0 && <Label className="text-xs">Staff member</Label>}
                <Select name="assignmentUserId" required defaultValue="">
                  <option value="" disabled>
                    Select staff…
                  </option>
                  {staff.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                {index === 0 && <Label className="text-xs">Role</Label>}
                <Select name="assignmentRole" defaultValue="ASSOCIATE_ATTORNEY">
                  {ASSIGNMENT_ROLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </Select>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={rowKeys.length === 1}
                onClick={() => setRowKeys((prev) => prev.filter((k) => k !== key))}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      </div>

      {state.error && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {state.error}
        </p>
      )}

      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="ghost" size="sm" asChild>
          <Link href="/matters">Cancel</Link>
        </Button>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Creating…" : "Create Matter"}
        </Button>
      </div>
    </form>
  );
}
