"use client";

import { useActionState } from "react";
import Link from "next/link";
import { format } from "date-fns";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { updateClient, type FormActionState } from "@/lib/clients/actions";

type EditableClient = {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: Date | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
};

const INITIAL_STATE: FormActionState = { error: null };

export function EditClientForm({ client }: { client: EditableClient }) {
  const [state, formAction, isPending] = useActionState(updateClient, INITIAL_STATE);

  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-border bg-card p-6">
      <input type="hidden" name="clientId" value={client.id} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="edit-client-firstName">First name</Label>
          <Input id="edit-client-firstName" name="firstName" required defaultValue={client.firstName} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-client-lastName">Last name</Label>
          <Input id="edit-client-lastName" name="lastName" required defaultValue={client.lastName} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-client-dateOfBirth">Date of birth</Label>
          <Input
            id="edit-client-dateOfBirth"
            name="dateOfBirth"
            type="date"
            defaultValue={client.dateOfBirth ? format(client.dateOfBirth, "yyyy-MM-dd") : ""}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-client-email">Email</Label>
          <Input id="edit-client-email" name="email" type="email" defaultValue={client.email ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-client-phone">Phone</Label>
          <Input id="edit-client-phone" name="phone" defaultValue={client.phone ?? ""} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="edit-client-address">Address</Label>
          <Input id="edit-client-address" name="address" defaultValue={client.address ?? ""} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="edit-client-notes">Notes</Label>
          <Textarea id="edit-client-notes" name="notes" rows={3} defaultValue={client.notes ?? ""} />
        </div>
      </div>

      {state.error && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {state.error}
        </p>
      )}

      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="ghost" size="sm" asChild>
          <Link href={`/clients/${client.id}`}>Cancel</Link>
        </Button>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Saving…" : "Save Client"}
        </Button>
      </div>
    </form>
  );
}
