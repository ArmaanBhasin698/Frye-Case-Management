"use client";

import { useActionState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createClient, type FormActionState } from "@/lib/clients/actions";

const INITIAL_STATE: FormActionState = { error: null };

export function NewClientForm() {
  const [state, formAction, isPending] = useActionState(createClient, INITIAL_STATE);

  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-border bg-card p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="client-firstName">First name</Label>
          <Input id="client-firstName" name="firstName" required placeholder="e.g. Jordan" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="client-lastName">Last name</Label>
          <Input id="client-lastName" name="lastName" required placeholder="e.g. Ellis" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="client-dateOfBirth">Date of birth</Label>
          <Input id="client-dateOfBirth" name="dateOfBirth" type="date" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="client-email">Email</Label>
          <Input id="client-email" name="email" type="email" placeholder="e.g. jordan.ellis@example.com" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="client-phone">Phone</Label>
          <Input id="client-phone" name="phone" placeholder="e.g. 555-0142" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="client-address">Address</Label>
          <Input id="client-address" name="address" placeholder="Street, city, state" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="client-notes">Notes</Label>
          <Textarea id="client-notes" name="notes" rows={3} placeholder="Optional intake notes…" />
        </div>
      </div>

      {state.error && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {state.error}
        </p>
      )}

      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="ghost" size="sm" asChild>
          <Link href="/clients">Cancel</Link>
        </Button>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Creating…" : "Create Client"}
        </Button>
      </div>
    </form>
  );
}
